import { Router } from 'express';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, notFound, forbidden } from '../middleware/error.js';

const router = Router();

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * GET /qr/cards/:schoolId — a print-ready sheet of every ID card in a school.
 *
 * Individuals cannot export their own card (a downloadable card is a forgeable
 * card), so issuing happens here: staff open this in a browser and print, or
 * "Save as PDF". Cards are laid out at true CR80 size with page breaks so a
 * card printer or A4 sheet comes out correctly.
 *
 * Optional ?category=student to print one cohort at a time.
 */
router.get(
  '/cards/:schoolId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const crossTenant = req.role === 'superadmin' || req.role === 'head_of_schools';
    if (!ADMIN_ROLES.has(req.role)) throw forbidden('Only administrators can print ID cards');
    if (!crossTenant && req.params.schoolId !== req.user.school_id) throw forbidden('You can only print cards for your own school');

    const school = await prisma.school.findUnique({ where: { id: req.params.schoolId } });
    if (!school) throw notFound('School not found');

    const where = { school_id: school.id, active: true };
    if (req.query.category) where.category = String(req.query.category);
    const people = await prisma.person.findMany({ where, orderBy: [{ category: 'asc' }, { full_name: 'asc' }] });
    if (!people.length) throw notFound('No active people to print for this school');

    const year = new Date().getFullYear();
    const cards = await Promise.all(
      people.map(async (p) => {
        const qr = await QRCode.toDataURL(p.qr_code || `PERSON-${p.id}`, {
          width: 300, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' },
        });
        const initials = (p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
        const sub = p.grade || p.department || '';
        return `
      <div class="card">
        <div class="head"><div class="brand">SCHOOL GUARDIAN</div><div class="school">${esc(school.name)}</div></div>
        <div class="body">
          ${p.photo_url
            ? `<img class="photo" src="${esc(p.photo_url)}" />`
            : `<div class="photo initials">${esc(initials)}</div>`}
          <div class="name">${esc(p.full_name)}</div>
          ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
          <div class="role"><span>${esc((p.category || 'member').replace(/_/g, ' '))}</span></div>
          <div class="rule"></div>
          <img class="qr" src="${qr}" />
          <div class="scan">SCAN FOR ACCESS</div>
          <div class="idno">ID ${esc(p.id.slice(-8).toUpperCase())}</div>
        </div>
        <div class="foot">ACCESS CONTROL SYSTEM © ${year}</div>
      </div>`;
      })
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8">
<title>${esc(school.name)} — ID cards (${people.length})</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; background:#eef2f7; padding:24px; }
  .bar { max-width:1100px; margin:0 auto 20px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;
         background:#fff; border-radius:14px; padding:16px 20px; box-shadow:0 1px 3px rgba(15,23,42,.08); }
  .bar h1 { font-size:17px; color:#0f172a; }
  .bar p { font-size:13px; color:#64748b; margin-top:2px; }
  .bar button { margin-left:auto; background:#4f46e5; color:#fff; border:0; border-radius:10px;
                padding:11px 22px; font-size:14px; font-weight:700; cursor:pointer; }
  .sheet { max-width:1100px; margin:0 auto; display:flex; flex-wrap:wrap; gap:16px; }
  .card { width:2.125in; height:3.375in; background:#fff; border-radius:11px; overflow:hidden;
          display:flex; flex-direction:column; box-shadow:0 2px 10px rgba(15,23,42,.12); }
  .head { background:linear-gradient(125deg,#1e3a8a 0%,#4f46e5 55%,#7c3aed 100%); color:#fff;
          padding:9px 10px 8px; text-align:center; }
  .brand { font-size:8.5px; font-weight:800; letter-spacing:.18em; }
  .school { font-size:6.2px; opacity:.82; margin-top:3px; text-transform:uppercase; letter-spacing:.08em;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .body { flex:1; display:flex; flex-direction:column; align-items:center; padding:9px 10px 0; }
  .photo { width:.92in; height:1.06in; border-radius:7px; border:1.5px solid #e2e8f0; object-fit:cover; }
  .initials { background:#eef2ff; color:#4f46e5; display:flex; align-items:center; justify-content:center;
              font-size:25px; font-weight:800; }
  .name { font-size:11px; font-weight:800; color:#0f172a; margin-top:7px; text-align:center; line-height:1.15; }
  .sub { font-size:6.5px; color:#64748b; margin-top:2px; }
  .role { margin-top:5px; }
  .role span { background:#4f46e5; color:#fff; font-size:6.2px; font-weight:800; letter-spacing:.12em;
               padding:3px 9px; border-radius:99px; text-transform:uppercase; }
  .rule { width:74%; height:1px; background:#e2e8f0; margin:8px 0 7px; }
  .qr { width:.86in; height:.86in; display:block; }
  .scan { font-size:5.6px; color:#94a3b8; letter-spacing:.16em; margin-top:4px; }
  .idno { font-size:6px; color:#4f46e5; font-weight:700; letter-spacing:.1em; margin-top:2px; }
  .foot { background:linear-gradient(90deg,#4f46e5,#7c3aed); color:#fff; text-align:center;
          font-size:5.6px; letter-spacing:.12em; padding:5px; margin-top:8px; }
  @media print {
    body { background:#fff; padding:0; }
    .bar { display:none; }
    .sheet { gap:0; max-width:none; }
    .card { box-shadow:none; border-radius:0; break-inside:avoid; page-break-inside:avoid; }
  }
</style></head><body>
  <div class="bar">
    <div>
      <h1>${esc(school.name)} — ID cards</h1>
      <p>${people.length} card${people.length === 1 ? '' : 's'}${req.query.category ? ` · ${esc(String(req.query.category))}s only` : ''} · print, or use your browser's “Save as PDF”</p>
    </div>
    <button onclick="window.print()">Print all</button>
  </div>
  <div class="sheet">${cards.join('')}</div>
</body></html>`);
  })
);

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
    } else if (code.startsWith('PU1.')) {
      // Parent pickup / home QR: the issuing parent (or staff) may print it.
      const childId = code.split('.')[1];
      const child = childId && (await prisma.person.findFirst({ where: { id: childId } }));
      const isParent = child && [child.father_email, child.mother_email].includes(req.user.email);
      if (!isParent && !isAdmin) throw forbidden('You cannot download this pickup code');
    } else if (code.startsWith('OTP-')) {
      const pass = await prisma.oneTimePass.findFirst({ where: { qr_code: code } });
      if (!pass) throw notFound('Unknown code');
      if (pass.parent_id !== req.user.id && !isAdmin) throw forbidden('You cannot download this pass');
    } else if (!isAdmin) {
      // Other pass codes (GP-/V-) are printable by staff only.
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
