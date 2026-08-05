/**
 * Core invariants — the things that must never silently regress:
 * tenant isolation, billing math, webhook signatures, email rendering.
 * Runs with the built-in node:test runner (no DB, no network).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'test';

const { applyTenantScope, tenantBlock } = await import('../src/lib/tenant.js');
const { computeCharge, planById } = await import('../src/lib/plans.js');
const { webhookMode } = await import('../src/lib/paystack.js');
const { welcomeInvite, invoiceEmail, passwordReset } = await import('../src/lib/emailTemplates.js');
const { verifyPassword } = await import('../src/lib/auth.js');

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------
const rpMeta = { name: 'RolePermissions', hasSchoolId: true };
const personMeta = { name: 'Person', hasSchoolId: true };
const schoolMeta = { name: 'School', hasSchoolId: false };
const admin = { role: 'admin', user: { school_id: 'sch1' } };
const superadmin = { role: 'superadmin', user: {} };

test('school admin cannot modify global role defaults', () => {
  assert.equal(tenantBlock(admin, rpMeta, { school_id: null }, { forWrite: true }), 'forbidden');
});

test('school admin can modify their own school role override', () => {
  assert.equal(tenantBlock(admin, rpMeta, { school_id: 'sch1' }, { forWrite: true }), null);
});

test('another school\'s records are invisible, not just forbidden', () => {
  assert.equal(tenantBlock(admin, rpMeta, { school_id: 'sch2' }, { forWrite: true }), 'notfound');
  assert.equal(tenantBlock(admin, personMeta, { school_id: 'sch2' }, { forWrite: true }), 'notfound');
});

test('global role defaults stay readable to school admins', () => {
  assert.equal(tenantBlock(admin, rpMeta, { school_id: null }), null);
});

test('superadmin is unrestricted', () => {
  assert.equal(tenantBlock(superadmin, rpMeta, { school_id: null }, { forWrite: true }), null);
  assert.equal(tenantBlock(superadmin, personMeta, { school_id: 'anything' }, { forWrite: true }), null);
});

test('list scoping: school admin sees own school + global role rows only', () => {
  assert.deepEqual(applyTenantScope(admin, rpMeta, {}), { OR: [{ school_id: 'sch1' }, { school_id: null }] });
});

test('list scoping: ordinary entities are hard-scoped to the school', () => {
  assert.deepEqual(applyTenantScope(admin, personMeta, {}), { school_id: 'sch1' });
});

test('school admin listing School is pinned to their own school id', () => {
  assert.deepEqual(applyTenantScope(admin, { name: 'School', hasSchoolId: false }, {}), { id: 'sch1' });
});

// ---------------------------------------------------------------------------
// Billing math
// ---------------------------------------------------------------------------
test('flat billing uses the plan price', () => {
  const c = computeCharge({ subscription_plan: 'premium' }, {});
  assert.equal(c.amount, planById('premium').price);
  assert.equal(c.monthly, planById('premium').price);
});

test('negotiated flat price overrides the catalog', () => {
  const c = computeCharge({ subscription_plan: 'premium', custom_price: 90000 }, {});
  assert.equal(c.amount, 90000);
});

test('per-student billing multiplies by student count', () => {
  const c = computeCharge({ subscription_plan: 'basic', billing_mode: 'per_student', students: 200 }, {});
  assert.equal(c.amount, 200 * planById('basic').per_student);
});

test('annual cycle applies the discount over 12 months', () => {
  const cfg = { annual_discount: 10 };
  const c = computeCharge({ subscription_plan: 'basic', billing_cycle: 'annual' }, cfg);
  assert.equal(c.amount, Math.round(planById('basic').price * 12 * 0.9));
  assert.equal(c.cycleMonths, 12);
});

// ---------------------------------------------------------------------------
// Paystack webhook signatures
// ---------------------------------------------------------------------------
test('webhook mode resolves live vs test vs invalid', () => {
  process.env_backup = undefined;
  const body = Buffer.from(JSON.stringify({ event: 'charge.success' }));
  const sign = (key) => createHmac('sha512', key).update(body).digest('hex');
  // env module was loaded with whatever keys exist; simulate directly:
  const { env } = awaitEnv();
  env.paystackSecretKey = 'sk_live_unit';
  env.paystackTestSecretKey = 'sk_test_unit';
  assert.equal(webhookMode(body, sign('sk_live_unit')), 'live');
  assert.equal(webhookMode(body, sign('sk_test_unit')), 'test');
  assert.equal(webhookMode(body, sign('sk_wrong')), null);
  assert.equal(webhookMode(body, undefined), null);
});

function awaitEnv() {
  // env is already imported by the modules above; require it synchronously.
  return { env: envRef };
}
const { env: envRef } = await import('../src/config/env.js');

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
test('invite email carries credentials only when a temp password exists', () => {
  const withPw = welcomeInvite({ name: 'A', email: 'a@x.com', link: 'https://x', expiresAt: new Date(), tempPassword: 'tmp12345' });
  assert.ok(withPw.html.includes('tmp12345'));
  assert.ok(withPw.body.includes('tmp12345'));
  const noPw = welcomeInvite({ name: 'A', email: 'a@x.com', link: 'https://x', expiresAt: new Date() });
  assert.ok(!noPw.html.includes('Temporary password'));
});

test('invite email does not leak the inviter or role', () => {
  const m = welcomeInvite({ name: 'A', email: 'a@x.com', link: 'https://x', expiresAt: new Date(), roleLabel: 'SECRET_ROLE', invitedBy: 'boss@x.com' });
  assert.ok(!m.html.includes('SECRET_ROLE'));
  assert.ok(!m.html.includes('boss@x.com'));
});

test('invoice email escapes HTML in school names', () => {
  const m = invoiceEmail({ schoolName: '<img src=x>', planName: 'Basic', amount: 1000, periodLabel: 'Aug', payUrl: 'https://x', invoiceId: 'abc' });
  assert.ok(!m.html.includes('<img src=x>'));
});

test('reset email includes the raw link in plaintext fallback', () => {
  const m = passwordReset({ name: 'A', email: 'a@x.com', link: 'https://x/reset?t=1', expiresAt: new Date() });
  assert.ok(m.body.includes('https://x/reset?t=1'));
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
test('verifyPassword safely rejects accounts with no password hash', async () => {
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('anything', undefined), false);
});
