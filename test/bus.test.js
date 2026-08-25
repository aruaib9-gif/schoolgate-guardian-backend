import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clearFromOtherBuses } from '../src/lib/busRules.js';

/**
 * A child rides one bus at a time. Boarding is a plain entity update from
 * whichever device is scanning, so without this rule two bus admins could each
 * add the same child and neither would know.
 */
function fakePrisma(buses) {
  return {
    schoolBus: {
      async findMany({ where, select }) {  // eslint-disable-line no-unused-vars
        return buses.filter((b) => {
          if (where.id?.not && b.id === where.id.not) return false;
          if (where.school_id && b.school_id !== where.school_id) return false;
          const need = where.assigned_student_ids?.hasSome || [];
          return need.some((id) => b.assigned_student_ids.includes(id));
        }).map((b) => ({ ...b }));
      },
      async update({ where, data }) {
        const b = buses.find((x) => x.id === where.id);
        Object.assign(b, data);
        return b;
      },
    },
  };
}

const bus = (id, name, students, school = 's1') =>
  ({ id, bus_name: name, bus_number: null, school_id: school, assigned_student_ids: students });

describe('one child, one bus', () => {
  test('boarding removes the child from the bus they were on', async () => {
    const buses = [bus('b1', 'Ajah', ['kid1']), bus('b2', 'Lekki', [])];
    const p = fakePrisma(buses);
    const moved = await clearFromOtherBuses(p, { busId: 'b2', schoolId: 's1', studentIds: ['kid1'] });
    assert.deepEqual(buses[0].assigned_student_ids, [], 'left the old bus');
    assert.equal(moved[0].bus_name, 'Ajah');
    assert.deepEqual(moved[0].student_ids, ['kid1']);
  });

  test('other passengers on the old bus are left alone', async () => {
    const buses = [bus('b1', 'Ajah', ['kid1', 'kid2', 'kid3']), bus('b2', 'Lekki', [])];
    await clearFromOtherBuses(fakePrisma(buses), { busId: 'b2', schoolId: 's1', studentIds: ['kid2'] });
    assert.deepEqual(buses[0].assigned_student_ids, ['kid1', 'kid3']);
  });

  test('re-saving the same bus does not empty it', async () => {
    const buses = [bus('b1', 'Ajah', ['kid1'])];
    const moved = await clearFromOtherBuses(fakePrisma(buses), { busId: 'b1', schoolId: 's1', studentIds: ['kid1'] });
    assert.deepEqual(buses[0].assigned_student_ids, ['kid1'], 'a bus never strips its own passengers');
    assert.equal(moved.length, 0);
  });

  test('another school keeps its own buses', async () => {
    const buses = [bus('b1', 'Ajah', ['kid1'], 's2'), bus('b2', 'Lekki', [], 's1')];
    await clearFromOtherBuses(fakePrisma(buses), { busId: 'b2', schoolId: 's1', studentIds: ['kid1'] });
    assert.deepEqual(buses[0].assigned_student_ids, ['kid1'], 'a different school is not touched');
  });

  test('a child on no other bus is not a transfer', async () => {
    const buses = [bus('b1', 'Ajah', ['kid9'])];
    const moved = await clearFromOtherBuses(fakePrisma(buses), { busId: 'b2', schoolId: 's1', studentIds: ['kid1'] });
    assert.deepEqual(moved, []);
  });

  test('clearing a bus to empty touches nothing', async () => {
    const buses = [bus('b1', 'Ajah', ['kid1'])];
    const moved = await clearFromOtherBuses(fakePrisma(buses), { busId: 'b2', schoolId: 's1', studentIds: [] });
    assert.deepEqual(moved, []);
    assert.deepEqual(buses[0].assigned_student_ids, ['kid1']);
  });
});
