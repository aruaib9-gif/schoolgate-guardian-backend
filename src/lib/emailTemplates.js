/**
 * emailTemplates.js — the transactional emails the platform sends.
 *
 * Each builder returns { subject, body, html }. `body` is the plain-text
 * fallback (some clients and most spam filters want it) and always contains the
 * raw link, so the email still works if HTML is stripped.
 */
import { env } from '../config/env.js';

const BRAND = 'School Guardian';
// Served by the web app (superadmin dist includes logo-192.png). The 192px
// file rendered at 34px stays crisp on retina screens. Clients that block
// remote images fall back to the alt text + the brand name beside it.
const LOGO_URL = `${env.appUrl}/logo-192.png`;
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Shared shell: keeps every email visually consistent and mobile-friendly. */
function layout({ heading, intro, beforeCta, cta, link, footnote, outro }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.06);">
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#ffffff;border-radius:10px;padding:5px;line-height:0;">
              <img src="${LOGO_URL}" width="34" height="34" alt="${BRAND}" style="display:block;border:0;" />
            </td>
            <td style="padding-left:12px;color:#fff;font-size:17px;font-weight:800;letter-spacing:-.01em;">${BRAND}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:800;color:#0f172a;">${heading}</h1>
          <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#475569;">${intro}</p>
          ${beforeCta || ''}
          ${cta && link ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td style="border-radius:11px;background:#4f46e5;">
              <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;">${cta}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 18px;font-size:12.5px;line-height:1.6;color:#94a3b8;">
            If the button doesn't work, paste this into your browser:<br>
            <span style="color:#4f46e5;word-break:break-all;">${esc(link)}</span>
          </p>` : ''}
          ${outro ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#475569;">${outro}</p>` : ''}
          ${footnote ? `<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e6e8f0;font-size:12.5px;line-height:1.6;color:#94a3b8;">${footnote}</p>` : ''}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11.5px;color:#94a3b8;">Sent by ${BRAND}. If you weren't expecting this, you can ignore it.</p>
    </td></tr>
  </table>
</body></html>`;
}

const expiryPhrase = (d) =>
  `This link expires on ${new Date(d).toUTCString().replace(/ GMT$/, ' UTC')} and can only be used once.`;

/** New account: choose a password. Used for school admins and invited staff.
 *  With `tempPassword` set, the email also carries sign-in credentials so the
 *  person can log in immediately; the link lets them replace the temporary
 *  password with their own. */
export function welcomeInvite({ name, email, link, expiresAt, schoolName, tempPassword }) {
  const who = name ? name.split(' ')[0] : 'there';
  const where = schoolName ? ` for <strong>${esc(schoolName)}</strong>` : '';

  const credsHtml = tempPassword ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f6f7fb;border:1px solid #e6e8f0;border-radius:12px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Your sign-in details</div>
              <div style="margin-top:10px;font-size:14px;color:#0f172a;">Username: <strong>${esc(email)}</strong></div>
              <div style="margin-top:4px;font-size:14px;color:#0f172a;">Temporary password: <strong style="font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;">${esc(tempPassword)}</strong></div>
            </td></tr>
          </table>` : '';

  return {
    subject: schoolName ? `Set up your ${schoolName} account` : `Set up your ${BRAND} account`,
    body: [
      `Hi ${who},`, '',
      `An account has been created for you${schoolName ? ` for ${schoolName}` : ''}.`,
      `Your sign-in email is: ${email}`,
      ...(tempPassword ? [`Your temporary password is: ${tempPassword}`] : []), '',
      tempPassword ? 'Change your temporary password here:' : 'Choose your password here:', link, '',
      expiryPhrase(expiresAt).replace(/<[^>]+>/g, ''), '',
      `— ${BRAND}`,
    ].join('\n'),
    html: layout({
      heading: `Welcome, ${esc(who)} 👋`,
      intro: `An account has been created for you${where}.${tempPassword
        ? ' You can sign in right away with the details below — then use the button to replace the temporary password with your own.'
        : ` Choose a password to get started — your sign-in email is <strong>${esc(email)}</strong>.`}`,
      beforeCta: credsHtml,
      cta: tempPassword ? 'Change your password' : 'Set your password',
      link,
      footnote: `${expiryPhrase(expiresAt)}${tempPassword ? ' Please change the temporary password after your first sign-in.' : ' For your security we never send passwords by email.'}`,
    }),
  };
}

/** Self-service password reset. */
export function passwordReset({ name, email, link, expiresAt }) {
  const who = name ? name.split(' ')[0] : 'there';
  return {
    subject: `Reset your ${BRAND} password`,
    body: [
      `Hi ${who},`, '',
      `We received a request to reset the password for ${email}.`, '',
      'Reset it here:', link, '',
      expiryPhrase(expiresAt),
      "If you didn't request this, ignore this email — your password won't change.", '',
      `— ${BRAND}`,
    ].join('\n'),
    html: layout({
      heading: 'Reset your password',
      intro: `We received a request to reset the password for <strong>${esc(email)}</strong>.`,
      cta: 'Choose a new password',
      link,
      footnote: `${expiryPhrase(expiresAt)} If you didn't request this, you can safely ignore this email — your password won't change.`,
    }),
  };
}

/** Billing invoice with a Pay Now link (Paystack checkout). */
export function invoiceEmail({ schoolName, planName, amount, currency = 'NGN', periodLabel, payUrl, invoiceId }) {
  const naira = `₦${Number(amount).toLocaleString('en-NG')}`;
  const box = `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f6f7fb;border:1px solid #e6e8f0;border-radius:12px;">
            <tr><td style="padding:16px 18px;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;">Invoice ${esc(invoiceId ? `#${invoiceId.slice(-8).toUpperCase()}` : '')}</div>
              <div style="margin-top:10px;font-size:14px;color:#0f172a;">School: <strong>${esc(schoolName)}</strong></div>
              <div style="margin-top:4px;font-size:14px;color:#0f172a;">Plan: <strong>${esc(planName)}</strong> · ${esc(periodLabel)}</div>
              <div style="margin-top:10px;font-size:22px;font-weight:800;color:#0f172a;">${esc(naira)}</div>
            </td></tr>
          </table>`;
  return {
    subject: `${schoolName}: ${planName} subscription invoice — ${naira}`,
    body: [
      `Invoice for ${schoolName}`, '',
      `Plan: ${planName} (${periodLabel})`,
      `Amount due: ${naira} ${currency}`, '',
      'Pay securely here:', payUrl, '',
      `— ${BRAND}`,
    ].join('\n'),
    html: layout({
      heading: 'Your subscription invoice',
      intro: `Here is the ${esc(planName)} subscription invoice for <strong>${esc(schoolName)}</strong>. Payment is handled securely by Paystack.`,
      beforeCta: box,
      cta: 'Pay now',
      link: payUrl,
      footnote: 'Questions about this invoice? Just reply to this email.',
    }),
  };
}

/** Trial ending soon. */
export function trialEnding({ schoolName, daysLeft, planName }) {
  const when = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  return {
    subject: `${schoolName}: your trial ends ${when}`,
    body: [
      `Your ${BRAND} trial for ${schoolName} ends ${when}.`, '',
      `To keep access to ${planName} features, contact us to activate a subscription.`,
      'Your data stays safe either way — nothing is deleted when a trial ends.', '',
      `— ${BRAND}`,
    ].join('\n'),
    html: layout({
      heading: `Your trial ends ${esc(when)}`,
      intro: `The ${BRAND} trial for <strong>${esc(schoolName)}</strong> ends ${esc(when)}. To keep using ${esc(planName)} features without interruption, activate a subscription.`,
      outro: 'Your data stays safe either way — nothing is deleted when a trial ends.',
      footnote: `Questions? Just reply to this email.`,
    }),
  };
}

/** Account suspended — read-only grace period. */
export function schoolSuspended({ schoolName, graceDays }) {
  return {
    subject: `${schoolName}: account suspended`,
    body: [
      `Access to ${BRAND} for ${schoolName} has been suspended.`, '',
      `Your team can still sign in and read existing records for the next ${graceDays} days, but cannot add or change anything.`,
      'No data has been deleted. Reply to this email to restore access.', '',
      `— ${BRAND}`,
    ].join('\n'),
    html: layout({
      heading: 'Account suspended',
      intro: `Access to ${BRAND} for <strong>${esc(schoolName)}</strong> has been suspended.`,
      outro: `Your team can still sign in and <strong>read</strong> existing records for the next ${graceDays} days, but cannot add or change anything. No data has been deleted.`,
      footnote: 'Reply to this email to restore access.',
    }),
  };
}
