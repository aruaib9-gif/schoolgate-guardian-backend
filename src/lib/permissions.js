import { prisma } from './prisma.js';
import { ADMIN_ROLES } from '../middleware/auth.js';
import { ACTION_MAP } from './registry.js';
import { forbidden } from '../middleware/error.js';

// Cache RolePermissions rows briefly to avoid a DB hit on every request.
const CACHE_TTL_MS = 15_000;
const cache = new Map(); // key: `${school_id||''}:${role}` -> { at, perms }

export async function loadPermissions(role, schoolId) {
  const key = `${schoolId || ''}:${role}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.perms;

  // Prefer a school-scoped row, then a global (school_id null) row.
  let row = null;
  if (schoolId) {
    row = await prisma.rolePermissions.findFirst({ where: { role_name: role, school_id: schoolId, is_active: true } });
  }
  if (!row) {
    row = await prisma.rolePermissions.findFirst({ where: { role_name: role, school_id: null, is_active: true } });
  }
  const perms = row ? row.permissions : null;
  cache.set(key, { at: Date.now(), perms });
  return perms;
}

export function clearPermissionCache() {
  cache.clear();
}

/**
 * Enforce role-based access for an entity action.
 *  - Service (cron) requests and admin roles are always allowed.
 *  - Entities with no resource mapping are open to any authenticated user.
 *  - When a RolePermissions row exists for the role, it is enforced.
 *  - When no row exists, access is allowed (permissive fallback) so a fresh
 *    install without seeded permissions is still usable.
 *
 * A grant is normally `true`, meaning every record of that resource. It may
 * instead be the string 'own', meaning only the records this person created —
 * which is how a teacher can issue a guest pass and follow it up without
 * being able to read the passes every other member of staff issued. The
 * decision is recorded on the request as `req.permissionScope` ('all' | 'own')
 * and enforced by applyOwnerScope / ownerBlock below; asserting permission
 * alone is NOT enough for an 'own' grant.
 *
 * 'all' always wins over 'own', so holding two roles can only widen access,
 * never narrow it.
 */
export async function assertPermission(req, meta, action) {
  req.permissionScope = 'all';
  if (req.isService) return;
  const roles = req.roles?.length ? req.roles : [req.role];
  if (roles.some((r) => ADMIN_ROLES.has(r))) return;
  const resource = meta.resource;
  if (!resource) return; // unmapped entity — allow authenticated access

  const allowedActions = ACTION_MAP[action] || [action];

  // Permissions are the UNION across every role the account holds: a teacher
  // who also runs the bus gets both sets.
  const rows = [];
  for (const role of roles) rows.push(await loadPermissions(role, req.user?.school_id));
  const sawConfig = rows.some(Boolean);

  const grant = resolveGrant(rows, resource, allowedActions);
  if (grant === 'all') return;
  if (grant === 'own' || grant === 'self') { req.permissionScope = grant; return; }

  // No row configured for any role — permissive fallback, so a fresh install
  // without seeded permissions is still usable.
  if (!sawConfig) return;

  throw forbidden(`Role${roles.length > 1 ? 's' : ''} "${roles.join(', ')}" not permitted to ${action} ${resource}`);
}

/**
 * What a set of permission rows grants for one action: 'all', 'own', or null
 * for nothing. Pure, so the rule itself can be tested without a database.
 *
 * 'all' wins wherever it appears, so a second role can only ever widen access.
 */
export function resolveGrant(rows, resource, allowedActions) {
  let narrow = null;
  for (const perms of rows) {
    if (!perms) continue;
    const resourcePerms = perms[resource];
    if (!resourcePerms) continue;
    for (const a of allowedActions) {
      const v = resourcePerms[a];
      if (v === true) return 'all';
      // 'own' and 'self' answer different questions — who made the record, and
      // who it is about — so neither contains the other. A role configured
      // with both gets 'own', the narrower of the two in practice, because a
      // person creates far fewer records than they appear in.
      if (v === 'own') narrow = 'own';
      else if (v === 'self' && narrow !== 'own') narrow = 'self';
    }
  }
  return narrow;
}

/**
 * The people a request may see records ABOUT: the person behind the login, plus
 * any children they are named as a parent of.
 *
 * Returns ids, never an empty filter. A login attached to no person and no
 * children must match nothing — an empty `in` list does exactly that, whereas
 * dropping the filter would show them everything.
 */
export async function subjectIdsFor(req) {
  // Several scopes may run for one request — a list and then a single record.
  // Resolve the children once.
  if (req._subjectIds) return req._subjectIds;

  const ids = new Set();
  if (req.user?.person_id) ids.add(req.user.person_id);

  const email = req.user?.email;
  if (email) {
    const children = await prisma.person.findMany({
      where: {
        ...(req.user.school_id ? { school_id: req.user.school_id } : {}),
        OR: [{ father_email: email }, { mother_email: email }],
      },
      select: { id: true },
    });
    for (const c of children) ids.add(c.id);
  }
  req._subjectIds = [...ids];
  return req._subjectIds;
}

/**
 * Narrow a query to records about this person and their children.
 *
 * Refused rather than widened for a model that records no subject: a 'self'
 * grant over something that is about nobody cannot mean anything, and
 * returning the query unchanged would hand over every row.
 */
export async function applySelfScope(req, meta, where) {
  if (req.permissionScope !== 'self') return where;
  if (!meta.subjectField) {
    throw forbidden(`${meta.name} cannot be limited to your own records.`);
  }
  const ids = await subjectIdsFor(req);
  return { AND: [where, { [meta.subjectField]: { in: ids } }] };
}

/** The single-record counterpart of applySelfScope. */
export async function selfBlock(req, meta, record) {
  if (req.permissionScope !== 'self') return false;
  if (!meta.subjectField || !record) return true;
  const ids = await subjectIdsFor(req);
  return !ids.includes(record[meta.subjectField]);
}

/**
 * One entry point for both narrow scopes, so a caller cannot enforce one and
 * forget the other.
 */
export async function applyRecordScope(req, meta, where) {
  if (req.permissionScope === 'own') return applyOwnerScope(req, meta, where);
  if (req.permissionScope === 'self') return applySelfScope(req, meta, where);
  return where;
}

export async function recordBlock(req, meta, record) {
  if (req.permissionScope === 'own') return ownerBlock(req, meta, record);
  if (req.permissionScope === 'self') return selfBlock(req, meta, record);
  return false;
}

/**
 * Narrow a query to the records this person created, when their grant was
 * 'own' rather than full.
 *
 * Refuses rather than widens when it cannot be enforced. An entity with no
 * created_by column has no notion of who made a record, so an 'own' grant on
 * it cannot mean anything — returning the unfiltered query there would hand
 * over every row, which is the opposite of what was granted.
 */
export function applyOwnerScope(req, meta, where) {
  if (req.permissionScope !== 'own') return where;
  if (!meta.hasCreatedBy) {
    throw forbidden(`${meta.name} cannot be limited to your own records.`);
  }
  const mine = req.user?.email;
  if (!mine) throw forbidden('Your account has no email, so your own records cannot be identified.');
  return { AND: [where, { created_by: mine }] };
}

/**
 * The single-record counterpart: true when this record is not the person's to
 * see or change under an 'own' grant. Mirrors tenantBlock, and is deliberately
 * answered with "not found" by callers rather than "forbidden" — whether
 * somebody else's pass exists is itself not their business.
 */
export function ownerBlock(req, meta, record) {
  if (req.permissionScope !== 'own') return false;
  if (!meta.hasCreatedBy) return true;
  const mine = req.user?.email;
  return !mine || !record || record.created_by !== mine;
}
