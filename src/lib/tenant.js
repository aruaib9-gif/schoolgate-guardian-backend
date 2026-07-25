import { ADMIN_ROLES } from '../middleware/auth.js';

// Roles allowed to see across all schools (platform-level operators).
const CROSS_TENANT_ROLES = new Set(['superadmin', 'head_of_schools']);

/**
 * Merge a tenant constraint into a where clause for tenant-scoped entities.
 * Cross-tenant roles (superadmin) are unrestricted. Everyone else is limited
 * to their own school_id when they have one.
 */
export function applyTenantScope(req, meta, where = {}) {
  if (!meta.hasSchoolId) return where;
  const role = req.role;
  if (req.isService) return where;
  if (CROSS_TENANT_ROLES.has(role)) return where;
  const schoolId = req.user?.school_id;
  if (!schoolId) return where; // user has no school yet — no extra constraint
  // If the caller already filtered by a different school, keep the intersection
  // (their own school wins for isolation).
  return { ...where, school_id: schoolId };
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
