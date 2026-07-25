import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword, signToken, sanitizeUser } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, badRequest, unauthorized, ApiError } from '../middleware/error.js';
import { writeAudit } from '../lib/audit.js';

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
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(sanitizeUser(req.user));
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

export default router;
