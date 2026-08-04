import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * paystack.js — thin client for the Paystack calls billing needs.
 * Amounts on our side are naira; Paystack wants kobo (×100).
 *
 * Two universes can be configured at once:
 *   live → PAYSTACK_SECRET_KEY      (real money)
 *   test → PAYSTACK_TEST_SECRET_KEY (test cards, no money moves)
 * Every invoice records which mode it was initialised in, so its checkout
 * and verification always use the matching key.
 */
const BASE = 'https://api.paystack.co';

function keyFor(mode) {
  const key = mode === 'test' ? env.paystackTestSecretKey : env.paystackSecretKey;
  if (!key) {
    const err = new Error(`Paystack ${mode} mode is not configured (${mode === 'test' ? 'PAYSTACK_TEST_SECRET_KEY' : 'PAYSTACK_SECRET_KEY'} is unset)`);
    err.status = 503;
    throw err;
  }
  return key;
}

async function call(path, { method = 'GET', body, mode = 'live' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${keyFor(mode)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    const err = new Error(`Paystack: ${data.message || res.statusText}`);
    err.status = 502;
    throw err;
  }
  return data.data;
}

/** Create a checkout link. Returns { authorization_url, access_code, reference }. */
export function initializeTransaction({ email, amountNaira, reference, metadata, mode = 'live' }) {
  return call('/transaction/initialize', {
    method: 'POST',
    mode,
    body: {
      email,
      amount: Math.round(amountNaira * 100), // kobo
      currency: 'NGN',
      reference,
      metadata,
    },
  });
}

/** Confirm a transaction's final state directly with Paystack. */
export function verifyTransaction(reference, mode = 'live') {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`, { mode });
}

function hmacMatches(rawBody, signature, key) {
  if (!key) return false;
  const expected = createHmac('sha512', key).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Validate a webhook came from Paystack and identify which universe sent it.
 * Returns 'live', 'test', or null (invalid). Both webhook URLs (live + test)
 * can point at the same endpoint.
 */
export function webhookMode(rawBody, signature) {
  if (!signature) return null;
  if (hmacMatches(rawBody, signature, env.paystackSecretKey)) return 'live';
  if (hmacMatches(rawBody, signature, env.paystackTestSecretKey)) return 'test';
  return null;
}
