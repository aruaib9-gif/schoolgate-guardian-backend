/**
 * superadmin.controller.js — the platform console API (/api/superadmin).
 *
 * Mirrors the Super Admin console's `db.js` contract (schools, onboarding
 * invitations, platform config, plans and analytics) so the dashboard can talk
 * to this backend instead of its in-memory dummy data — while the same records
 * are what the schools' admins read/write through the main app.
 */
import { prisma } from '../lib/prisma.js';
import { PLANS, planById, BILLING_MODES, BILLING_CYCLES, BILLING_DEFAULTS } from '../lib/plans.js';
import { PLAN_ENTITLEMENTS, FEATURES, LIMIT_KEYS } from '../lib/entitlements.js';
import {
  listSchoolsWithAggregates, buildOverview, buildSeries,
  getKpisFrom, planDistributionFrom, stateBreakdownFrom, topSchoolsFrom, colorForIndex,
} from '../lib/superadmin.js';
import { badRequest, notFound } from '../middleware/error.js';
import { emitEntityEvent } from '../lib/realtime.js';

const PLATFORM_CONFIG_ID = 'platform';
const codeFrom = (name) => (name || 'SCH').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SCH';

// --- audit (console-friendly shape stored inside AuditLog.metadata) --------
function colorForAction(a = '') {
  if (/(created|activated)/.test(a)) return 'green';
  if (/(suspended|deleted|revoked)/.test(a)) return 'red';
  if (/plan/.test(a)) return 'violet';
  if (/invit/.test(a)) return 'blue';
  if (/config/.test(a)) return 'amber';
  if (/login/.test(a)) return 'gray';
  return 'blue';
}
async function platformAudit(req, { type, title, detail, color }) {
  try {
    await prisma.auditLog.create({
      data: {
        action: type, entity_type: 'Platform', description: title,
        metadata: { type, title, detail, color: color || colorForAction(type) },
        actor_email: req.user?.email, actor_name: req.user?.full_name || 'Super Admin',
        actor_role: req.role, created_by: req.user?.email,
      },
    });
  } catch (e) { console.warn('[superadmin audit]', e.message); }
}
const auditToConsole = (r) => ({
  id: r.id,
  type: r.metadata?.type || r.action,
  title: r.metadata?.title || r.description || `${r.action} ${r.entity_type || ''}`.trim(),
  detail: r.metadata?.detail || (r.entity_type && r.entity_type !== 'Platform' ? r.entity_type : ''),
  color: r.metadata?.color || colorForAction(r.action),
  actor: r.actor_name || r.actor_email || 'Super Admin',
  created_date: r.created_date,
});

// Map an incoming console payload → School columns (plan → subscription_plan).
function toSchoolData(body = {}) {
  const d = {};
  const pass = ['name', 'city', 'state', 'status', 'admin_name', 'admin_email', 'admin_phone', 'address', 'phone', 'email', 'website'];
  for (const k of pass) if (body[k] !== undefined) d[k] = body[k];
  if (body.plan !== undefined) d.subscription_plan = body.plan;
  if (body.code !== undefined) d.code = codeFrom(body.code);
  if (body.students !== undefined) d.students = Number(body.students) || 0;
  if (body.staff !== undefined) d.staff = Number(body.staff) || 0;
  if (body.gates !== undefined) d.gates = Number(body.gates) || 0;
  // Billing overrides. Empty string / null clears the override (inherit default).
  const blank = (v) => v === '' || v === null;
  if (body.billing_mode !== undefined) d.billing_mode = blank(body.billing_mode) ? null : String(body.billing_mode);
  if (body.billing_cycle !== undefined) d.billing_cycle = blank(body.billing_cycle) ? null : String(body.billing_cycle);
  if (body.unit_price !== undefined) d.unit_price = blank(body.unit_price) ? null : Number(body.unit_price) || 0;
  if (body.custom_price !== undefined) d.custom_price = blank(body.custom_price) ? null : Number(body.custom_price) || 0;
  // Entitlement overrides: {feature: true|false} / {people: n|null}
  if (body.feature_overrides !== undefined) d.feature_overrides = body.feature_overrides || null;
  if (body.limit_overrides !== undefined) d.limit_overrides = body.limit_overrides || null;
  if (body.trial_ends_at !== undefined) d.trial_ends_at = body.trial_ends_at ? new Date(body.trial_ends_at) : null;
  return d;
}

// Ensure a school administrator User account exists (onboards the admin).
async function provisionAdmin(school) {
  if (!school.admin_email) return;
  const existing = await prisma.user.findUnique({ where: { email: school.admin_email } });
  if (existing) return;
  await prisma.user.create({
    data: {
      email: school.admin_email,
      full_name: school.admin_name || null,
      role: 'admin',
      user_category: 'admin',
      school_id: school.id,
      is_active: true,
      profile_completed: false, // completes on first login / password set
      created_by: 'superadmin',
    },
  });
}

// ---------------------------------------------------------------------------
// Overview / analytics
// ---------------------------------------------------------------------------
export async function overview(_req, res) {
  res.json(await buildOverview());
}
export async function series(_req, res) {
  res.json(await buildSeries());
}
export function plans(_req, res) {
  res.json(PLANS);
}

// Billing + entitlement catalog for the console: plans, modes, cycles, and
// which capabilities/limits each plan unlocks.
export function billingOptions(_req, res) {
  res.json({
    plans: PLANS.map((p) => ({ ...p, entitlements: PLAN_ENTITLEMENTS[p.id] || null })),
    modes: BILLING_MODES,
    cycles: BILLING_CYCLES,
    defaults: BILLING_DEFAULTS,
    features: FEATURES,
    limitKeys: LIMIT_KEYS,
  });
}

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------
export async function listSchools(_req, res) {
  res.json(await listSchoolsWithAggregates());
}

export async function getSchool(req, res) {
  const all = await listSchoolsWithAggregates();
  const found = all.find((s) => s.id === req.params.id);
  if (!found) throw notFound('School not found');
  res.json(found);
}

export async function createSchool(req, res) {
  const body = req.body || {};
  if (!body.name) throw badRequest('School name is required');
  const data = toSchoolData(body);
  if (!data.code) data.code = codeFrom(body.name);
  if (!data.subscription_plan) data.subscription_plan = 'basic';
  if (!data.status) data.status = 'active';
  data.created_by = req.user?.email;
  // A school starting on trial gets a deadline from the configured trial length.
  if (data.status === 'trial' && !data.trial_ends_at) {
    const cfg = await ensureConfig();
    data.trial_ends_at = new Date(Date.now() + (cfg.trial_days || 14) * 86400000);
  }

  // Ensure a unique code.
  let base = data.code, n = 1;
  while (await prisma.school.findUnique({ where: { code: data.code } })) data.code = `${base}${n++}`;

  const school = await prisma.school.create({ data });
  await provisionAdmin(school);
  await platformAudit(req, { type: 'school_created', title: `${school.name} onboarded`, detail: `${school.admin_name || 'Admin'} · ${planById(school.subscription_plan).name} plan`, color: 'green' });
  emitEntityEvent('School', 'create', school.id, school.id);

  const all = await listSchoolsWithAggregates();
  res.status(201).json(all.find((s) => s.id === school.id));
}

/**
 * Keep the lifecycle dates the access guard reads in step with `status`.
 * Applied on every status change (edit form *and* the status endpoint) so a
 * trial always has a deadline and suspension always has a grace start.
 */
async function stampLifecycle(data, existing) {
  const status = data.status;
  if (!status || status === existing.status) return data;
  if (status === 'suspended' || status === 'inactive') {
    if (!existing.suspended_at) data.suspended_at = new Date();
  } else {
    data.suspended_at = null;
  }
  if (status === 'trial') {
    if (!existing.trial_ends_at && !data.trial_ends_at) {
      const cfg = await ensureConfig();
      data.trial_ends_at = new Date(Date.now() + (cfg.trial_days || 14) * 86400000);
    }
  } else if (status === 'active') {
    data.trial_ends_at = null; // paying now — no deadline
  }
  return data;
}

export async function updateSchool(req, res) {
  const existing = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('School not found');
  const data = await stampLifecycle(toSchoolData(req.body || {}), existing);
  const planChanged = data.subscription_plan && data.subscription_plan !== existing.subscription_plan;
  const school = await prisma.school.update({ where: { id: req.params.id }, data });
  if (planChanged) {
    await platformAudit(req, { type: 'plan_changed', title: `${school.name} plan changed`, detail: `${planById(existing.subscription_plan).name} → ${planById(school.subscription_plan).name}`, color: 'violet' });
  }
  emitEntityEvent('School', 'update', school.id, school.id);
  const all = await listSchoolsWithAggregates();
  res.json(all.find((s) => s.id === school.id));
}

export async function setStatus(req, res) {
  const status = req.body?.status;
  if (!['active', 'trial', 'suspended', 'inactive'].includes(status)) throw badRequest('Invalid status');
  const existing = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('School not found');
  const data = await stampLifecycle({ status }, existing);
  const school = await prisma.school.update({ where: { id: req.params.id }, data });
  if (status === 'suspended') await platformAudit(req, { type: 'school_suspended', title: `${school.name} suspended`, detail: 'Access disabled by super admin', color: 'red' });
  else if (status === 'active') await platformAudit(req, { type: 'school_activated', title: `${school.name} reactivated`, detail: 'Access restored', color: 'green' });
  emitEntityEvent('School', 'update', school.id, school.id);
  const all = await listSchoolsWithAggregates();
  res.json(all.find((s) => s.id === school.id));
}

export async function deleteSchool(req, res) {
  const existing = await prisma.school.findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound('School not found');
  await prisma.school.delete({ where: { id: req.params.id } });
  await platformAudit(req, { type: 'school_deleted', title: `${existing.name} removed`, detail: 'School deleted from platform', color: 'red' });
  emitEntityEvent('School', 'delete', req.params.id, req.params.id);
  res.json({ success: true, id: req.params.id });
}

// ---------------------------------------------------------------------------
// Onboarding invitations
// ---------------------------------------------------------------------------
export async function listInvitations(_req, res) {
  res.json(await prisma.schoolInvitation.findMany({ orderBy: { created_date: 'desc' } }));
}

export async function createInvitation(req, res) {
  const b = req.body || {};
  if (!b.school_name) throw badRequest('School name is required');
  if (!b.admin_email) throw badRequest('Admin email is required');
  const inv = await prisma.schoolInvitation.create({
    data: {
      school_name: b.school_name, code: b.code ? codeFrom(b.code) : null,
      city: b.city || null, state: b.state || null,
      admin_name: b.admin_name || null, admin_email: b.admin_email, admin_phone: b.admin_phone || null,
      plan: b.plan || 'basic', status: 'sent', invited_by: req.user?.email, created_by: req.user?.email,
    },
  });
  await platformAudit(req, { type: 'admin_invited', title: `Invitation sent to ${inv.school_name}`, detail: `${inv.admin_name || inv.admin_email} · ${planById(inv.plan).name}`, color: 'blue' });
  res.status(201).json(inv);
}

export async function acceptInvitation(req, res) {
  const inv = await prisma.schoolInvitation.findUnique({ where: { id: req.params.id } });
  if (!inv) throw notFound('Invitation not found');
  if (inv.status === 'accepted') throw badRequest('Invitation already accepted');

  let code = codeFrom(inv.code || inv.school_name), n = 1;
  while (await prisma.school.findUnique({ where: { code } })) code = `${codeFrom(inv.code || inv.school_name)}${n++}`;

  const school = await prisma.school.create({
    data: {
      name: inv.school_name, code, city: inv.city, state: inv.state,
      admin_name: inv.admin_name, admin_email: inv.admin_email, admin_phone: inv.admin_phone,
      subscription_plan: inv.plan, status: 'active', created_by: req.user?.email,
    },
  });
  await provisionAdmin(school);
  await prisma.schoolInvitation.update({ where: { id: inv.id }, data: { status: 'accepted', accepted_at: new Date(), school_id: school.id } });
  await platformAudit(req, { type: 'school_created', title: `${school.name} onboarded`, detail: `Activated from invitation · ${planById(school.subscription_plan).name}`, color: 'green' });
  emitEntityEvent('School', 'create', school.id, school.id);

  const all = await listSchoolsWithAggregates();
  res.status(201).json(all.find((s) => s.id === school.id));
}

export async function deleteInvitation(req, res) {
  await prisma.schoolInvitation.deleteMany({ where: { id: req.params.id } });
  res.json({ success: true, id: req.params.id });
}

// ---------------------------------------------------------------------------
// Audit feed + platform config
// ---------------------------------------------------------------------------
export async function auditFeed(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await prisma.auditLog.findMany({
    where: { OR: [{ entity_type: 'Platform' }, { entity_type: 'School' }, { entity_type: 'SchoolInvitation' }] },
    orderBy: { created_date: 'desc' },
    take: limit,
  });
  res.json(rows.map(auditToConsole));
}

async function ensureConfig() {
  let cfg = await prisma.platformConfig.findUnique({ where: { id: PLATFORM_CONFIG_ID } });
  if (!cfg) cfg = await prisma.platformConfig.create({ data: { id: PLATFORM_CONFIG_ID } });
  return cfg;
}

export async function getConfig(_req, res) {
  res.json(await ensureConfig());
}

export async function updateConfig(req, res) {
  await ensureConfig();
  const b = req.body || {};
  const data = {};
  for (const k of ['platform_name', 'support_email', 'default_plan', 'attendance_cutoff', 'billing_mode', 'billing_cycle', 'currency']) {
    if (b[k] !== undefined) data[k] = String(b[k]);
  }
  if (b.trial_days !== undefined) data.trial_days = Number(b.trial_days) || 0;
  for (const k of ['termly_discount', 'annual_discount']) {
    if (b[k] !== undefined) data[k] = Math.max(0, Math.min(100, Number(b[k]) || 0));
  }
  for (const k of ['allow_self_signup', 'maintenance_mode']) if (b[k] !== undefined) data[k] = !!b[k];
  const cfg = await prisma.platformConfig.update({ where: { id: PLATFORM_CONFIG_ID }, data });
  await platformAudit(req, { type: 'config_changed', title: 'Platform settings updated', detail: Object.keys(data).join(', '), color: 'amber' });
  res.json(cfg);
}
