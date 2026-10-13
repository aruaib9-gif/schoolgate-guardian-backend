import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, badRequest } from '../middleware/error.js';
import { sendEmail } from '../lib/email.js';
import { deletionRequest, deletionAcknowledgement } from '../lib/emailTemplates.js';

/**
 * Account deletion requests from the public site.
 *
 * Google Play requires a route to account and data deletion that a person can
 * reach without installing the app, so this is the endpoint behind
 * /delete-account on the website.
 *
 * It opens a request rather than deleting anything on the spot, and that is
 * deliberate, not a shortcut. The school is the controller of its own pupil
 * roll: a parent asking us to erase them must not take their child off the
 * register, and the gate log is the school's safeguarding record, which it is
 * required to keep. So the request goes to support and the school acts on it.
 * The page says exactly that, and names the turnaround, because a deletion
 * route nobody can predict the outcome of is not really a deletion route.
 *
 * Shaped like the enquiry endpoint next door: unauthenticated, tightly limited,
 * every field capped, nothing stored. Requesting deletion of an account is not
 * a reason to open a new record about the person.
 */
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,                      // per hour, per IP
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests from this connection. Please try again later, or email us directly.' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

router.post(
  '/',
  limiter,
  asyncHandler(async (req, res) => {
    const name = clip(req.body?.name, 120);
    const email = clip(req.body?.email, 200).toLowerCase();
    const school = clip(req.body?.school, 160);
    const scope = clip(req.body?.scope, 40) === 'data' ? 'data' : 'account';
    const reason = clip(req.body?.reason, 2000);

    if (!name) throw badRequest('Please tell us your name.');
    if (!EMAIL_RE.test(email)) {
      throw badRequest('Please give the email address of the account you want removed.');
    }

    // Same honeypot as the enquiry form: a hidden field only a bot fills in.
    if (clip(req.body?.website, 200)) {
      return res.status(202).json({ received: true });
    }

    const to = process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL;
    if (!to) throw badRequest('Deletion requests are not configured yet. Please email us directly.');

    const mail = deletionRequest({ name, email, school, scope, reason });
    await sendEmail({ to, from_name: 'School Guardian site', replyTo: email, ...mail });

    // Acknowledge to the requester, so they hold proof they asked and by when
    // to expect it. A failure here must not fail the request — the request is
    // already with support, and telling them it did not go through would be
    // worse than them not getting a receipt.
    try {
      await sendEmail({ to: email, from_name: 'School Guardian', ...deletionAcknowledgement({ name, scope }) });
    } catch (e) {
      console.error('[account-deletion] acknowledgement to requester failed:', e?.message);
    }

    res.status(201).json({ received: true });
  })
);

export default router;
