import { Router } from 'express';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma.js';
import { requireAuth, ADMIN_ROLES } from '../middleware/auth.js';
import { asyncHandler, notFound, forbidden, badRequest } from '../middleware/error.js';
import { computeCharge, planById, cycleById } from '../lib/plans.js';
import { initializeTransaction, verifyTransaction, webhookMode } from '../lib/paystack.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

async function platformConfig() {
  return (await prisma.platformConfig.findFirst()) || {};
}

function schoolAdminOnly(req) {
  if (!ADMIN_ROLES.has(req.role)) throw forbidden('Billing is only visible to administrators');
  if (!req.user.school_id) throw badRequest('Your account is not linked to a school');
}

/**
 * GET /api/billing/me — what the signed-in school admin owes and has paid.
 * Includes the live charge computation so the dashboard always matches what
 * the superadmin console would invoice.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    schoolAdminOnly(req);
    const school = await prisma.school.findUnique({ where: { id: req.user.school_id } });
    if (!school) throw notFound('School not found');
    const config = await platformConfig();
    const charge = computeCharge(
      { ...school, subscription_plan: school.subscription_plan, students: school.students ?? 0, staff: school.staff ?? 0 },
      config
    );
    const invoices = await prisma.invoice.findMany({
      where: { school_id: school.id },
      orderBy: { created_date: 'desc' },
      take: 12,
    });
    res.json({
      school: { id: school.id, name: school.name, plan: school.subscription_plan, status: school.status },
      plan: planById(school.subscription_plan),
      charge,
      invoices,
      pending: invoices.find((i) => i.status === 'pending') || null,
    });
  })
);

/**
 * POST /api/billing/invoices/:id/pay — get (or refresh) the Paystack checkout
 * link for a pending invoice. School admins only, own school only.
 */
router.post(
  '/invoices/:id/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    schoolAdminOnly(req);
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) throw notFound('Invoice not found');
    const crossTenant = req.role === 'superadmin' || req.role === 'head_of_schools';
    if (!crossTenant && invoice.school_id !== req.user.school_id) throw notFound('Invoice not found');
    if (invoice.status === 'paid') throw badRequest('This invoice is already paid');
    if (invoice.status === 'void') throw badRequest('This invoice was voided');

    // Fresh reference per attempt — Paystack references are single-use.
    const reference = `sgg_${invoice.id.slice(-8)}_${nanoid(8)}`;
    const tx = await initializeTransaction({
      email: req.user.email,
      amountNaira: invoice.amount,
      reference,
      mode: invoice.mode || 'live',
      metadata: { invoice_id: invoice.id, school_id: invoice.school_id, school_name: invoice.school_name },
    });
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { reference, authorization_url: tx.authorization_url },
    });
    res.json({ authorization_url: tx.authorization_url, reference, invoice: updated });
  })
);

/**
 * Webhook handler (wired in app.js with a raw body so the HMAC signature can
 * be verified). Marks invoices paid on charge.success — after re-verifying
 * the transaction with Paystack directly, so a forged webhook that somehow
 * beat the HMAC still could not mark anything paid.
 */
export async function paystackWebhook(req, res) {
  const signature = req.headers['x-paystack-signature'];
  // Identifies which universe (live/test) signed the event — or rejects it.
  const mode = webhookMode(req.body, signature);
  if (!mode) return res.status(401).json({ error: 'Invalid signature' });
  const event = JSON.parse(req.body.toString('utf8'));
  if (event.event !== 'charge.success') return res.json({ received: true });

  const reference = event.data?.reference;
  const invoice = reference && (await prisma.invoice.findUnique({ where: { reference } }));
  if (!invoice || invoice.status === 'paid') return res.json({ received: true });

  const tx = await verifyTransaction(reference, mode); // belt and braces
  if (tx.status !== 'success') return res.json({ received: true });
  const paidNaira = Math.round((tx.amount || 0) / 100);
  if (paidNaira < invoice.amount) {
    console.warn(`[billing] underpayment on ${reference}: got ₦${paidNaira}, expected ₦${invoice.amount}`);
    return res.json({ received: true });
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'paid', paid_at: new Date(), paid_channel: tx.channel || 'paystack' },
  });
  await writeAudit(
    { user: { email: 'paystack-webhook' }, role: 'service' },
    {
      action: 'update',
      entity_type: 'Invoice',
      entity_id: invoice.id,
      description: `Invoice for ${invoice.school_name || invoice.school_id} paid — ₦${invoice.amount.toLocaleString('en-NG')} via ${tx.channel || 'paystack'}`,
    }
  ).catch(() => {});
  console.log(`[billing] invoice ${invoice.id} PAID (₦${invoice.amount}) ref=${reference}`);
  res.json({ received: true });
}

export default router;
