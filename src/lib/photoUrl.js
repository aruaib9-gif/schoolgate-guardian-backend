import { publicBase, legacyBase } from './storage.js';

/**
 * A person's photo is shown on their ID card and to whoever scans them at the
 * gate, so it has to be a picture we are actually serving. Accepting any URL an
 * admin can type would let a third-party host watch the school's gate traffic —
 * every scan would fetch the image and hand that host a log of who was scanned,
 * where and when. So a photo is only ever a file that came back from our own
 * upload endpoint.
 *
 * Two prefixes are allowed, not one: wherever uploads go now, and the API's own
 * /uploads path that they went to before the move to object storage. Without
 * the second, editing anyone enrolled before the switch would fail on the photo
 * they already had.
 */
const ALLOWED_PREFIXES = [...new Set([publicBase, legacyBase])]
  .filter(Boolean)
  .map((base) => `${base}/`);

/**
 * The shape of a filename our upload endpoint issues. Deliberately narrow: no
 * slash, no percent sign, no query, no fragment, nothing to re-interpret
 * further down.
 */
const VALID_STORED_NAME = /^[A-Za-z0-9._-]+$/;

export function normalisePhotoUrl(value) {
  if (value === undefined) return undefined;          // field not supplied
  if (value === null || value === '') return null;    // clearing the photo
  if (typeof value !== 'string') return null;

  const prefix = ALLOWED_PREFIXES.find((p) => value.startsWith(p));
  if (!prefix) return null;

  // Allowlist, not blocklist — as with the upload type check. We generate every
  // stored filename ourselves (a timestamp, a nanoid, and a scrubbed original
  // name), so the set of legal characters is known exactly, and anything else
  // is not a name we issued. Blocklisting "/" and ".." let percent-encoded
  // traversal through: "%2e%2e%2f" holds neither, and decodes to "../".
  const name = value.slice(prefix.length);
  if (!VALID_STORED_NAME.test(name)) return null;
  return value;
}
