import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../middleware/error.js';
import { writeAudit } from '../lib/audit.js';
import { emitEntityEvent } from '../lib/realtime.js';
import {
  evaluateCheckIn, validateCentre, radiusOf, hasCentre,
  MIN_RADIUS_M, MAX_RADIUS_M, DEFAULT_RADIUS_M,
} from '../lib/geofence.js';

/**
 * Staff self check-in.
 *
 * A member of staff standing on campus marks their own arrival, instead of
 * queueing for someone to scan their card. Deliberately narrow:
 *
 *   - STAFF ONLY. A pupil's attendance is not self-declared, and the rule that
 *     a child cannot sign themselves anywhere is untouched by this file.
 *   - ARRIVAL ONLY. There is no self check-out here. Leaving still goes through
 *     the gate: a parent's live QR, a one-time pass, or the assigned bus.
 *   - The device reports its own position, so this is an attendance
 *     convenience, not a security control. See lib/geofence.js.
 */
const router = Router();
router.use(requireAuth);

// Who may mark their own arrival. Parents and students are absent on purpose.
const SELF_CHECKIN_ROLES = new Set([
  'admin', 'school_admin', 'management', 'security', 'teacher',
  'school_bus_admin', 'staff', 'sales_rep',
]);

// Who may move the pin. The school office, not everyone who can check in.
const CAMPUS_EDITOR_ROLES = new Set(['superadmin', 'head_of_schools', 'admin', 'school_admin']);

const rolesOf = (req) => req.roles || [];
const canCheckIn = (req) => rolesOf(req).some((r) => SELF_CHECKIN_ROLES.has(r));
const canEditCampus = (req) => rolesOf(req).some((r) => CAMPUS_EDITOR_ROLES.has(r));

/*
 * A refused attempt is cheap for us and useful to the app, which re-asks as the
 * person walks towards the gate. A *successful* one writes a log line, and the
 * idempotency check below means a second tap is a no-op rather than a duplicate
 * — so the limit only needs to stop something pathological.
 */
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many check-in attempts. Wait a moment and try again.' },
});

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function schoolOf(req) {
  if (!req.user.school_id) throw badRequest('Your account is not attached to a school.');
  const school = await prisma.school.findUnique({ where: { id: req.user.school_id } });
  if (!school) throw notFound('School not found');
  return school;
}

/**
 * GET /api/checkin/context
 *
 * What the app needs to draw the screen before anyone taps anything: whether
 * the feature is on, where the campus is (so the handset can show a live
 * distance without a round trip per step), and whether this person is already
 * marked present.
 */
router.get(
  '/context',
  asyncHandler(async (req, res) => {
    const school = await schoolOf(req);
    const person = req.user.person_id
      ? await prisma.person.findUnique({ where: { id: req.user.person_id } })
      : null;

    res.json({
      enabled: !!school.self_checkin_enabled,
      configured: hasCentre(school),
      eligible: canCheckIn(req),
      can_edit_campus: canEditCampus(req),
      // Null unless a centre is actually set, so the app never draws a fence
      // around the Gulf of Guinea.
      campus: hasCentre(school)
        ? { latitude: school.latitude, longitude: school.longitude, radius_m: radiusOf(school) }
        : null,
      school: { id: school.id, name: school.name },
      person: person
        ? { id: person.id, full_name: person.full_name, category: person.category, current_status: person.current_status }
        : null,
      // A login with no Person behind it has nothing to mark present.
      has_person_record: !!person,
    });
  })
);

/**
 * POST /api/checkin/self — { latitude, longitude, accuracy_m }
 */
router.post(
  '/self',
  limiter,
  asyncHandler(async (req, res) => {
    if (!canCheckIn(req)) {
      throw forbidden('Self check-in is for staff. Pupils are signed in at the gate.');
    }
    if (!req.user.person_id) {
      throw badRequest('Your login is not linked to a person record, so there is nothing to mark present. Ask your administrator.');
    }

    const school = await schoolOf(req);
    const person = await prisma.person.findUnique({ where: { id: req.user.person_id } });
    if (!person) throw notFound('Your person record was not found.');
    // Tenancy: the login's school and the person's school must agree.
    if (person.school_id && person.school_id !== school.id) {
      throw forbidden('That person record belongs to another school.');
    }

    const verdict = evaluateCheckIn({
      school,
      position: {
        latitude: num(req.body?.latitude),
        longitude: num(req.body?.longitude),
        accuracy_m: num(req.body?.accuracy_m),
      },
    });

    if (!verdict.ok) {
      // 403 for "you are not where you say"; 409 for a school-side gap the
      // person cannot fix themselves.
      const status = verdict.code === 'disabled' || verdict.code === 'no_centre' ? 409 : 403;
      return res.status(status).json({
        error: verdict.message,
        code: verdict.code,
        distance_m: verdict.distance_m ?? null,
        radius_m: verdict.radius_m ?? null,
      });
    }

    /*
     * Already inside → say so and change nothing. Tapping twice on a flaky
     * connection must not produce two arrivals, and this is cheaper and
     * clearer than de-duplicating the log afterwards.
     */
    if (person.current_status === 'inside') {
      return res.status(200).json({
        ok: true, already: true,
        message: 'You are already checked in today.',
        person: { id: person.id, full_name: person.full_name, current_status: 'inside' },
      });
    }

    const when = new Date();
    const log = await prisma.accessLog.create({
      data: {
        school_id: school.id,
        person_id: person.id,
        person_name: person.full_name,
        person_category: person.category,
        action: 'entry',
        timestamp: when,
        scanned_by: `${person.full_name} (self)`,
        gate_name: req.user.gate_name || 'Self check-in',
        pass_type: 'self_checkin',
        notes: `Self check-in, ${verdict.distance_m}m from the campus centre`,
        device_latitude: num(req.body?.latitude),
        device_longitude: num(req.body?.longitude),
        device_accuracy_m: verdict.accuracy_m,
        distance_m: verdict.distance_m,
      },
    });
    await prisma.person.update({ where: { id: person.id }, data: { current_status: 'inside' } });

    await writeAudit(req, {
      action: 'create', entity_type: 'AccessLog', entity_id: log.id,
      description: `${person.full_name} checked themselves in`,
      metadata: { type: 'checkin.self', distance_m: verdict.distance_m, accuracy_m: verdict.accuracy_m },
    });
    emitEntityEvent('AccessLog', 'create', undefined, school.id);

    res.status(201).json({
      ok: true,
      checked_in_at: when.toISOString(),
      distance_m: verdict.distance_m,
      person: { id: person.id, full_name: person.full_name, current_status: 'inside' },
    });
  })
);

/**
 * PATCH /api/checkin/campus — { latitude, longitude, radius_m, enabled }
 *
 * The school's own administrator records where the campus is. Scoped to their
 * own school by construction: the id is taken from the token, never the body.
 */
router.patch(
  '/campus',
  asyncHandler(async (req, res) => {
    if (!canEditCampus(req)) throw forbidden('Only administrators can set the campus location.');
    const school = await schoolOf(req);

    const latitude = num(req.body?.latitude);
    const longitude = num(req.body?.longitude);
    const radius_m = num(req.body?.radius_m) ?? radiusOf(school);
    const enabled = req.body?.enabled === undefined ? school.self_checkin_enabled : !!req.body.enabled;

    // Clearing the pin is allowed, but then check-in cannot stay on.
    const clearing = latitude === null && longitude === null;
    if (clearing) {
      const updated = await prisma.school.update({
        where: { id: school.id },
        data: { latitude: null, longitude: null, self_checkin_enabled: false },
      });
      await writeAudit(req, {
        action: 'update', entity_type: 'School', entity_id: school.id,
        description: `Campus location cleared for ${school.name}; self check-in switched off`,
        metadata: { type: 'checkin.campus' },
      });
      return res.json(serialise(updated));
    }

    const problem = validateCentre({ latitude, longitude, radius_m });
    if (problem) throw badRequest(problem.message, { code: problem.code });

    const updated = await prisma.school.update({
      where: { id: school.id },
      data: {
        latitude, longitude,
        geofence_radius_m: Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radius_m || DEFAULT_RADIUS_M))),
        self_checkin_enabled: enabled,
      },
    });

    await writeAudit(req, {
      action: 'update', entity_type: 'School', entity_id: school.id,
      description: `Campus location set for ${school.name} (${latitude.toFixed(5)}, ${longitude.toFixed(5)}, ±${updated.geofence_radius_m}m); self check-in ${enabled ? 'on' : 'off'}`,
      metadata: { type: 'checkin.campus', latitude, longitude, radius_m: updated.geofence_radius_m, enabled },
    });

    res.json(serialise(updated));
  })
);

const serialise = (s) => ({
  id: s.id, name: s.name,
  latitude: s.latitude, longitude: s.longitude,
  radius_m: radiusOf(s),
  self_checkin_enabled: s.self_checkin_enabled,
  configured: hasCentre(s),
});

export default router;
