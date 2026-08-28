import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateId, planData } from '../src/lib/planAdmin.js';
import { setCatalog, getPlans, planById, computeCharge, DEFAULT_PLANS } from '../src/lib/plans.js';

const FEATURE_IDS = new Set(['access_logs', 'people', 'attendance', 'passes', 'bus']);
const shape = (body) => planData(body, { validFeatureIds: FEATURE_IDS });

/**
 * The package catalog. It used to be a hardcoded constant, so these cover the
 * things that make editing it safe rather than dangerous.
 */
describe('package ids', () => {
  test('a sensible id is accepted', () => {
    assert.equal(validateId('standard_termly').key, 'standard_termly');
  });
  test('ids are lowercased', () => {
    assert.equal(validateId('Standard').key, 'standard');
  });
  for (const bad of ['', '9lives', 'has space', 'Has-Dash', 'x', 'a'.repeat(40)]) {
    test(`"${bad}" is refused`, () => assert.ok(validateId(bad).error));
  }
});

describe('package fields', () => {
  test('a name is required', () => {
    assert.match(shape({ name: '  ' }).error, /name/i);
  });
  test('prices are coerced to whole numbers, never negative', () => {
    const { data } = shape({ name: 'X', price: '45000.7', per_student: -50 });
    assert.equal(data.price, 45001);
    assert.equal(data.per_student, 0);
  });
  test('an empty cap means unlimited, which is not the same as zero', () => {
    const { data } = shape({ name: 'X', limit_people: '', limit_gates: 0 });
    assert.equal(data.limit_people, null, 'blank = unlimited');
    assert.equal(data.limit_gates, 0, 'zero = actually zero');
  });
  test('a package cannot promise a feature the product does not have', () => {
    assert.match(shape({ name: 'X', entitlements: ['bus', 'teleportation'] }).error, /teleportation/);
  });
  test('real features pass through', () => {
    assert.deepEqual(shape({ name: 'X', entitlements: ['bus', 'people'] }).data.entitlements, ['bus', 'people']);
  });
  test('marketing bullets accept a textarea', () => {
    assert.deepEqual(shape({ name: 'X', features: 'One\n\nTwo\n' }).data.features, ['One', 'Two']);
  });
});

describe('the live catalog', () => {
  test('an empty table falls back rather than pricing everything at zero', () => {
    setCatalog([]);
    assert.equal(getPlans().length, DEFAULT_PLANS.length);
    assert.ok(planById('basic').price > 0);
  });

  test('a custom package prices a school', () => {
    setCatalog([
      { id: 'termly', name: 'Termly', price: 0, per_student: 1500, per_person: 0,
        features: [], entitlements: ['people'], limit_people: null, limit_gates: null, sort_order: 0, is_active: true },
    ]);
    const charge = computeCharge(
      { subscription_plan: 'termly', students: 400, billing_mode: 'per_student', billing_cycle: 'termly' },
      { termly_discount: 0 }
    );
    // 400 students × ₦1,500/month × 3 months
    assert.equal(charge.amount, 1_800_000);
    assert.equal(charge.units, 400);
    assert.equal(charge.unitPrice, 1500);
  });

  test("a school's negotiated price still beats the package", () => {
    setCatalog([{ id: 'basic', name: 'Basic', price: 45000, per_student: 0, per_person: 0,
      features: [], entitlements: [], limit_people: null, limit_gates: null, sort_order: 0, is_active: true }]);
    const charge = computeCharge(
      { subscription_plan: 'basic', billing_mode: 'flat', billing_cycle: 'monthly', custom_price: 30000 }, {}
    );
    assert.equal(charge.amount, 30000, 'the override wins');
  });

  test('an unknown package falls back instead of throwing', () => {
    setCatalog(DEFAULT_PLANS.map((p) => ({ ...p, limit_people: null, limit_gates: null })));
    assert.ok(planById('no_such_package'));
  });
});
