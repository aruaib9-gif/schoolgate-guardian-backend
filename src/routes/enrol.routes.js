import { Router } from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/error.js';
import { inviteUser } from '../lib/invite.js';

const router = Router();
router.use(requireAuth);

/**
 * Enrolment — the one place that turns "a person exists" into records:
 * a Person (always), their QR code (always, server-side), a login for the
 * person when they need one, and logins for a student's parents.
 *
 * Children never need an email of their own: their parents' addresses are
 * what the school actually communicates with, and each becomes a parent
 * account linked to the child.
 */

const STAFF_PORTAL = new Set(['admin', 'management', 'security', 'teacher', 'reception', 'school_bus_admin', 'sales_rep']);
const newQr = () => `QR-${Date.now().toString(36).toUpperCase()}${nanoid(6).toUpperCase()}`;

function assertAdmin(req) {
  if (!ADMIN_ROLES.has(req.role) && req.role !== 'management') {
    throw forbidden('Only administrators can enrol people');
  }
}

/**
 * Create one person + their accounts. Returns what was created so the caller
 * can report it row by row.
 */
async function enrolOne(req, row) {
  const schoolId = req.user.school_id || row.school_id;
  const name = (row.full_name || '').trim();
  if (!name) throw badRequest('full_name is required');
  const category = (row.category || 'student').trim();
  const isStudent = category === 'student';

  const fatherEmail = (row.father_email || '').trim().toLowerCase() || null;
  const motherEmail = (row.mother_email || '').trim().toLowerCase() || null;
  if (isStudent && !fatherEmail && !motherEmail) {
    throw badRequest("A student needs at least one parent email — that is how the family gets their account");
  }

  const [first, ...rest] = name.split(' ');
  const person = await prisma.person.create({
    data: {
      school_id: schoolId || undefined,
      full_name: name,
      first_name: first,
      last_name: rest.join(' ') || null,
      // A child needs no contact details of their own.
      email: isStudent ? null : ((row.email || '').trim().toLowerCase() || null),
      phone: isStudent ? null : ((row.phone || '').trim() || null),
      category,
      grade: isStudent ? (row.grade || null) : null,
      department: isStudent ? null : (row.department || null),
      father_email: fatherEmail,
      father_name: (row.father_name || '').trim() || null,
      mother_email: motherEmail,
      mother_name: (row.mother_name || '').trim() || null,
      qr_code: newQr(),               // never left to the client to invent
      current_status: 'outside',
      active: true,
      registration_completed: true,
      profile_completed: true,
      portal_access: !isStudent && row.portal_access !== false,
      created_by: req.user.email,
    },
  });

  const invited = [];

  // Parents: one account each, linked to this child by their email.
  if (isStudent) {
    for (const [email, pname] of [[fatherEmail, row.father_name], [motherEmail, row.mother_name]]) {
      if (!email) continue;
      const r = await inviteUser(req, {
        email,
        role: 'parent',
        full_name: (pname || '').trim() || `${name}'s parent`,
        school_id: schoolId,
      });
      invited.push({ email, role: 'parent', ...r });
    }
  } else if (person.portal_access && person.email && STAFF_PORTAL.has(category)) {
    const r = await inviteUser(req, {
      email: person.email, role: category, full_name: name, school_id: schoolId, person_id: person.id,
    });
    invited.push({ email: person.email, role: category, ...r });
  }

  return { person, invited };
}

// POST /api/enrol — one person
router.post(
  '/',
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const result = await enrolOne(req, req.body || {});
    res.status(201).json(result);
  })
);

// POST /api/enrol/bulk — { rows: [...] }. Never all-or-nothing: one bad row
// must not discard a whole spreadsheet, so each row reports its own outcome.
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    assertAdmin(req);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows?.length) throw badRequest('rows must be a non-empty array');
    if (rows.length > 500) throw badRequest('Import at most 500 rows at a time');

    const created = [];
    const failed = [];
    for (const [i, row] of rows.entries()) {
      try {
        const { person, invited } = await enrolOne(req, row);
        created.push({ row: i + 1, id: person.id, name: person.full_name, category: person.category, invited: invited.length });
      } catch (e) {
        failed.push({ row: i + 1, name: row.full_name || '(no name)', error: e.message });
      }
    }
    res.status(201).json({ created_count: created.length, failed_count: failed.length, created, failed });
  })
);

export default router;
