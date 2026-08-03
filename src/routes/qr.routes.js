import { Router } from 'express';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, notFound, forbidden } from '../middleware/error.js';

const router = Router();

/**
 * GET /qr/:code.png — the printable QR badge for a person/pass code.
 *
 * Used by the mobile app's "Download PNG" button and the consoles, both of
 * which open it in a browser — so auth arrives as ?access_token= (supported
 * by extractToken) rather than a header.
 *
 * Admins can print anyone in their school; everyone else only their own code
 * (a parent printing their child's badge uses the parent link).
 */
router.get(
  '/:code.png',
  requireAuth,
  asyncHandler(async (req, res) => {
    const code = req.params.code;
    const person = await prisma.person.findFirst({ where: { qr_code: code } });

    const isAdmin = ADMIN_ROLES.has(req.role) || req.role === 'management';
    if (person) {
      const sameSchool = !person.school_id || person.school_id === req.user.school_id;
      const isSelf = req.user.person_id === person.id;
      const isParent =
        req.user.email && (person.father_email === req.user.email || person.mother_email === req.user.email);
      const crossTenant = req.role === 'superadmin' || req.role === 'head_of_schools';
      if (!crossTenant && !(isAdmin && sameSchool) && !isSelf && !isParent) {
        throw forbidden('You cannot download this badge');
      }
    } else if (!isAdmin) {
      // Pass codes (GP-/V-/OTP) are printable by staff only.
      throw notFound('Unknown code');
    }

    const size = Math.min(Number(req.query.size) || 600, 1200);
    const png = await QRCode.toBuffer(code, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    const filename = `${(person?.full_name || code).replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')}-qr.png`;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(png);
  })
);

export default router;
