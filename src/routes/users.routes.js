import { Router } from 'express';
import { nanoid } from 'nanoid';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { requireAuth, ADMIN_ROLES, hasAnyRole } from '../middleware/auth.js';
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
    const canInvite = hasAnyRole(req, ADMIN_ROLES) || (req.roles || []).includes('management');
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
    // New accounts get a temporary password so they can sign in from the
    // email immediately; the set-password link lets them replace it. Existing
    // accounts keep their password — we never overwrite one.
    let tempPassword = null;
    if (!user) {
      tempPassword = randomBytes(6).toString('base64url'); // 8 chars, no shell/url-hostile chars
      user = await prisma.user.create({
        data: {
          email: b.email,
          full_name,
          password_hash: await hashPassword(tempPassword),
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
      tempPassword,
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

/**
 * Roles a school admin may hand out. Deliberately excludes the platform
 * roles: a school administrator must never be able to mint a superadmin.
 */
const ASSIGNABLE = new Set([
  'admin', 'management', 'security', 'reception', 'teacher',
  'school_bus_admin', 'sales_rep', 'staff', 'parent', 'student',
]);

/**
 * PATCH /users/:id/roles — set what someone is, and what else they also do.
 * body: { user_category?: string, extra_roles?: string[] }
 *
 * A staff member can hold several roles (a teacher who also runs the bus);
 * permissions become the union. Only administrators of the SAME school may
 * change them.
 */
router.patch(
  '/:id/roles',
  asyncHandler(async (req, res) => {
    const isPlatform = (req.roles || []).some((r) => r === 'superadmin' || r === 'head_of_schools');
    if (!hasAnyRole(req, ADMIN_ROLES)) throw forbidden('Only administrators can change roles');

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw badRequest('User not found');
    if (!isPlatform && target.school_id !== req.user.school_id) {
      throw forbidden('You can only change roles for people in your own school');
    }
    // A school admin cannot promote anyone (including themselves) to a
    // platform role, nor strip a platform operator's access.
    if (!isPlatform && ['superadmin', 'head_of_schools'].includes(target.user_category)) {
      throw forbidden('This account is managed by the platform team');
    }

    const { user_category, extra_roles } = req.body || {};
    const data = {};

    if (user_category !== undefined) {
      if (!isPlatform && !ASSIGNABLE.has(user_category)) throw badRequest(`"${user_category}" is not a role you can assign`);
      data.user_category = user_category;
    }
    if (extra_roles !== undefined) {
      if (!Array.isArray(extra_roles)) throw badRequest('extra_roles must be an array');
      const cleaned = [...new Set(extra_roles.filter(Boolean))];
      for (const r of cleaned) {
        if (!isPlatform && !ASSIGNABLE.has(r)) throw badRequest(`"${r}" is not a role you can assign`);
      }
      // The primary role is implicit — keeping it in the extras too would
      // double-count it everywhere it is displayed.
      data.extra_roles = cleaned.filter((r) => r !== (data.user_category ?? target.user_category));
    }
    if (!Object.keys(data).length) throw badRequest('Nothing to change');

    const updated = await prisma.user.update({ where: { id: target.id }, data });

    // Keep the linked Person's category in step, so lists and ID cards agree.
    if (data.user_category && updated.person_id) {
      await prisma.person.update({ where: { id: updated.person_id }, data: { category: data.user_category } }).catch(() => {});
    }

    await writeAudit(req, {
      action: 'update', entity_type: 'User', entity_id: updated.id,
      description: `Roles for ${updated.email}: ${[updated.user_category, ...(updated.extra_roles || [])].join(' + ')}`,
    });

    res.json({
      id: updated.id, email: updated.email, full_name: updated.full_name,
      user_category: updated.user_category, extra_roles: updated.extra_roles,
    });
  })
);

export default router;
