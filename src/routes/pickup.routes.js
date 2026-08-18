import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../middleware/error.js';
import { env } from '../config/env.js';
import { sendEmail } from '../lib/email.js';
import { sendPush, tokensFor } from '../lib/push.js';
import { emitEntityEvent } from '../lib/realtime.js';

const router = Router();
router.use(requireAuth);

/**
 * Guardian pickup flow.
 *
 * Students can scan THEMSELVES into school with their ID card, but never out.
 * Leaving requires one of:
 *   - a parent's pickup QR  (PU1.<childId>.<sig> — HMAC-bound to the parent's
 *     registered email; also serves as the printable "home QR" for bus drop-offs)
 *   - a one-time delegate pass (OTP-… — created by a parent for a named person)
 *   - boarding the school bus (bus scan of the student ID)
 */

const sig = (childId, parentEmail) =>
  createHmac('sha256', env.jwtSecret).update(`pickup|${childId}|${(parentEmail || '').toLowerCase()}`).digest('base64url').slice(0, 16);

const SCAN_ROLES = new Set(['security', 'school_bus_admin', ...ADMIN_ROLES]);

function parentOf(person, email) {
  const e = (email || '').toLowerCase();
  if ((person.father_email || '').toLowerCase() === e) return 'father';
  if ((person.mother_email || '').toLowerCase() === e) return 'mother';
  return null;
}

// GET /api/pickup/code/:childId — the signed pickup/home QR for THIS parent.
router.get(
  '/code/:childId',
  asyncHandler(async (req, res) => {
    const child = await prisma.person.findUnique({ where: { id: req.params.childId } });
    if (!child) throw notFound('Child not found');
    if (!parentOf(child, req.user.email) && !ADMIN_ROLES.has(req.role)) {
      throw forbidden('Only a registered parent can get this pickup code');
    }
    const email = parentOf(child, req.user.email) ? req.user.email : child.father_email || child.mother_email;
    res.json({
      code: `PU1.${child.id}.${sig(child.id, email)}`,
      child: { id: child.id, name: child.full_name },
      bound_to: email,
    });
  })
);

// POST /api/pickup/one-time — parent creates a delegate pass { child_id, person_name, phone }
router.post(
  '/one-time',
  asyncHandler(async (req, res) => {
    const { child_id, person_name, phone } = req.body || {};
    if (!child_id || !person_name?.trim()) throw badRequest('child_id and person_name are required');
    const child = await prisma.person.findUnique({ where: { id: child_id } });
    if (!child) throw notFound('Child not found');
    if (!parentOf(child, req.user.email)) throw forbidden('Only a registered parent can authorise a pickup');
    const pass = await prisma.oneTimePass.create({
      data: {
        school_id: child.school_id, parent_id: req.user.id, parent_name: req.user.full_name,
        child_id: child.id, child_name: child.full_name, purpose: 'pickup',
        authorized_person_name: person_name.trim(), contact_phone: phone || null,
        qr_code: `OTP-${nanoid(12)}`, status: 'active',
        valid_until: new Date(Date.now() + 24 * 3600 * 1000), created_by: req.user.email,
      },
    });
    res.status(201).json(pass);
  })
);

async function notifyParents(child, { title, body }) {
  const emails = [child.father_email, child.mother_email].filter(Boolean);
  if (!emails.length) return;
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const tokens = users.map((u) => u.push_token).filter(Boolean);
  sendPush(tokens, { title, body, data: { type: 'pickup', person_id: child.id } }).catch(() => {});
  for (const to of emails) {
    sendEmail({ to, from_name: 'School Guardian', subject: title, body }).catch(() => {});
  }
}

// POST /api/pickup/scan — resolve + consume a pickup/home QR at the gate or bus.
// body: { code, context: 'gate' | 'bus', bus_id?, bus_name?, gate_name? }
router.post(
  '/scan',
  asyncHandler(async (req, res) => {
    if (!SCAN_ROLES.has(req.role)) throw forbidden('Only security or bus staff can scan pickups');
    const { code = '', context = 'gate', bus_id, bus_name, gate_name } = req.body || {};
    const when = new Date();
    const time = when.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

    let child = null;
    let byLine = '';       // for logs
    let passType = '';

    if (code.startsWith('PU1.')) {
      const [, childId, s] = code.split('.');
      child = childId && (await prisma.person.findUnique({ where: { id: childId } }));
      if (!child) throw notFound('Unknown pickup code');
      const parentEmail = [child.father_email, child.mother_email].filter(Boolean).find((e) => sig(child.id, e) === s);
      if (!parentEmail) throw badRequest('This pickup code is not valid for this child');
      byLine = `parent/guardian (${parentEmail})`;
      passType = 'parent_pickup';
    } else if (code.startsWith('OTP-')) {
      const pass = await prisma.oneTimePass.findFirst({ where: { qr_code: code } });
      if (!pass) throw notFound('Unknown pass');
      if (pass.status !== 'active') throw badRequest(`This one-time pass was already ${pass.status}`);
      if (pass.valid_until && pass.valid_until < when) {
        await prisma.oneTimePass.update({ where: { id: pass.id }, data: { status: 'expired' } });
        throw badRequest('This one-time pass has expired');
      }
      child = await prisma.person.findUnique({ where: { id: pass.child_id } });
      if (!child) throw notFound('Child on this pass no longer exists');
      await prisma.oneTimePass.update({ where: { id: pass.id }, data: { status: 'used', used_at: when } });
      byLine = `${pass.authorized_person_name} (authorised by ${pass.parent_name || 'parent'})`;
      passType = 'one_time';
    } else {
      throw badRequest('Not a pickup code');
    }

    if (context === 'bus') {
      if (!bus_id) throw badRequest('bus_id is required for bus drop-offs');
      await prisma.busScanLog.create({
        data: {
          school_id: child.school_id, bus_id, bus_name: bus_name || null,
          person_id: child.id, person_name: child.full_name, person_category: child.category,
          action: 'alight', timestamp: when,
          scanned_by: req.user.full_name || 'Bus staff', scanned_by_name: req.user.full_name || 'Bus staff',
          notes: `Received at home by ${byLine}`,
        },
      });
      await prisma.person.update({ where: { id: child.id }, data: { current_status: 'outside' } });
      notifyParents(child, {
        title: `${child.full_name} dropped off at home`,
        body: `${child.full_name} was dropped off by ${bus_name || 'the school bus'} at ${time} and received by ${byLine}.`,
      });
      emitEntityEvent('BusScanLog', 'create', undefined, child.school_id);
      return res.json({ ok: true, action: 'dropoff', child: { id: child.id, name: child.full_name }, by: byLine });
    }

    await prisma.accessLog.create({
      data: {
        school_id: child.school_id, person_id: child.id, person_name: child.full_name,
        person_category: child.category, action: 'exit', timestamp: when,
        scanned_by: req.user.full_name || 'Security', gate_name: gate_name || req.user.gate_name || 'Main Gate',
        pass_type: passType, notes: `Picked up by ${byLine}`,
      },
    });
    await prisma.person.update({ where: { id: child.id }, data: { current_status: 'outside' } });
    notifyParents(child, {
      title: `${child.full_name} left school`,
      body: `${child.full_name} was signed out at ${time}, picked up by ${byLine}.`,
    });
    emitEntityEvent('AccessLog', 'create', undefined, child.school_id);
    res.json({ ok: true, action: 'pickup', child: { id: child.id, name: child.full_name }, by: byLine });
  })
);

export default router;
