/**
 * plans.js — subscription catalog + billing engine, in Nigerian Naira (₦).
 *
 * Billing is customizable along three axes:
 *   1. MODE   — how the amount is derived:
 *        flat        → one price per school
 *        per_student → unit price × student count
 *        per_person  → unit price × (students + staff)
 *   2. CYCLE  — how often it is charged: monthly (1), termly (3 months), annual (12).
 *               Longer cycles can carry a discount.
 *   3. OVERRIDES — a platform default (PlatformConfig) that any individual
 *               school may override (School.billing_mode / billing_cycle /
 *               unit_price / custom_price).
 *
 * Everything funnels through computeCharge() so the console, invoices and the
 * MRR/ARR analytics always agree.
 */

// Per-plan rates. `price` is the flat monthly fee; the per-head rates are the
// default unit prices when a school is billed per student / per person.
export const PLANS = [
  { id: 'trial', name: 'Trial', price: 0, per_student: 0, per_person: 0, color: 'gray', features: ['Up to 100 people', '1 gate', '14-day access'] },
  { id: 'basic', name: 'Basic', price: 45000, per_student: 120, per_person: 100, color: 'blue', features: ['Up to 500 people', '2 gates', 'Access logs & attendance'] },
  { id: 'premium', name: 'Premium', price: 120000, per_student: 250, per_person: 200, color: 'violet', features: ['Up to 2,000 people', 'Unlimited gates', 'Bus tracking, CRM, reports'] },
  { id: 'enterprise', name: 'Enterprise', price: 280000, per_student: 400, per_person: 320, color: 'green', features: ['Unlimited people', 'Multi-campus', 'Priority support & SLA'] },
];

export const BILLING_MODES = [
  { id: 'flat', name: 'Per school', hint: 'One flat fee per school' },
  { id: 'per_student', name: 'Per student', hint: 'Unit price × students' },
  { id: 'per_person', name: 'Per person', hint: 'Unit price × (students + staff)' },
];

// months = how many months each invoice covers. A term is 3 months.
export const BILLING_CYCLES = [
  { id: 'monthly', name: 'Monthly', months: 1, hint: 'Billed every month' },
  { id: 'termly', name: 'Per term', months: 3, hint: 'Billed every 3 months' },
  { id: 'annual', name: 'Annual', months: 12, hint: 'Billed once a year' },
];

// Platform-wide defaults; overridable from Settings (PlatformConfig).
export const BILLING_DEFAULTS = {
  billing_mode: 'flat',
  billing_cycle: 'monthly',
  // Discount (%) applied when a longer cycle is used — rewards paying upfront.
  termly_discount: 5,
  annual_discount: 15,
};

export const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
export const planPrice = (id) => planById(id).price;
export const cycleById = (id) => BILLING_CYCLES.find((c) => c.id === id) || BILLING_CYCLES[0];
export const modeById = (id) => BILLING_MODES.find((m) => m.id === id) || BILLING_MODES[0];

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Discount % for a cycle, honouring platform config overrides. */
export function discountFor(cycleId, config = {}) {
  if (cycleId === 'termly') return n(config.termly_discount, BILLING_DEFAULTS.termly_discount);
  if (cycleId === 'annual') return n(config.annual_discount, BILLING_DEFAULTS.annual_discount);
  return 0;
}

/**
 * Compute what a school pays.
 *
 * @param school  { subscription_plan, students, staff, status,
 *                  billing_mode?, billing_cycle?, unit_price?, custom_price? }
 * @param config  PlatformConfig row (supplies platform defaults + discounts)
 * @returns {{ mode, cycle, cycleMonths, unitPrice, units, discountPct,
 *             monthly, amount, label }}
 *          monthly = normalised monthly value (used for MRR/ARR)
 *          amount  = what is actually invoiced each cycle
 */
export function computeCharge(school = {}, config = {}) {
  const plan = planById(school.subscription_plan);
  const mode = school.billing_mode || config.billing_mode || BILLING_DEFAULTS.billing_mode;
  const cycleId = school.billing_cycle || config.billing_cycle || BILLING_DEFAULTS.billing_cycle;
  const cycle = cycleById(cycleId);

  const students = n(school.students);
  const staff = n(school.staff);

  // Units being charged for, and the per-unit monthly price.
  let units = 1;
  let unitPrice = plan.price;
  if (mode === 'per_student') {
    units = students;
    unitPrice = n(school.unit_price, plan.per_student);
  } else if (mode === 'per_person') {
    units = students + staff;
    unitPrice = n(school.unit_price, plan.per_person);
  } else {
    unitPrice = n(school.custom_price, plan.price); // flat: allow a negotiated price
  }

  const grossMonthly = unitPrice * units;
  const discountPct = discountFor(cycle.id, config);
  // The discount applies to the whole cycle invoice.
  const amount = Math.round(grossMonthly * cycle.months * (1 - discountPct / 100));
  // Normalised monthly figure so MRR stays comparable across cycles.
  const monthly = cycle.months ? Math.round(amount / cycle.months) : 0;

  return {
    mode, cycle: cycle.id, cycleMonths: cycle.months,
    unitPrice, units, discountPct, monthly, amount,
    label: `${modeById(mode).name} · ${cycle.name}`,
  };
}

/** Monthly-equivalent revenue for a school (0 unless actively paying). */
export function monthlyRevenue(school, config) {
  if (school?.status !== 'active') return 0;
  return computeCharge(school, config).monthly;
}
