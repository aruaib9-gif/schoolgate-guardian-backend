/**
 * push.js — Expo push notifications.
 *
 * Fire-and-forget by design: a push failure must never break the request that
 * triggered it (same philosophy as email.js). Tokens that Expo reports as
 * dead are cleared so we stop sending to uninstalled apps.
 */
import { prisma } from './prisma.js';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
// Expo needs a moment to hand the message to FCM/APNs and hear back.
const RECEIPT_DELAY_MS = 20_000;
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
      const pending = new Map(); // receipt id -> token
      for (let k = 0; k < tickets.length; k++) {
        if (tickets[k]?.status === 'ok') {
          sent++;
          if (tickets[k].id) pending.set(tickets[k].id, chunk[k]);
          continue;
        }
        failed++;
        // Rejected outright (malformed token, credentials) — drop it now.
        if (tickets[k]?.details?.error === 'DeviceNotRegistered') {
          await clearToken(chunk[k]);
        }
      }
      // A ticket saying "ok" only means Expo QUEUED it. Whether FCM actually
      // accepted the device shows up in the receipt, which is where
      // DeviceNotRegistered almost always appears — so a ticket-only check
      // left dead tokens in the database forever.
      if (pending.size) scheduleReceiptSweep(pending);
    } catch (err) {
      failed += chunk.length;
      console.warn('[push] batch failed:', err.message);
    }
  }
  if (sent || failed) console.log(`[push] "${title}" → sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

async function clearToken(token) {
  await prisma.user.updateMany({ where: { push_token: token }, data: { push_token: null } }).catch(() => {});
}

/**
 * Check delivery receipts a little later and forget tokens FCM/APNs rejected,
 * so an uninstalled app stops costing us a push on every future event.
 */
function scheduleReceiptSweep(pending) {
  const timer = setTimeout(async () => {
    try {
      const ids = [...pending.keys()];
      const res = await fetch(EXPO_RECEIPTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const out = await res.json().catch(() => ({}));
      let cleared = 0;
      for (const [id, receipt] of Object.entries(out.data || {})) {
        if (receipt?.status === 'error' && receipt?.details?.error === 'DeviceNotRegistered') {
          await clearToken(pending.get(id));
          cleared++;
        } else if (receipt?.status === 'error') {
          console.warn('[push] receipt error:', receipt.message);
        }
      }
      if (cleared) console.log(`[push] cleared ${cleared} dead token(s)`);
    } catch (err) {
      console.warn('[push] receipt sweep failed:', err.message);
    }
  }, RECEIPT_DELAY_MS);
  // Never hold the process open for a cleanup sweep.
  timer.unref?.();
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
