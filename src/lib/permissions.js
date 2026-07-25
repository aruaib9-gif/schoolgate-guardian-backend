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
  const role = req.role;
  if (ADMIN_ROLES.has(role)) return;
  const resource = meta.resource;
  if (!resource) return; // unmapped entity — allow authenticated access

  const perms = await loadPermissions(role, req.user?.school_id);
  if (!perms) return; // no configured permissions — permissive fallback

  const resourcePerms = perms[resource];
  if (!resourcePerms) throw forbidden(`Role "${role}" has no access to ${resource}`);

  const allowedActions = ACTION_MAP[action] || [action];
  const granted = allowedActions.some((a) => resourcePerms[a] === true);
  if (!granted) {
    throw forbidden(`Role "${role}" is not permitted to ${action} ${resource}`);
  }
}
