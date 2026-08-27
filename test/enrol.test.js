import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseName, allowsNamesake, duplicateError, findExisting } from '../src/lib/enrolRules.js';

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
    assert.equal(err.code, 'duplicate_email');
    assert.match(err.message, /already enrolled here as Mr Bello/);
  });

  test('an email collision cannot be waved through — one address is one human', () => {
    const err = duplicateError(dupByEmail, { name: 'M Bello', email: 'bello@grace.ng', allowNamesake: true });
    assert.ok(err, 'allow_duplicate_name must not override the email key');
  });

  test('a repeated exact name is refused, with a code the caller can act on', () => {
    const err = duplicateError(dupByName, { name: 'Asake Olabode', email: null, allowNamesake: false });
    assert.equal(err.code, 'duplicate_name');
    assert.match(err.message, /already enrolled/);
  });

  test('the name message never tells a form user to edit a spreadsheet column', () => {
    const err = duplicateError(dupByName, { name: 'Asake Olabode', email: null, allowNamesake: false });
    assert.doesNotMatch(err.message, /allow_duplicate_name|row|column|spreadsheet/i);
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

/**
 * Siblings. A family with several children at the school uses one address for
 * all of them — the parent email is deliberately not an identity key, and a
 * regression here would stop a real family enrolling their second child.
 */
describe('a parent email may be reused for every child in the family', () => {
  const school = 's1';
  const roll = [{ id: 'p1', school_id: school, full_name: 'Tunde Adeyemi', email: null }];
  const prisma = {
    person: {
      async findFirst({ where }) {
        return roll.find((p) => {
          if (where.school_id !== undefined && p.school_id !== where.school_id) return false;
          if (where.email?.equals !== undefined) return (p.email || '').toLowerCase() === String(where.email.equals).toLowerCase();
          if (where.full_name?.equals !== undefined) return p.full_name.toLowerCase() === String(where.full_name.equals).toLowerCase();
          return false;
        }) || null;
      },
    },
  };

  const check = async (fullName) => {
    const name = normaliseName(fullName);
    // A student has no email of their own, which is the whole point.
    const dup = await findExisting(prisma, school, { email: null, name });
    return duplicateError(dup, { name, email: null, allowNamesake: false });
  };

  test('a second child of the same parents enrols', async () => {
    assert.equal(await check('Bisi Adeyemi'), null);
  });

  test('a third child of the same parents enrols', async () => {
    assert.equal(await check('Chidi Adeyemi'), null);
  });

  test('the lookup never consults a parent email', async () => {
    // If father_email were ever added as a key, this would start matching.
    const dup = await findExisting(prisma, school, { email: 'here2there.ng@gmail.com', name: 'Bisi Adeyemi' });
    assert.equal(dup, null, 'a parent address must not identify a child');
  });

  test('the same child entered twice is still caught', async () => {
    const err = await check('Tunde  Adeyemi');
    assert.equal(err.code, 'duplicate_name');
  });
});
