/**
 * superadmin.js — platform-wide aggregation for the Super Admin console.
 *
 * These helpers compute the exact shapes the console's `db.js` selectors return
 * (getKpis, getSeries, planDistribution, stateBreakdown, topSchools, school
 * aggregates), but from live Prisma data — so the dashboard stays in sync with
 * whatever the schools' admins do in the main app.
 */
import { prisma } from './prisma.js';
import { PLANS, planPrice, computeCharge } from './plans.js';

// Platform billing defaults (singleton row); schools inherit these.
export async function getBillingConfig() {
  try {
    return (await prisma.platformConfig.findUnique({ where: { id: 'platform' } })) || {};
  } catch {
    return {};
  }
}

const AVATAR_COLORS = ['#4f46e5', '#7c3aed', '#0d9488', '#2563eb', '#d97706', '#dc2626', '#16a34a'];
export const colorForIndex = (i) => AVATAR_COLORS[i % AVATAR_COLORS.length];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const isStudent = (cat) => cat === 'student';

// Last `n` calendar months as { label, start, end } (oldest → newest).
export function monthWindows(n = 8) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ label: start.toLocaleDateString('en-US', { month: 'short' }), start, end });
  }
  return out;
}

// Build maps of per-school live counts in as few queries as possible.
async function liveCounts() {
  const cutoff30 = daysAgo(30);
  const [personGroups, eventGroups, lastActiveGroups] = await Promise.all([
    prisma.person.groupBy({ by: ['school_id', 'category'], _count: { _all: true } }),
    prisma.accessLog.groupBy({ by: ['school_id'], where: { timestamp: { gte: cutoff30 } }, _count: { _all: true } }),
    prisma.accessLog.groupBy({ by: ['school_id'], _max: { timestamp: true } }),
  ]);

  const students = {}, staff = {}, events30d = {}, lastActive = {};
  for (const g of personGroups) {
    if (!g.school_id) continue;
    const c = g._count._all;
    if (isStudent(g.category)) students[g.school_id] = (students[g.school_id] || 0) + c;
    else staff[g.school_id] = (staff[g.school_id] || 0) + c;
  }
  for (const g of eventGroups) if (g.school_id) events30d[g.school_id] = g._count._all;
  for (const g of lastActiveGroups) if (g.school_id) lastActive[g.school_id] = g._max.timestamp;
  return { students, staff, events30d, lastActive };
}

// Decorate a raw school row with the fields the console expects.
function decorate(school, counts, i, config = {}) {
  const liveStudents = counts.students[school.id];
  const liveStaff = counts.staff[school.id];
  const students = liveStudents != null ? liveStudents : (school.students ?? 0);
  const staff = liveStaff != null ? liveStaff : (school.staff ?? 0);
  const gates = (school.gate_locations?.length || school.gates) ?? 0;
  // Price against the LIVE headcount so per-student billing tracks reality.
  const billing = computeCharge({ ...school, students, staff }, config);
  return {
    id: school.id,
    name: school.name,
    code: school.code,
    city: school.city || '',
    state: school.state || '',
    plan: school.subscription_plan,
    status: school.status,
    admin_name: school.admin_name || '',
    admin_email: school.admin_email || '',
    admin_phone: school.admin_phone || '',
    students,
    staff,
    gates,
    access_events_30d: counts.events30d[school.id] || 0,
    created_date: school.created_date,
    last_active: counts.lastActive[school.id] || school.updated_date,
    color: colorForIndex(i),
    // --- billing (overrides + the resolved charge for this school) ---
    billing_mode: school.billing_mode || null,
    billing_cycle: school.billing_cycle || null,
    unit_price: school.unit_price ?? null,
    custom_price: school.custom_price ?? null,
    billing,
  };
}

export async function listSchoolsWithAggregates() {
  const [schools, counts, config] = await Promise.all([
    prisma.school.findMany({ orderBy: { created_date: 'desc' } }),
    liveCounts(),
    getBillingConfig(),
  ]);
  return schools.map((s, i) => decorate(s, counts, i, config));
}

export function getKpisFrom(schools, pendingInvites) {
  const active = schools.filter((s) => s.status === 'active');
  const trial = schools.filter((s) => s.status === 'trial');
  const suspended = schools.filter((s) => s.status === 'suspended');
  const users = schools.reduce((t, s) => t + s.students + s.staff, 0);
  const students = schools.reduce((t, s) => t + s.students, 0);
  const events = schools.reduce((t, s) => t + s.access_events_30d, 0);
  // Normalised monthly value of each active school's contract (any cycle/mode).
  const mrr = active.reduce((t, s) => t + (s.billing?.monthly ?? planPrice(s.plan)), 0);
  return {
    totalSchools: schools.length,
    activeSchools: active.length,
    trialSchools: trial.length,
    suspendedSchools: suspended.length,
    pendingInvites,
    users, students,
    events30d: events,
    mrr,
    arr: mrr * 12,
  };
}

export function planDistributionFrom(schools) {
  return PLANS.map((p) => ({ ...p, count: schools.filter((s) => s.plan === p.id).length })).filter((p) => p.count > 0);
}

export function stateBreakdownFrom(schools) {
  const map = {};
  schools.forEach((s) => { const k = s.state || 'Unknown'; map[k] = (map[k] || 0) + 1; });
  return Object.entries(map).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);
}

export function topSchoolsFrom(schools, n = 5) {
  return [...schools].sort((a, b) => b.access_events_30d - a.access_events_30d).slice(0, n);
}

// 8-month platform time series, derived from real records.
export async function buildSeries() {
  const windows = monthWindows(8);
  const [schools, config] = await Promise.all([
    prisma.school.findMany({
      select: {
        created_date: true, status: true, subscription_plan: true, students: true, staff: true,
        billing_mode: true, billing_cycle: true, unit_price: true, custom_price: true,
      },
    }),
    getBillingConfig(),
  ]);
  // Access events per month via grouped counts (live gate/bus activity).
  const eventsByMonth = await Promise.all(
    windows.map((w) => prisma.accessLog.count({ where: { timestamp: { gte: w.start, lt: w.end } } }))
  );

  const sizeOf = (s) => (s.students || 0) + (s.staff || 0);
  const newSchools = windows.map((w) => schools.filter((s) => s.created_date >= w.start && s.created_date < w.end).length);
  // People managed = cumulative size of schools that are live by each month's end.
  const activeUsers = windows.map((w) => schools.filter((s) => s.created_date < w.end).reduce((t, s) => t + sizeOf(s), 0));
  const revenue = windows.map((w) =>
    schools
      .filter((s) => s.created_date < w.end && s.status === 'active')
      .reduce((t, s) => t + computeCharge(s, config).monthly, 0)
  );

  return { labels: windows.map((w) => w.label), newSchools, activeUsers, accessEvents: eventsByMonth, revenue };
}

export async function buildOverview() {
  const schools = await listSchoolsWithAggregates();
  const pendingInvites = await prisma.schoolInvitation.count({ where: { status: { not: 'accepted' } } });
  const series = await buildSeries();
  return {
    kpis: getKpisFrom(schools, pendingInvites),
    series,
    planDistribution: planDistributionFrom(schools),
    stateBreakdown: stateBreakdownFrom(schools),
    topSchools: topSchoolsFrom(schools, 5),
  };
}
