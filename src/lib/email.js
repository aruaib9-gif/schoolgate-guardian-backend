import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) return null; // not configured — caller falls back to console
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

/**
 * Send an email. Mirrors the original integrations.Core.SendEmail signature:
 *   { to, subject, body, from_name?, from? }
 * If SMTP is not configured the message is logged and reported as "logged"
 * so local development and demos work without a mail server.
 */
export async function sendEmail({ to, subject, body, html, from_name, from }) {
  if (!to) throw new Error('sendEmail: "to" is required');
  const fromAddress = from || env.smtp.from;
  const displayFrom = from_name ? `${from_name} <${extractAddress(fromAddress)}>` : fromAddress;

  const t = getTransporter();
  if (!t) {
    console.log('[email:logged] (SMTP not configured)\n  to:', to, '\n  subject:', subject, '\n  body:\n', body || html);
    return { delivered: false, logged: true, to, subject };
  }

  const info = await t.sendMail({
    from: displayFrom,
    to,
    subject,
    text: body,
    html: html || undefined,
  });
  return { delivered: true, logged: false, to, subject, messageId: info.messageId };
}

function extractAddress(str) {
  const m = /<([^>]+)>/.exec(str);
  return m ? m[1] : str;
}
