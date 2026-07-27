/**
 * authTokens.js — one-time links for "set your password" and "reset password".
 *
 * The raw token is returned once (to be emailed) and never stored: the database
 * only holds its SHA-256 hash, so a database leak cannot be replayed into
 * account takeover. Tokens are single-use and expire.
 */
import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';

const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

const TTL_MS = {
  invite: () => env.inviteTtlDays * 86400000,
  reset: () => env.resetTtlHours * 3600000,
};

/**
 * Issue a token for a user. Any earlier unused token for the same purpose is
 * invalidated, so only the most recent email ever works.
 * @returns {{ token: string, expires_at: Date }} raw token — email it, don't log it
 */
export async function issueToken({ user, purpose = 'invite', createdBy }) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expires_at = new Date(Date.now() + (TTL_MS[purpose] || TTL_MS.invite)());

  await prisma.authToken.updateMany({
    where: { user_id: user.id, purpose, used_at: null },
    data: { used_at: new Date() }, // supersede older links
  });
  await prisma.authToken.create({
    data: {
      token_hash: hash(raw),
      purpose,
      user_id: user.id,
      email: user.email,
      expires_at,
      created_by: createdBy || null,
    },
  });
  return { token: raw, expires_at };
}

/** Look up a token without consuming it. Returns null when invalid/expired/used. */
export async function peekToken(raw, purpose) {
  if (!raw) return null;
  const row = await prisma.authToken.findUnique({ where: { token_hash: hash(raw) } });
  if (!row) return null;
  if (purpose && row.purpose !== purpose) return null;
  if (row.used_at) return null;
  if (row.expires_at.getTime() < Date.now()) return null;
  return row;
}

/** Validate and consume a token in one step. Returns the row, or null. */
export async function consumeToken(raw, purpose) {
  const row = await peekToken(raw, purpose);
  if (!row) return null;
  // Guard against two clicks racing: only the update that flips used_at wins.
  const claimed = await prisma.authToken.updateMany({
    where: { id: row.id, used_at: null },
    data: { used_at: new Date() },
  });
  return claimed.count === 1 ? row : null;
}

/** The link a recipient clicks. Points at the web app, not the API. */
export function linkFor(purpose, token) {
  const path = purpose === 'reset' ? 'reset-password' : 'accept-invite';
  return `${env.appUrl}/${path}?token=${encodeURIComponent(token)}`;
}
