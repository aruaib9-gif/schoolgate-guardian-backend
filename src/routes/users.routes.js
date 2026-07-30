import { Router } from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/error.js';
import { sendEmail } from '../lib/email.js';
import { welcomeInvite } from '../lib/emailTemplates.js';
import { issueToken, linkFor } from '../lib/authTokens.js';
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

    // Create (or reuse) the login this invite is for, then issue a one-time
    // set-password token. Previously the email carried a link nothing could
    // consume, so invited staff could never actually get in.
    const full_name = [b.first_name, b.last_name].filter(Boolean).join(' ') || null;
    let user = await prisma.user.findUnique({ where: { email: b.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: b.email,
          full_name,
          role: 'user',
          user_category: b.role || 'staff',
          school_id: school_id || undefined,
          // Link the login to its Person record so scans/attendance resolve.
          person_id: b.person_id || undefined,
          is_active: true,
          profile_completed: false,
          created_by: req.user.email,
        },
      });
    } else if (b.person_id && !user.person_id) {
      user = await prisma.user.update({ where: { id: user.id }, data: { person_id: b.person_id } });
    }

    const { token: setupToken, expires_at: linkExpires } = await issueToken({
      user, purpose: 'invite', createdBy: req.user.email,
    });
    const inviteLink = linkFor('invite', setupToken);

    const mail = welcomeInvite({
      name: full_name,
      email: b.email,
      link: inviteLink,
      expiresAt: linkExpires,
      schoolName: school_name,
      roleLabel: b.role,
      invitedBy: req.user.full_name || req.user.email,
    });
    const emailResult = await sendEmail({ to: b.email, from_name: 'School Guardian', ...mail });

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
