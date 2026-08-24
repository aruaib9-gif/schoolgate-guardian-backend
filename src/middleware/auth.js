import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/auth.js';
import { unauthorized } from './error.js';
import { env } from '../config/env.js';

// Roles that bypass fine-grained permission checks (full app administrators).
export const ADMIN_ROLES = new Set(['superadmin', 'admin', 'head_of_schools', 'school_admin']);


/**
 * Every role an account holds: its primary role plus any extras.
 *
 * A staff member can legitimately wear two hats — a teacher who also runs the
 * bus, or an admin who covers the gate. Permissions are the UNION, so holding
 * an extra role can only ever add access, never remove it.
 */
export function rolesOf(user) {
  const all = [user?.user_category || user?.role || 'user', ...(user?.extra_roles || [])];
  return [...new Set(all.filter(Boolean))];
}

/** Does this request hold ANY of the given roles? */
export function hasAnyRole(req, roleSet) {
  return (req.roles || [req.role]).some((r) => roleSet.has(r));
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.access_token === 'string') return req.query.access_token;
  return null;
}

/**
 * Require a valid JWT. Loads the fresh User row so role/tenant changes take
 * effect immediately, and attaches it as req.user.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized();
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || user.is_active === false) throw unauthorized('User not found or inactive');
    req.user = user;
    // Primary role (display, back-compat) and the full set used for RBAC.
    req.role = user.user_category || user.role || 'user';
    req.roles = rolesOf(user);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth: attaches req.user if a valid token is present, but never
 * rejects. Useful for endpoints that behave differently when signed in.
 */
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (user && user.is_active !== false) {
      req.user = user;
      req.role = user.user_category || user.role || 'user';
      req.roles = rolesOf(user);
    }
  } catch {
    /* ignore — treat as anonymous */
  }
  next();
}

/**
 * Allow either a valid user JWT OR a trusted cron/service secret
 * (header x-cron-secret). Used by scheduled function endpoints.
 */
export async function requireAuthOrCron(req, res, next) {
  const secret = req.headers['x-cron-secret'];
  if (env.cronSecret && secret && secret === env.cronSecret) {
    req.isService = true;
    return next();
  }
  return requireAuth(req, res, next);
}
