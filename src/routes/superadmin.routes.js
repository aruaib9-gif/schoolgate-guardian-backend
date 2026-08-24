import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, forbidden } from '../middleware/error.js';
import * as sa from '../controllers/superadmin.controller.js';

// Only platform-level operators may use the console API.
const PLATFORM_ROLES = new Set(['superadmin', 'head_of_schools']);
function requireSuperAdmin(req, _res, next) {
  if ((req.roles || [req.role]).some((r) => PLATFORM_ROLES.has(r))) return next();
  next(forbidden('Super admin access required'));
}

const router = Router();
router.use(requireAuth, requireSuperAdmin);

// Analytics
router.get('/overview', asyncHandler(sa.overview));
router.get('/series', asyncHandler(sa.series));
router.get('/plans', asyncHandler(sa.plans));
router.get('/billing-options', asyncHandler(sa.billingOptions));
router.get('/audit', asyncHandler(sa.auditFeed));

// Platform config
router.get('/config', asyncHandler(sa.getConfig));
router.put('/config', asyncHandler(sa.updateConfig));

// Schools
router.get('/schools', asyncHandler(sa.listSchools));
router.post('/schools', asyncHandler(sa.createSchool));
router.get('/schools/:id', asyncHandler(sa.getSchool));
router.patch('/schools/:id', asyncHandler(sa.updateSchool));
router.put('/schools/:id', asyncHandler(sa.updateSchool));
router.post('/schools/:id/status', asyncHandler(sa.setStatus));
router.post('/schools/:id/resync-entitlements', asyncHandler(sa.resyncEntitlements));
router.post('/schools/:id/resend-invite', asyncHandler(sa.resendAdminInvite));
router.post('/schools/:id/invoice', asyncHandler(sa.sendInvoice));
router.delete('/schools/:id', asyncHandler(sa.deleteSchool));

// Onboarding invitations
router.get('/invitations', asyncHandler(sa.listInvitations));
router.post('/invitations', asyncHandler(sa.createInvitation));
router.post('/invitations/:id/accept', asyncHandler(sa.acceptInvitation));
router.delete('/invitations/:id', asyncHandler(sa.deleteInvitation));

export default router;
