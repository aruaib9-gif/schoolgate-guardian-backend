import { randomBytes } from 'node:crypto';
import { prisma } from './prisma.js';
import { hashPassword } from './auth.js';
import { issueToken, linkFor } from './authTokens.js';
import { sendEmail } from './email.js';
import { welcomeInvite } from './emailTemplates.js';

/**
 * Create (or reuse) a login and email its set-password link.
 *
 * Shared by /users/invite and enrolment so the two can never drift apart.
 * An existing account keeps its password — we only ever add a fresh
 * set-password link, never overwrite credentials someone is already using.
 */
export async function inviteUser(req, { email, role, full_name, school_id, person_id }) {
  const addr = (email || '').trim().toLowerCase();
  if (!addr) throw new Error('email is required');

  let school_name;
  if (school_id) {
    const school = await prisma.school.findUnique({ where: { id: school_id } });
    school_name = school?.name;
  }

  let user = await prisma.user.findUnique({ where: { email: addr } });
  const existed = !!user;
  let tempPassword = null;

  if (!user) {
    tempPassword = randomBytes(6).toString('base64url');
    user = await prisma.user.create({
      data: {
        email: addr,
        full_name: full_name || null,
        password_hash: await hashPassword(tempPassword),
        role: 'user',
        user_category: role || 'staff',
        school_id: school_id || undefined,
        person_id: person_id || undefined,
        is_active: true,
        profile_completed: false,
        created_by: req?.user?.email,
      },
    });
  } else if (person_id && !user.person_id) {
    // Link an existing login to its person, but never re-point one that is
    // already attached to somebody else.
    user = await prisma.user.update({ where: { id: user.id }, data: { person_id } });
  }

  const { token, expires_at } = await issueToken({ user, purpose: 'invite', createdBy: req?.user?.email });
  const link = linkFor('invite', token);
  const mail = welcomeInvite({
    name: user.full_name, email: addr, link, expiresAt: expires_at,
    schoolName: school_name, tempPassword,
  });
  const delivery = await sendEmail({ to: addr, from_name: 'School Guardian', ...mail });

  return { user_id: user.id, existed, delivered: !!delivery.delivered, invite_link: link };
}
