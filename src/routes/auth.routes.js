import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword, signToken, sanitizeUser } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, badRequest, unauthorized, ApiError } from '../middleware/error.js';
import { writeAudit } from '../lib/audit.js';
import { serializeEntitlements } from '../lib/entitlements.js';
import { issueToken, peekToken, consumeToken, linkFor } from '../lib/authTokens.js';
import { sendEmail } from '../lib/email.js';
import { passwordReset } from '../lib/emailTemplates.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
  role: z.string().optional(),
  school_id: z.string().optional(),
  person_id: z.string().optional(),
  user_category: z.string().optional(),
});

// POST /auth/register — create an account. First account overall becomes admin.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid registration payload', parsed.error.flatten());
    const { email, password, ...rest } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, 'An account with this email already exists');

    const userCount = await prisma.user.count();
    const password_hash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        role: rest.role || (userCount === 0 ? 'admin' : 'user'),
        user_category: rest.user_category || (userCount === 0 ? 'superadmin' : undefined),
        full_name: rest.full_name,
        school_id: rest.school_id,
        person_id: rest.person_id,
        last_login: new Date(),
        created_by: email,
      },
    });
    const token = signToken(user);
    res.status(201).json({ token, user: sanitizeUser(user) });
  })
);

// POST /auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw badRequest('email and password are required');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw unauthorized('Invalid email or password');
    }
    if (user.is_active === false) throw unauthorized('Account is inactive');
    const updated = await prisma.user.update({ where: { id: user.id }, data: { last_login: new Date() } });
    const token = signToken(updated);
    await writeAudit({ user: updated, role: updated.user_category || updated.role }, { action: 'login', entity_type: 'User', entity_id: updated.id, description: `${email} logged in` });
    res.json({ token, user: sanitizeUser(updated) });
  })
);

// GET /auth/me — current user (equivalent to base44.auth.me)
// Includes the school's resolved plan entitlements so clients can hide or lock
// features instead of letting the user hit a 402.
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = sanitizeUser(req.user);
    if (req.user.school_id) {
      const school = await prisma.school.findUnique({ where: { id: req.user.school_id } });
      if (school) {
        me.school = {
          id: school.id,
          name: school.name,
          plan: school.subscription_plan,
          status: school.status,
          trial_ends_at: school.trial_ends_at,
        };
        me.entitlements = serializeEntitlements(school);
      }
    }
    res.json(me);
  })
);

// PATCH /auth/me — update own profile (equivalent to base44.auth.updateMe)
router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    // Whitelist self-editable fields.
    const allowed = ['full_name', 'gate_name', 'assigned_bus_id', 'person_id', 'profile_completed'];
    const data = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    if (body.password) data.password_hash = await hashPassword(body.password);
    const user = await prisma.user.update({ where: { id: req.user.id }, data });
    res.json(sanitizeUser(user));
  })
);

// POST /auth/logout — stateless JWT; provided for API symmetry.
router.post('/logout', requireAuth, (req, res) => {
  res.json({ success: true });
});

// POST /auth/change-password
router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 6) throw badRequest('new_password must be at least 6 characters');
    if (req.user.password_hash && !(await verifyPassword(current_password || '', req.user.password_hash))) {
      throw unauthorized('Current password is incorrect');
    }
    const password_hash = await hashPassword(new_password);
    await prisma.user.update({ where: { id: req.user.id }, data: { password_hash } });
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Password setup / recovery via one-time emailed links
// ---------------------------------------------------------------------------

// GET /auth/invite/:token — let the web app show who the link is for before
// asking for a password. Public: the token itself is the credential.
router.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const row = (await peekToken(req.params.token, 'invite')) || (await peekToken(req.params.token, 'reset'));
    if (!row) throw new ApiError(410, 'This link is invalid, already used, or has expired');
    const user = await prisma.user.findUnique({ where: { id: row.user_id } });
    if (!user) throw new ApiError(410, 'This link is no longer valid');
    let school = null;
    if (user.school_id) {
      const s = await prisma.school.findUnique({ where: { id: user.school_id } });
      school = s ? { id: s.id, name: s.name } : null;
    }
    res.json({
      valid: true,
      purpose: row.purpose,
      email: user.email,
      full_name: user.full_name,
      school,
      expires_at: row.expires_at,
    });
  })
);

// Shared handler: consume a one-time token and set the account's password.
const setPasswordWithToken = (purpose) =>
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token) throw badRequest('token is required');
    if (!password || password.length < 8) throw badRequest('Password must be at least 8 characters');

    const row = await consumeToken(token, purpose);
    if (!row) throw new ApiError(410, 'This link is invalid, already used, or has expired');

    const user = await prisma.user.update({
      where: { id: row.user_id },
      data: {
        password_hash: await hashPassword(password),
        profile_completed: true,
        is_active: true,
        last_login: new Date(),
      },
    });

    await writeAudit(
      { user, role: user.user_category || user.role },
      {
        action: 'update',
        entity_type: 'User',
        entity_id: user.id,
        description: purpose === 'reset' ? `${user.email} reset their password` : `${user.email} set their password`,
      }
    );

    // Sign them straight in — they just proved control of the mailbox.
    res.json({ token: signToken(user), user: sanitizeUser(user) });
  });

// POST /auth/accept-invite  { token, password } — finish onboarding.
router.post('/accept-invite', setPasswordWithToken('invite'));

// POST /auth/reset-password { token, password } — complete a reset.
router.post('/reset-password', setPasswordWithToken('reset'));

// POST /auth/forgot-password { email }
// Always answers 200 with the same body: revealing whether an address exists
// would let anyone enumerate the platform's users.
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const generic = { success: true, message: 'If that email is registered, a reset link is on its way.' };
    if (!email) return res.json(generic);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.is_active === false) return res.json(generic);

    const { token, expires_at } = await issueToken({ user, purpose: 'reset' });
    const link = linkFor('reset', token);
    const mail = passwordReset({ name: user.full_name, email: user.email, link, expiresAt: expires_at });
    await sendEmail({ to: user.email, from_name: 'School Guardian', ...mail });

    res.json(generic);
  })
);

export default router;
