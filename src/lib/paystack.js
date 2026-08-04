import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * paystack.js — thin client for the two Paystack calls billing needs.
 * Amounts on our side are naira; Paystack wants kobo (×100).
 */
const BASE = 'https://api.paystack.co';

function assertConfigured() {
  if (!env.paystackSecretKey) {
    const err = new Error('Paystack is not configured (PAYSTACK_SECRET_KEY is unset)');
    err.status = 503;
    throw err;
  }
}

async function call(path, { method = 'GET', body } = {}) {
  assertConfigured();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
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
export function initializeTransaction({ email, amountNaira, reference, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
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
export function verifyTransaction(reference) {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Validate a webhook came from Paystack (HMAC-SHA512 of the raw body). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !env.paystackSecretKey) return false;
  const expected = createHmac('sha512', env.paystackSecretKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}
