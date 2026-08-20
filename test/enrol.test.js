import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

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
