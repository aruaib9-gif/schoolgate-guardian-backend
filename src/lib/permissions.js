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
 */
export async function assertPermission(req, meta, action) {
  if (req.isService) return;
  const roles = req.roles?.length ? req.roles : [req.role];
  if (roles.some((r) => ADMIN_ROLES.has(r))) return;
  const resource = meta.resource;
  if (!resource) return; // unmapped entity — allow authenticated access

  const allowedActions = ACTION_MAP[action] || [action];

  // Permissions are the UNION across every role the account holds: a teacher
  // who also runs the bus gets both sets. Any single role granting the action
  // is enough.
  let sawConfig = false;
  for (const role of roles) {
    const perms = await loadPermissions(role, req.user?.school_id);
    if (!perms) continue; // this role has no configured row
    sawConfig = true;
    const resourcePerms = perms[resource];
    if (!resourcePerms) continue;
    if (allowedActions.some((a) => resourcePerms[a] === true)) return;
  }

  // No row configured for any role — permissive fallback, so a fresh install
  // without seeded permissions is still usable.
  if (!sawConfig) return;

  throw forbidden(`Role${roles.length > 1 ? 's' : ''} "${roles.join(', ')}" not permitted to ${action} ${resource}`);
}
