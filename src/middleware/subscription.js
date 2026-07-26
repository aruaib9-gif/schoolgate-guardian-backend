/**
 * subscription.js — plan/lifecycle enforcement (the school axis).
 *
 * Two guards:
 *   loadSchool     — attaches req.school + req.entitlements, and blocks access
 *                    when the school is suspended past its grace window or its
 *                    trial has expired. Writes are blocked during grace.
 *   requireFeature — gates a route on a plan capability, answering 402 with
 *                    the plan needed, so the UI can prompt an upgrade.
 *
 * Superadmins bypass everything (they must be able to fix a locked-out school).
 */
import { prisma } from '../lib/prisma.js';
import { ApiError, forbidden, paymentRequired } from './error.js';
import { entitlements, can, upgradeFor, ENTITY_FEATURE } from '../lib/entitlements.js';

// Suspended schools stay readable for this long so they can export their data
// and be recovered — holding data hostage churns customers.
export const GRACE_DAYS = 30;

const PLATFORM_ROLES = new Set(['superadmin', 'head_of_schools']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolve the caller's school once per request. Attaches:
 *   req.school        the School row (null for platform staff / unscoped users)
 *   req.entitlements  resolved plan capabilities
 *   req.readOnly      true while a suspended school is inside its grace window
 */
export async function loadSchool(req, _res, next) {
  try {
    if (req.isService || PLATFORM_ROLES.has(req.role)) return next();

    const schoolId = req.user?.school_id;
    if (!schoolId) return next(); // unscoped user — nothing to enforce

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return next();

    req.school = school;
    req.entitlements = entitlements(school);

    const now = Date.now();

    // Expired trial → hard block (nothing to read; they never paid).
    if (school.status === 'trial' && school.trial_ends_at && school.trial_ends_at.getTime() < now) {
      throw new ApiError(402, 'Your trial has ended. Upgrade to continue using School Guardian.', {
        reason: 'trial_expired',
        school: school.name,
        trial_ended: school.trial_ends_at,
      });
    }

    if (school.status === 'suspended' || school.status === 'inactive') {
      const since = school.suspended_at?.getTime() ?? now;
      const graceEnds = since + GRACE_DAYS * 86400000;
      if (now > graceEnds) {
        throw forbidden('This school’s account is suspended. Contact support to restore access.', {
          reason: 'school_suspended',
          school: school.name,
        });
      }
      // Inside the grace window: readable, but no new data.
      req.readOnly = true;
      if (WRITE_METHODS.has(req.method)) {
        throw forbidden('This school is suspended — data is read-only until the account is restored.', {
          reason: 'school_suspended_readonly',
          grace_ends: new Date(graceEnds),
        });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** Gate a route on a plan capability. */
export function requireFeature(feature) {
  return (req, _res, next) => {
    if (req.isService || PLATFORM_ROLES.has(req.role) || !req.school) return next();
    if (can(req.school, feature)) return next();
    next(
      paymentRequired(`Your ${req.school.subscription_plan} plan does not include this feature.`, {
        reason: 'feature_not_in_plan',
        feature,
        current_plan: req.school.subscription_plan,
        upgrade_to: upgradeFor(feature),
      })
    );
  };
}

/**
 * Feature gate for the generic /api/entities/:entity router — derives the
 * required capability from the entity being touched.
 */
export function requireEntityFeature(req, _res, next) {
  const name = req.entityMeta?.name;
  const feature = ENTITY_FEATURE[name];
  if (!feature) return next();
  return requireFeature(feature)(req, _res, next);
}
