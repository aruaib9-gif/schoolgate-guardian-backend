import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, badRequest } from '../middleware/error.js';
import { sendEmail } from '../lib/email.js';
import { contactEnquiry } from '../lib/emailTemplates.js';

/**
 * Enquiries from the public site.
 *
 * The only unauthenticated write in the API, so it is deliberately narrow: a
 * tight rate limit, a length cap on every field, and nothing is stored — the
 * message is relayed to the support inbox and forgotten. Reply-to is set to the
 * sender, so answering is just hitting reply.
 */
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,                      // per hour, per IP
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many enquiries from this connection. Please try again later, or email us directly.' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

router.post(
  '/',
  limiter,
  asyncHandler(async (req, res) => {
    const name = clip(req.body?.name, 120);
    const email = clip(req.body?.email, 200).toLowerCase();
    const phone = clip(req.body?.phone, 40);
    const school = clip(req.body?.school, 160);
    const message = clip(req.body?.message, 4000);

    if (!name) throw badRequest('Please tell us your name.');
    if (!EMAIL_RE.test(email)) throw badRequest('Please give an email address we can reply to.');
    if (message.length < 10) throw badRequest('Please tell us a little more about what you need.');

    // A bot filling every field is the usual signature; a hidden field that a
    // human never sees costs nothing and stops most of it.
    if (clip(req.body?.website, 200)) {
      return res.status(202).json({ received: true }); // look successful, go nowhere
    }

    const to = process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL;
    if (!to) throw badRequest('Enquiries are not configured yet. Please email us directly.');

    const mail = contactEnquiry({ name, email, phone, school, message });
    await sendEmail({ to, from_name: 'School Guardian site', replyTo: email, ...mail });

    res.status(201).json({ received: true });
  })
);

export default router;
