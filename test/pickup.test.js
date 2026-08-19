import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

/**
 * Guards the pickup-code rules. These mirror src/routes/pickup.routes.js —
 * if that signing scheme changes, these must change with it deliberately,
 * because a silent drift here is a child leaving with the wrong adult.
 */
const SECRET = 'test-secret-for-pickup-codes';
const GATE_WINDOW_MS = 3 * 60 * 1000;

const sig = (childId, email) =>
  createHmac('sha256', SECRET).update(`pickup|${childId}|${(email || '').toLowerCase()}`).digest('base64url').slice(0, 16);
const rotSig = (childId, email, counter) =>
  createHmac('sha256', SECRET).update(`pickup2|${childId}|${(email || '').toLowerCase()}|${counter}`).digest('base64url').slice(0, 16);

test('home code is bound to the child — it cannot be moved to a sibling', () => {
  const parent = 'mum@example.com';
  assert.notEqual(sig('childA', parent), sig('childB', parent));
});

test('home code is bound to the parent — another parent cannot mint it', () => {
  assert.notEqual(sig('childA', 'mum@example.com'), sig('childA', 'stranger@example.com'));
});

test('parent email is matched case-insensitively', () => {
  assert.equal(sig('childA', 'Mum@Example.com'), sig('childA', 'mum@example.com'));
});

test('gate code differs every window, so a screenshot goes stale', () => {
  const c = Math.floor(Date.now() / GATE_WINDOW_MS);
  assert.notEqual(rotSig('childA', 'mum@example.com', c), rotSig('childA', 'mum@example.com', c + 1));
});

test('gate and home signatures never collide for the same child+parent', () => {
  const c = Math.floor(Date.now() / GATE_WINDOW_MS);
  assert.notEqual(sig('childA', 'mum@example.com'), rotSig('childA', 'mum@example.com', c));
});

test('window acceptance covers ±1 and rejects anything older', () => {
  // The route accepts |now - counter| <= 1: current, one late, one early.
  const accepted = (now, counter) => Math.abs(now - counter) <= 1;
  const now = 1000;
  assert.ok(accepted(now, now), 'current window');
  assert.ok(accepted(now, now - 1), 'code minted one window ago still scans');
  assert.ok(accepted(now, now + 1), 'clock skew ahead tolerated');
  assert.ok(!accepted(now, now - 2), 'two windows old is refused');
  assert.ok(!accepted(now, now - 20), 'yesterday\'s screenshot is refused');
});

test('a gate code expires within roughly ten minutes at worst', () => {
  const worstCaseMs = 2 * GATE_WINDOW_MS; // own window + the one window of grace
  assert.ok(worstCaseMs <= 10 * 60 * 1000, `stale window too generous: ${worstCaseMs}ms`);
});
