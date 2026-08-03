import { ADMIN_ROLES } from '../middleware/auth.js';

// Roles allowed to see across all schools (platform-level operators).
const CROSS_TENANT_ROLES = new Set(['superadmin', 'head_of_schools']);

/**
 * Merge a tenant constraint into a where clause for tenant-scoped entities.
 * Cross-tenant roles (superadmin) are unrestricted. Everyone else is limited
 * to their own school_id when they have one.
 */
export function applyTenantScope(req, meta, where = {}) {
  const role = req.role;
  if (req.isService) return where;
  if (CROSS_TENANT_ROLES.has(role)) return where;
  const schoolId = req.user?.school_id;
  if (!schoolId) return where; // user has no school yet — no extra constraint

  // A School row carries no school_id — its own id IS the tenant key. Without
  // this it fell through the hasSchoolId check below, so any school admin
  // could list every school on the platform.
  if (meta.name === 'School') return { ...where, id: schoolId };

  if (!meta.hasSchoolId) return where;

  // Role definitions: a school sees the platform defaults (school_id null)
  // alongside its own overrides — the defaults are what an admin customises
  // FROM, so they must stay readable.
  if (meta.name === 'RolePermissions') {
    return { ...where, OR: [{ school_id: schoolId }, { school_id: null }] };
  }

  // If the caller already filtered by a different school, keep the intersection
  // (their own school wins for isolation).
  return { ...where, school_id: schoolId };
}

/**
 * Guard for reads/mutations of a single record by a school-scoped user.
 * Returns null when allowed, 'notfound' when the record belongs to another
 * school, or 'forbidden' when it is a shared platform default that scoped
 * users may read but never modify.
 */
export function tenantBlock(req, meta, existing, { forWrite = false } = {}) {
  if (req.isService || CROSS_TENANT_ROLES.has(req.role)) return null;
  const schoolId = req.user?.school_id;
  if (!schoolId) return null;
  if (meta.name === 'School') return existing.id === schoolId ? null : 'notfound';
  if (!meta.hasSchoolId) return null;
  if (existing.school_id && existing.school_id !== schoolId) return 'notfound';
  // Global RolePermissions rows are the platform-wide defaults. Editing one
  // would change every school at once — school admins must create their own
  // school-scoped override instead (the mobile app does this automatically).
  if (forWrite && meta.name === 'RolePermissions' && !existing.school_id) return 'forbidden';
  return null;
}

/**
 * On create, stamp the caller's school_id when the entity is tenant-scoped and
 * none was supplied. Non-cross-tenant roles always get their own school_id.
 */
export function stampTenantOnCreate(req, meta, data) {
  if (!meta.hasSchoolId) return data;
  const role = req.role;
  const schoolId = req.user?.school_id;
  if (CROSS_TENANT_ROLES.has(role) || req.isService) {
    return data; // trust supplied school_id (may be cross-tenant admin action)
  }
  if (schoolId) return { ...data, school_id: schoolId };
  return data;
}

export function canCrossTenant(role) {
  return CROSS_TENANT_ROLES.has(role) || ADMIN_ROLES.has(role);
}
