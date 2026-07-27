/**
 * email.js — one send function, three interchangeable transports.
 *
 *   EMAIL_PROVIDER=resend   → Resend HTTP API (recommended for production)
 *   EMAIL_PROVIDER=smtp     → nodemailer (any SMTP host)
 *   EMAIL_PROVIDER=console  → log only (default when nothing is configured)
 *
 * The provider is picked automatically: Resend if RESEND_API_KEY is set, else
 * SMTP if SMTP_HOST is set, else console. Every caller keeps using sendEmail()
 * unchanged, so adding Resend needed no changes anywhere else.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function smtpTransport() {
  if (transporter) return transporter;
  if (!env.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

/** Which transport to use, given the current configuration. */
export function activeProvider() {
  const forced = (env.emailProvider || '').toLowerCase();
  if (forced === 'resend') return env.resendApiKey ? 'resend' : 'console';
  if (forced === 'smtp') return env.smtp.host ? 'smtp' : 'console';
  if (forced === 'console') return 'console';
  if (env.resendApiKey) return 'resend';
  if (env.smtp.host) return 'smtp';
  return 'console';
}

function extractAddress(str) {
  const m = /<([^>]+)>/.exec(str);
  return m ? m[1] : str;
}

async function sendViaResend({ to, from, subject, text, html, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface Resend's own message — usually an unverified domain or bad key.
    const reason = data?.message || data?.error?.message || res.statusText;
    throw new Error(`Resend rejected the message (${res.status}): ${reason}`);
  }
  return data?.id;
}

/**
 * Send an email. Signature unchanged from the original integrations.Core.SendEmail:
 *   { to, subject, body, html?, from_name?, from?, replyTo? }
 * Never throws for a delivery failure — returns { delivered:false, error } so a
 * failed notification can't break the request that triggered it. Callers that
 * need hard failure can inspect the result.
 */
export async function sendEmail({ to, subject, body, html, from_name, from, replyTo }) {
  if (!to) throw new Error('sendEmail: "to" is required');
  const fromAddress = from || env.smtp.from;
  const displayFrom = from_name ? `${from_name} <${extractAddress(fromAddress)}>` : fromAddress;
  const provider = activeProvider();

  if (provider === 'console') {
    console.log(
      '[email:logged] (no provider configured)\n  to:', to,
      '\n  subject:', subject,
      '\n  body:\n', body || html
    );
    return { delivered: false, logged: true, provider, to, subject };
  }

  try {
    if (provider === 'resend') {
      const id = await sendViaResend({ to, from: displayFrom, subject, text: body, html, replyTo });
      return { delivered: true, logged: false, provider, to, subject, messageId: id };
    }
    const info = await smtpTransport().sendMail({
      from: displayFrom, to, subject, text: body, html: html || undefined, replyTo,
    });
    return { delivered: true, logged: false, provider, to, subject, messageId: info.messageId };
  } catch (err) {
    console.error(`[email:failed] provider=${provider} to=${to} subject="${subject}":`, err.message);
    return { delivered: false, logged: false, provider, to, subject, error: err.message };
  }
}
