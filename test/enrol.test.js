import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, allowsNamesake, duplicateError } from '../src/lib/enrolRules.js';

/**
 * Enrolment rules. These encode the school's actual policy:
 * a child is enrolled through their parents, not through an inbox of
 * their own, and every person gets a server-issued QR code.
 */

// Mirrors the shaping logic in routes/enrol.routes.js.
function shapePerson(row, { schoolId } = {}) {
  const name = (row.full_name || '').trim();
  if (!name) throw new Error('full_name is required');
  const category = (row.category || 'student').trim();
  const isStudent = category === 'student';
  const father = (row.father_email || '').trim().toLowerCase() || null;
  const mother = (row.mother_email || '').trim().toLowerCase() || null;
  if (isStudent && !father && !mother) {
    throw new Error('A student needs at least one parent email');
  }
  return {
    school_id: schoolId,
    full_name: name,
    category,
    email: isStudent ? null : ((row.email || '').trim().toLowerCase() || null),
    phone: isStudent ? null : ((row.phone || '').trim() || null),
    grade: isStudent ? (row.grade || null) : null,
    department: isStudent ? null : (row.department || null),
    father_email: father,
    mother_email: mother,
    parentsToInvite: isStudent ? [father, mother].filter(Boolean) : [],
  };
}

describe('student enrolment', () => {
  test('a child needs no email or phone of their own', () => {
    const p = shapePerson({
      full_name: 'Asake Olabode', category: 'student', grade: 'Grade 5',
      email: 'ignored@example.com', phone: '08000000000',
      mother_email: 'Mum@Example.com',
    });
    assert.equal(p.email, null, 'child email must not be stored');
    assert.equal(p.phone, null, 'child phone must not be stored');
    assert.equal(p.grade, 'Grade 5');
  });

  test('parent emails are normalised and both become invites', () => {
    const p = shapePerson({
      full_name: 'Asake Olabode', category: 'student',
      father_email: '  Dad@Example.COM ', mother_email: 'mum@example.com',
    });
    assert.equal(p.father_email, 'dad@example.com');
    assert.deepEqual(p.parentsToInvite, ['dad@example.com', 'mum@example.com']);
  });

  test('one parent email is enough', () => {
    const p = shapePerson({ full_name: 'Solo Child', category: 'student', father_email: 'dad@example.com' });
    assert.deepEqual(p.parentsToInvite, ['dad@example.com']);
  });

  test('a student with no parent email is refused', () => {
    assert.throws(
      () => shapePerson({ full_name: 'Orphan Row', category: 'student' }),
      /parent email/,
      'enrolling a child with no way to reach a parent must fail loudly'
    );
  });

  test('a nameless row is refused', () => {
    assert.throws(() => shapePerson({ category: 'student', father_email: 'd@e.com' }), /full_name/);
  });
});

describe('staff enrolment', () => {
  test('staff keep their own email and department, and invite no parents', () => {
    const p = shapePerson({
      full_name: 'Mr Bello', category: 'teacher',
      email: 'Bello@School.NG', department: 'Science', father_email: 'should@ignore.com',
    });
    assert.equal(p.email, 'bello@school.ng');
    assert.equal(p.department, 'Science');
    assert.deepEqual(p.parentsToInvite, [], 'staff must not trigger parent invites');
  });

  test('staff do not need a parent email', () => {
    assert.doesNotThrow(() => shapePerson({ full_name: 'Guard One', category: 'security' }));
  });
});

describe('bulk import', () => {
  test('a bad row fails alone and does not discard the good ones', () => {
    const rows = [
      { full_name: 'Good One', category: 'student', mother_email: 'a@b.com' },
      { full_name: '', category: 'student', mother_email: 'c@d.com' },   // no name
      { full_name: 'No Parent', category: 'student' },                    // no parent email
      { full_name: 'Good Two', category: 'teacher', email: 't@s.com' },
    ];
    const created = [];
    const failed = [];
    rows.forEach((row, i) => {
      try { created.push(shapePerson(row)); }
      catch (e) { failed.push({ row: i + 1, error: e.message }); }
    });
    assert.equal(created.length, 2);
    assert.equal(failed.length, 2);
    assert.deepEqual(failed.map((f) => f.row), [2, 3]);
  });
});

/**
 * Duplicate prevention. Bulk import happily enrolled the same child twice —
 * a second "Asake Olabode, Grade 5" with no login. Email is the primary key
 * and exact name the secondary one, which is what catches children: they have
 * no address of their own for the primary key to work with.
 */
describe('duplicate prevention', () => {
  const dupByEmail = { on: 'email', person: { full_name: 'Mr Bello' } };
  const dupByName = { on: 'name', person: { full_name: 'Asake Olabode' } };

  test('a repeated email is refused', () => {
    const err = duplicateError(dupByEmail, { name: 'M Bello', email: 'bello@grace.ng', allowNamesake: false });
    assert.match(err, /already enrolled here as Mr Bello/);
  });

  test('an email collision cannot be waved through — one address is one human', () => {
    const err = duplicateError(dupByEmail, { name: 'M Bello', email: 'bello@grace.ng', allowNamesake: true });
    assert.ok(err, 'allow_duplicate_name must not override the email key');
  });

  test('a repeated exact name is refused and says how to override', () => {
    const err = duplicateError(dupByName, { name: 'Asake Olabode', email: null, allowNamesake: false });
    assert.match(err, /allow_duplicate_name/);
  });

  test('a genuine namesake can be enrolled deliberately', () => {
    const err = duplicateError(dupByName, { name: 'Asake Olabode', email: null, allowNamesake: true });
    assert.equal(err, null);
  });

  test('nothing on the roll means nothing to block', () => {
    assert.equal(duplicateError(null, { name: 'New Child', email: null, allowNamesake: false }), null);
  });

  test('spreadsheet spacing and case do not create a second person', () => {
    assert.equal(normaliseName('  Asake   Olabode '), 'Asake Olabode');
    assert.equal(normaliseName('Asake Olabode'), normaliseName('Asake  Olabode'));
  });

  test('the override reads as text from a CSV cell, not just a boolean', () => {
    for (const yes of [true, 'true', 'TRUE', 'Yes', 'y', '1']) assert.ok(allowsNamesake(yes), String(yes));
    for (const no of [undefined, null, '', 'false', 'no', '0', 'maybe']) assert.equal(allowsNamesake(no), false, String(no));
  });
});
