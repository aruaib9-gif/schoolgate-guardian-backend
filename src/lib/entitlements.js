/**
 * entitlements.js — what a school is allowed to DO, based on its plan.
 *
 * This is the plan/capability axis. It is deliberately separate from
 * RolePermissions (which answers "can this *teacher* edit attendance?").
 * Here we answer "does this *school* get bus tracking at all?".
 *
 * Design mirrors the billing engine in plans.js: catalog data + per-school
 * overrides resolved through one function, so there is never a stray
 * `if (plan === 'premium')` scattered through the codebase — and so sales can
 * grant one school a feature without inventing a new plan.
 *
 *   FEATURES  — boolean capabilities, gated at the route layer.
 *   LIMITS    — numeric caps (null = unlimited), enforced on create.
 */

import { getPlans } from './plans.js';

// Every gate-able capability in the product.
export const FEATURES = [
  { id: 'access_logs', name: 'Gate scanning & access logs', core: true },
  { id: 'people', name: 'People registry & QR codes', core: true },
  { id: 'attendance', name: 'Attendance' },
  { id: 'passes', name: 'Guest passes & visitors' },
  { id: 'bus', name: 'Bus tracking & boarding scans' },
  { id: 'messaging', name: 'Messaging & broadcasts' },
  { id: 'reports', name: 'Reports & exports' },
  { id: 'crm', name: 'CRM (leads, orders, targets)' },
  { id: 'custom_roles', name: 'Custom roles & permissions' },
  { id: 'multi_campus', name: 'Multi-campus' },
];

export const LIMIT_KEYS = ['people', 'gates'];

/**
 * What each package unlocks now comes from the same catalog that prices it —
 * see lib/plans.js. Keeping a second hardcoded copy here is how a package could
 * be sold as including bus tracking while the API still refused it.
 *
 * These remain as the fallback for a database that has not been seeded.
 */
export const DEFAULT_PLAN_ENTITLEMENTS = {
  trial: {
    features: ['access_logs', 'people'],
    limits: { people: 100, gates: 1 },
  },
  basic: {
    features: ['access_logs', 'people', 'attendance', 'passes'],
    limits: { people: 500, gates: 2 },
  },
  premium: {
    features: ['access_logs', 'people', 'attendance', 'passes', 'bus', 'messaging', 'reports'],
    limits: { people: 2000, gates: null },
  },
  enterprise: {
    features: [
      'access_logs', 'people', 'attendance', 'passes', 'bus', 'messaging',
      'reports', 'crm', 'custom_roles', 'multi_campus',
    ],
    limits: { people: null, gates: null },
  },
};

// Entity → feature it belongs to. Entities not listed are core (always allowed).
export const ENTITY_FEATURE = {
  Attendance: 'attendance',
  GuestPass: 'passes',
  OneTimePass: 'passes',
  Visitor: 'passes',
  SchoolBus: 'bus',
  BusScanLog: 'bus',
  Message: 'messaging',
  RolePermissions: 'custom_roles',
  CRMLead: 'crm',
  CRMCustomer: 'crm',
  CRMProduct: 'crm',
  CRMOrder: 'crm',
  CRMActivity: 'crm',
  CRMSalesTarget: 'crm',
};

/** The live entitlement map, derived from the package catalog. */
export function planEntitlements() {
  const out = {};
  for (const p of getPlans()) {
    out[p.id] = {
      features: p.entitlements?.length ? [...p.entitlements] : [],
      limits: p.limits || { people: null, gates: null },
    };
  }
  return Object.keys(out).length ? out : DEFAULT_PLAN_ENTITLEMENTS;
}

const planKey = (school) => {
  const map = planEntitlements();
  const p = school?.subscription_plan || school?.plan || 'trial';
  return map[p] ? p : (map.trial ? 'trial' : Object.keys(map)[0]);
};

/** Capture what a plan includes right now — stored on the school at signup. */
export function snapshotFor(plan) {
  const map = planEntitlements();
  const key = map[plan] ? plan : planKey({});
  const base = map[key];
  return {
    plan: key,
    features: [...base.features],
    limits: { ...base.limits },
    taken_at: new Date().toISOString(),
  };
}

/** Is the school's snapshot out of step with the current plan catalog? */
export function isGrandfathered(school = {}) {
  const snap = school.entitlement_snapshot;
  if (!snap || !Array.isArray(snap.features)) return false;
  const current = planEntitlements()[planKey(school)];
  if (!current) return false;
  const a = [...snap.features].sort().join(',');
  const b = [...current.features].sort().join(',');
  if (a !== b) return true;
  return LIMIT_KEYS.some((k) => (snap.limits?.[k] ?? null) !== (current.limits[k] ?? null));
}

/**
 * Resolve a school's effective entitlements.
 *
 * Order: the signup snapshot (if present) — so changing the plan catalog never
 * silently alters an existing school — then per-school overrides on top.
 * `feature_overrides` may grant (true) or revoke (false) any feature;
 * `limit_overrides` replaces a cap (null = unlimited).
 */
export function entitlements(school = {}) {
  const key = planKey(school);
  const snap = school.entitlement_snapshot;
  const base =
    snap && Array.isArray(snap.features)
      ? { features: snap.features, limits: snap.limits || {} }
      : planEntitlements()[key];

  const features = new Set(base.features);
  const fo = school.feature_overrides;
  if (fo && typeof fo === 'object') {
    for (const [id, on] of Object.entries(fo)) {
      if (on === true) features.add(id);
      else if (on === false) features.delete(id);
    }
  }

  const limits = { ...base.limits };
  const lo = school.limit_overrides;
  if (lo && typeof lo === 'object') {
    for (const k of LIMIT_KEYS) {
      if (k in lo) limits[k] = lo[k] === null ? null : Number(lo[k]);
    }
  }

  // Per-head billing and a headcount cap are contradictory — you would be
  // refusing revenue. Schools billed per student/person get unlimited people.
  const mode = school.billing_mode;
  if (mode === 'per_student' || mode === 'per_person') limits.people = null;

  return { plan: key, features, limits };
}

/** Does this school have a capability? */
export function can(school, feature) {
  if (!feature) return true; // unmapped/core
  return entitlements(school).features.has(feature);
}

/**
 * Check a numeric cap.
 * @returns {{ ok, unlimited, cap, used, remaining, pct, warn }}
 *          warn = true once usage reaches 90% of the cap.
 */
export function checkLimit(school, key, used = 0) {
  const cap = entitlements(school).limits[key];
  if (cap === null || cap === undefined) {
    return { ok: true, unlimited: true, cap: null, used, remaining: null, pct: 0, warn: false };
  }
  const pct = cap > 0 ? Math.round((used / cap) * 100) : 100;
  return {
    ok: used < cap,
    unlimited: false,
    cap,
    used,
    remaining: Math.max(0, cap - used),
    pct,
    warn: pct >= 90,
  };
}

/**
 * Packages cheapest-first. Ordered by price rather than by a fixed list, so an
 * upgrade suggestion still points at the cheapest package that actually solves
 * the problem once someone adds a package of their own.
 */
export function planOrder() {
  return getPlans()
    .filter((p) => p.is_active !== false)
    .slice()
    .sort((a, b) => (a.price || 0) - (b.price || 0) || (a.sort_order || 0) - (b.sort_order || 0))
    .map((p) => p.id);
}
export const PLAN_ORDER = ['trial', 'basic', 'premium', 'enterprise']; // legacy default

const dearest = () => planOrder().slice(-1)[0] || 'enterprise';

/** The cheapest package that includes `feature` — used to suggest an upgrade. */
export function upgradeFor(feature) {
  const map = planEntitlements();
  return planOrder().find((p) => map[p]?.features.includes(feature)) || dearest();
}

/** The cheapest package whose `key` cap clears `needed` (null cap = unlimited). */
export function upgradeForLimit(key, needed) {
  const map = planEntitlements();
  return (
    planOrder().find((p) => {
      const cap = map[p]?.limits?.[key];
      return cap === null || cap === undefined || cap > needed;
    }) || dearest()
  );
}

/** Serializable shape for API responses (Sets don't survive JSON). */
export function serializeEntitlements(school) {
  const e = entitlements(school);
  return {
    plan: e.plan,
    features: [...e.features],
    limits: e.limits,
    catalog: FEATURES.map((f) => ({ ...f, enabled: e.features.has(f.id) })),
    // True when the school is held to older plan terms than the live catalog.
    grandfathered: isGrandfathered(school),
    snapshot_at: school?.entitlement_snapshot?.taken_at || null,
  };
}
