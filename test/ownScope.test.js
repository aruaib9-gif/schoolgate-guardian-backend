/**
 * The 'own' grant: a role that may create records of a resource and then see
 * only the ones it created.
 *
 * This is access control, so the cases that matter are the refusals — another
 * person's record must be invisible on every path, and a grant that cannot be
 * enforced must deny rather than fall back to showing everything.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { resolveGrant, applyOwnerScope, ownerBlock, applySelfScope, selfBlock } = await import('../src/lib/permissions.js');
const { ROLE_PRESETS } = await import('../src/lib/rolePresets.js');

const ALL = { guest_passes: { view: true, create: true, edit: true, delete: true } };
const OWN = { guest_passes: { view: 'own', create: true, edit: 'own', delete: false } };
const NONE = { guest_passes: { view: false, create: false, edit: false, delete: false } };

describe('what a set of permission rows grants', () => {
  test('a full grant is "all"', () => {
    assert.equal(resolveGrant([ALL], 'guest_passes', ['view']), 'all');
  });

  test('an own grant is "own"', () => {
    assert.equal(resolveGrant([OWN], 'guest_passes', ['view']), 'own');
  });

  test('no grant is nothing', () => {
    assert.equal(resolveGrant([NONE], 'guest_passes', ['view']), null);
    assert.equal(resolveGrant([{}], 'guest_passes', ['view']), null);
    assert.equal(resolveGrant([null], 'guest_passes', ['view']), null);
  });

  /** Holding a second role may widen access. It must never narrow it. */
  test('a full grant from any role beats an own grant from another', () => {
    assert.equal(resolveGrant([OWN, ALL], 'guest_passes', ['view']), 'all');
    assert.equal(resolveGrant([ALL, OWN], 'guest_passes', ['view']), 'all');
  });

  test('creating is a plain grant even when reading is limited to your own', () => {
    assert.equal(resolveGrant([OWN], 'guest_passes', ['create']), 'all');
  });

  test('an action the role does not hold is refused', () => {
    assert.equal(resolveGrant([OWN], 'guest_passes', ['delete']), null);
  });

  test('a different resource is unaffected', () => {
    assert.equal(resolveGrant([OWN], 'people', ['view']), null);
  });
});

const meta = { name: 'GuestPass', resource: 'guest_passes', hasCreatedBy: true };
const metaNoOwner = { name: 'Thing', resource: 'guest_passes', hasCreatedBy: false };
const reqOwn = { permissionScope: 'own', user: { email: 'teacher@grace.ng' } };
const reqAll = { permissionScope: 'all', user: { email: 'admin@grace.ng' } };

describe('narrowing a query to your own records', () => {
  test('a full grant is left alone', () => {
    const where = { school_id: 'sch1' };
    assert.deepEqual(applyOwnerScope(reqAll, meta, where), where);
  });

  test('an own grant is filtered by who created the record', () => {
    assert.deepEqual(
      applyOwnerScope(reqOwn, meta, { school_id: 'sch1' }),
      { AND: [{ school_id: 'sch1' }, { created_by: 'teacher@grace.ng' }] }
    );
  });

  /**
   * The important one. Without a created_by column there is no way to tell
   * whose record is whose, so returning the query unchanged would hand over
   * every row — turning the narrowest grant into the widest.
   */
  test('an entity with no owner column is refused, not widened', () => {
    assert.throws(() => applyOwnerScope(reqOwn, metaNoOwner, {}), { status: 403 });
  });

  test('an account with no email is refused', () => {
    assert.throws(() => applyOwnerScope({ permissionScope: 'own', user: {} }, meta, {}), { status: 403 });
  });
});

describe('a single record under an own grant', () => {
  const mine = { id: 'p1', created_by: 'teacher@grace.ng' };
  const theirs = { id: 'p2', created_by: 'someone.else@grace.ng' };

  test('my own record is allowed', () => {
    assert.equal(ownerBlock(reqOwn, meta, mine), false);
  });

  test("another person's record is blocked", () => {
    assert.equal(ownerBlock(reqOwn, meta, theirs), true);
  });

  test('a record created by nobody is blocked', () => {
    assert.equal(ownerBlock(reqOwn, meta, { id: 'p3', created_by: null }), true);
  });

  test('a full grant sees everything', () => {
    assert.equal(ownerBlock(reqAll, meta, theirs), false);
  });

  test('no owner column blocks rather than allows', () => {
    assert.equal(ownerBlock(reqOwn, metaNoOwner, mine), true);
  });
});

const SELF = { access_logs: { view: 'self', create: false, export: false, correct: false } };
const logMeta = { name: 'AccessLog', resource: 'access_logs', subjectField: 'person_id', hasCreatedBy: true };
const noSubject = { name: 'PlatformConfig', resource: 'access_logs', subjectField: null, hasCreatedBy: true };

describe('records about you, rather than records you made', () => {
  test('a self grant resolves to "self"', () => {
    assert.equal(resolveGrant([SELF], 'access_logs', ['view']), 'self');
  });

  test('a full grant still wins', () => {
    assert.equal(resolveGrant([SELF, { access_logs: { view: true } }], 'access_logs', ['view']), 'all');
  });

  /**
   * The distinction this whole scope exists for. A gate log's created_by is the
   * guard who scanned; its person_id is the child who walked through. Scoping a
   * parent's logs by created_by would show them every child that guard scanned
   * and none of their own.
   */
  test('own and self are different questions, and own is preferred when both are set', () => {
    const both = { access_logs: { view: 'self' }, guest_passes: { view: 'own' } };
    assert.equal(resolveGrant([both], 'access_logs', ['view']), 'self');
    assert.equal(resolveGrant([both], 'guest_passes', ['view']), 'own');
    const conflicting = [{ access_logs: { view: 'self' } }, { access_logs: { view: 'own' } }];
    assert.equal(resolveGrant(conflicting, 'access_logs', ['view']), 'own');
  });

  test('a full grant is left unscoped', async () => {
    const where = { school_id: 'sch1' };
    assert.deepEqual(await applySelfScope({ permissionScope: 'all' }, logMeta, where), where);
  });

  /**
   * A login attached to no person and named against no child must see nothing.
   * An empty `in` list matches no rows; dropping the filter would match all of
   * them, which is the failure that matters here.
   */
  test('a login with no person and no children matches nothing, not everything', async () => {
    // _subjectIds is the per-request cache; setting it keeps this test off the
    // database, which the rest of the suite also avoids.
    const req = { permissionScope: 'self', user: { email: 'nobody@grace.ng' }, _subjectIds: [] };
    const out = await applySelfScope(req, logMeta, { school_id: 'sch1' });
    const filter = out.AND[1].person_id;
    assert.deepEqual(filter, { in: [] }, 'an empty id list is what makes this safe');
  });

  test('a model that records no subject is refused, not widened', async () => {
    const req = { permissionScope: 'self', user: { person_id: 'p1' }, _subjectIds: ['p1'] };
    await assert.rejects(() => applySelfScope(req, noSubject, {}), { status: 403 });
    assert.equal(await selfBlock(req, noSubject, { id: 'x' }), true);
  });

  test("a record about someone else is blocked, one about you is not", async () => {
    const req = { permissionScope: 'self', user: { person_id: 'p1' }, _subjectIds: ['p1', 'child1'] };
    assert.equal(await selfBlock(req, logMeta, { person_id: 'p1' }), false);
    assert.equal(await selfBlock(req, logMeta, { person_id: 'child1' }), false, "a parent sees their child's log");
    assert.equal(await selfBlock(req, logMeta, { person_id: 'p2' }), true);
    assert.equal(await selfBlock(req, logMeta, null), true);
  });

  test('a full grant blocks nothing', async () => {
    assert.equal(await selfBlock({ permissionScope: 'all' }, logMeta, { person_id: 'anyone' }), false);
  });
});

/**
 * The seeded presets. Imported directly now that they live in their own
 * module — prisma/seed.js seeds a live database the moment it is imported, so
 * this used to pick the two pure pieces out of its source with a regex.
 */
describe('the seeded role presets', () => {
  test('a teacher may issue a pass but only read their own', () => {
    const gp = ROLE_PRESETS.teacher.permissions.guest_passes;
    assert.equal(gp.create, true, 'a teacher must be able to issue one');
    assert.equal(gp.view, 'own', 'and see only the ones they issued');
    assert.equal(gp.edit, 'own', 'and cancel their own');
    assert.equal(gp.delete, false, 'cancelling is an edit — deleting would erase the record');
  });

  test('a teacher sees their own gate history, not the school\'s', () => {
    assert.equal(ROLE_PRESETS.teacher.permissions.access_logs.view, 'self');
  });

  /**
   * The roster used to go to every parent's device in full and be filtered on
   * the handset. If either of these returns to a plain `true`, every parent can
   * list every child in the school again.
   */
  test('a parent is scoped to their own family', () => {
    const p = ROLE_PRESETS.parent.permissions;
    assert.equal(p.people.view, 'self', 'not the whole roster');
    assert.equal(p.access_logs.view, 'self', "their children's movements, nobody else's");
    assert.equal(p.guest_passes.view, 'own', 'the passes they issued, not the school\'s');
    assert.equal(p.guest_passes.create, true);
  });

  test('a student sees only themselves', () => {
    const p = ROLE_PRESETS.student.permissions;
    assert.equal(p.people.view, 'self');
    assert.equal(p.access_logs.view, 'self');
  });

  test('an administrator is still unrestricted', () => {
    const p = ROLE_PRESETS.admin.permissions;
    assert.equal(p.people.view, true);
    assert.equal(p.access_logs.view, true);
    assert.equal(p.guest_passes.view, true);
  });

  test('every grant is a boolean or one of the two narrow scopes', () => {
    for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
      for (const [resource, actions] of Object.entries(preset.permissions)) {
        for (const [action, value] of Object.entries(actions)) {
          assert.ok(
            value === true || value === false || value === 'own' || value === 'self',
            `${role}.${resource}.${action} is ${JSON.stringify(value)} — anything else is enforced as a refusal`
          );
        }
      }
    }
  });
});
