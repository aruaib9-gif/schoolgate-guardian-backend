import { Router } from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/error.js';
import { sendEmail } from '../lib/email.js';
import { writeAudit } from '../lib/audit.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

// POST /users/invite — create/send an invitation (mirrors base44.users.inviteUser)
// body: { email, role, first_name?, last_name?, phone?, department?, grade?, school_id?, portal_access?, notes? }
router.post(
  '/invite',
  asyncHandler(async (req, res) => {
    const canInvite = ADMIN_ROLES.has(req.role) || req.role === 'management';
    if (!canInvite) throw forbidden('You are not permitted to invite users');

    const b = req.body || {};
    if (!b.email) throw badRequest('email is required');

    // Scope the invitation to the inviter's school unless a cross-tenant admin.
    const school_id =
      req.role === 'superadmin' || req.role === 'head_of_schools'
        ? b.school_id || req.user.school_id
        : req.user.school_id || b.school_id;

    let school_name = b.school_name;
    if (!school_name && school_id) {
      const school = await prisma.school.findUnique({ where: { id: school_id } });
      school_name = school?.name;
    }

    const invite_token = nanoid(32);
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        school_id: school_id || undefined,
        school_name,
        first_name: b.first_name,
        last_name: b.last_name,
        email: b.email,
        phone: b.phone,
        role: b.role,
        department: b.department,
        grade: b.grade,
        portal_access: b.portal_access ?? true,
        invite_token,
        status: 'sent',
        expires_at,
        invited_by: req.user.email,
        invited_by_name: req.user.full_name,
        notes: b.notes,
        created_by: req.user.email,
      },
    });

    const inviteLink = `${env.publicUrl}/invite/accept?token=${invite_token}`;
    const emailResult = await sendEmail({
      to: b.email,
      subject: `You've been invited to ${school_name || 'SchoolGate Guardian'}`,
      body: [
        `Hello${b.first_name ? ' ' + b.first_name : ''},`,
        '',
        `You have been invited to join ${school_name || 'SchoolGate Guardian'}${b.role ? ' as ' + b.role : ''}.`,
        '',
        `Accept your invitation here: ${inviteLink}`,
        '',
        `This link expires on ${expires_at.toDateString()}.`,
      ].join('\n'),
      from_name: 'SchoolGate Guardian',
    });

    await writeAudit(req, {
      action: 'create',
      entity_type: 'Invitation',
      entity_id: invitation.id,
      description: `Invited ${b.email}${b.role ? ' as ' + b.role : ''}`,
    });

    res.status(201).json({ success: true, invitation, invite_link: inviteLink, email: emailResult });
  })
);

export default router;
