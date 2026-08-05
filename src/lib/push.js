/**
 * push.js — Expo push notifications.
 *
 * Fire-and-forget by design: a push failure must never break the request that
 * triggered it (same philosophy as email.js). Tokens that Expo reports as
 * dead are cleared so we stop sending to uninstalled apps.
 */
import { prisma } from './prisma.js';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[/.test(t);

/**
 * Send one notification to many tokens (chunked at Expo's 100 limit).
 * Returns { sent, failed } counts; never throws.
 */
export async function sendPush(tokens, { title, body, data = {} }) {
  const valid = [...new Set(tokens)].filter(isExpoToken);
  if (!valid.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((to) => ({ to, sound: 'default', title, body, data }))),
      });
      const out = await res.json().catch(() => ({}));
      const tickets = out.data || [];
      for (let k = 0; k < tickets.length; k++) {
        if (tickets[k]?.status === 'ok') { sent++; continue; }
        failed++;
        // DeviceNotRegistered → the app was uninstalled; stop pushing to it.
        if (tickets[k]?.details?.error === 'DeviceNotRegistered') {
          await prisma.user.updateMany({ where: { push_token: chunk[k] }, data: { push_token: null } }).catch(() => {});
        }
      }
    } catch (err) {
      failed += chunk.length;
      console.warn('[push] batch failed:', err.message);
    }
  }
  if (sent || failed) console.log(`[push] "${title}" → sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

/** Tokens for all active users matching a where clause. */
export async function tokensFor(where) {
  const users = await prisma.user.findMany({
    where: { ...where, is_active: true, push_token: { not: null } },
    select: { push_token: true },
  });
  return users.map((u) => u.push_token);
}

/**
 * Push for a newly created Message row — mirrors who would see it in the app.
 * Called fire-and-forget from the entity layer.
 */
export async function notifyMessagePush(message) {
  if (!message?.school_id) return;
  const where = { school_id: message.school_id };
  if (message.recipient_type === 'role' && message.recipient_role) {
    where.user_category = message.recipient_role;
  } else if (message.recipient_type === 'user' && message.recipient_id) {
    where.id = message.recipient_id;
  }
  // Don't push the announcement back to its author.
  if (message.sender_id) where.NOT = { id: message.sender_id };
  const tokens = await tokensFor(where);
  await sendPush(tokens, {
    title: message.subject || 'New message',
    body: (message.body || '').slice(0, 160),
    data: { type: 'message', id: message.id },
  });
}
