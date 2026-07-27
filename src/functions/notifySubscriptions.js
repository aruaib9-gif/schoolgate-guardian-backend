/**
 * notifySubscriptions — warns school admins about trials ending and confirms
 * suspensions. Intended to run daily from the scheduler:
 *   POST /functions/notifySubscriptions   (header: x-cron-secret)
 *
 * Idempotent per day: a school is only emailed on the specific day-marks below,
 * so re-running the job within a day won't spam anyone.
 */
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { trialEnding, schoolSuspended } from '../lib/emailTemplates.js';
import { planById } from '../lib/plans.js';
import { GRACE_DAYS } from '../middleware/subscription.js';

// Warn at these many days remaining.
const WARN_AT_DAYS = [7, 3, 1, 0];
const dayDiff = (a, b) => Math.floor((a - b) / 86400000);

export async function notifySubscriptions() {
  const now = Date.now();
  const sent = [];

  // --- trials ending -------------------------------------------------------
  const trials = await prisma.school.findMany({
    where: { status: 'trial', trial_ends_at: { not: null }, admin_email: { not: null } },
  });
  for (const s of trials) {
    const daysLeft = dayDiff(s.trial_ends_at.getTime(), now);
    if (!WARN_AT_DAYS.includes(daysLeft)) continue;
    const mail = trialEnding({
      schoolName: s.name,
      daysLeft,
      planName: planById(s.subscription_plan).name,
    });
    const r = await sendEmail({ to: s.admin_email, from_name: 'School Guardian', ...mail });
    sent.push({ school: s.name, type: 'trial_ending', daysLeft, to: s.admin_email, delivered: r.delivered });
  }

  // --- suspensions (confirm once, on the day it happened) ------------------
  const suspended = await prisma.school.findMany({
    where: { status: 'suspended', suspended_at: { not: null }, admin_email: { not: null } },
  });
  for (const s of suspended) {
    if (dayDiff(now, s.suspended_at.getTime()) !== 0) continue; // only day 0
    const mail = schoolSuspended({ schoolName: s.name, graceDays: GRACE_DAYS });
    const r = await sendEmail({ to: s.admin_email, from_name: 'School Guardian', ...mail });
    sent.push({ school: s.name, type: 'suspended', to: s.admin_email, delivered: r.delivered });
  }

  return { success: true, checked: trials.length + suspended.length, sent: sent.length, details: sent };
}
