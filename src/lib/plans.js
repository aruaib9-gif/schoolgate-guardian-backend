/**
 * plans.js — the subscription plan catalog, in Nigerian Naira (₦), monthly.
 * Kept identical to the Super Admin console's PLANS so billing/analytics match.
 * Plans are static config (not per-tenant data), exposed via /api/superadmin/plans.
 */
export const PLANS = [
  { id: 'trial', name: 'Trial', price: 0, color: 'gray', features: ['Up to 100 people', '1 gate', '14-day access'] },
  { id: 'basic', name: 'Basic', price: 45000, color: 'blue', features: ['Up to 500 people', '2 gates', 'Access logs & attendance'] },
  { id: 'premium', name: 'Premium', price: 120000, color: 'violet', features: ['Up to 2,000 people', 'Unlimited gates', 'Bus tracking, CRM, reports'] },
  { id: 'enterprise', name: 'Enterprise', price: 280000, color: 'green', features: ['Unlimited people', 'Multi-campus', 'Priority support & SLA'] },
];

export const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
export const planPrice = (id) => planById(id).price;
