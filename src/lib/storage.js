import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

/**
 * Where uploaded files live.
 *
 * Two drivers, chosen by configuration rather than by a flag, so a developer
 * needs no cloud credentials to run the app:
 *
 *   r2    — Cloudflare R2, when R2_BUCKET and its keys are set. Files survive
 *           deploys, which the local disk on Render does not.
 *   disk  — ./uploads, served by express. The default, and what tests use.
 *
 * Callers do not care which is active: put() returns the public URL either way.
 */

const useR2 = Boolean(env.r2.bucket && env.r2.accessKeyId && env.r2.secretAccessKey && env.r2.accountId);

export const driver = useR2 ? 'r2' : 'disk';

/**
 * The URL prefix that a stored file's address begins with. photoUrl.js holds a
 * photo to this prefix, so a photo can only ever be a file we put there.
 */
export const publicBase = useR2 ? env.r2.publicBase : `${env.publicUrl}/uploads`;

/**
 * Addresses written before the move to object storage. Still our own host, so
 * still safe by the same rule — accepted on read and on re-save so that editing
 * a person enrolled before the switch does not fail on their old photo.
 */
export const legacyBase = `${env.publicUrl}/uploads`;

// Built once, lazily: constructing it opens no connection, but there is no
// reason to build it at all on the disk driver.
let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: 'auto',                     // R2 ignores region; 'auto' is its documented value
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
    });
  }
  return client;
}

// Created on first write rather than on import: this module is pulled in by the
// photo validator, which is pulled in by every entity write, and importing a
// validator should not create directories.
let dirReady = false;

/**
 * The origins a stored photo can be served from, as a CSP source list.
 *
 * The printable ID-card sheet sets its own tight Content-Security-Policy, and
 * with photos in a bucket they are cross-origin — without this, every photo on
 * a school's printed cards would be a broken image, and nothing would say why.
 * Named origins only, never a wildcard: the policy is what stops a name
 * rendered from the database from pulling in an arbitrary image.
 */
export const imgCspSources = [...new Set([publicBase, legacyBase])]
  .filter((base) => base && !base.startsWith(`${env.publicUrl}/`))   // 'self' already covers our own host
  .join(' ');

/**
 * The name a file is stored under. The timestamp keeps the bucket browsable in
 * order, the nanoid makes the address unguessable — a photo of a child is
 * readable by anyone holding its URL — and the original name is kept, scrubbed,
 * only so a human can tell what a file is.
 *
 * Every name this produces must be one photoUrl.js accepts; the round-trip
 * test in test/photoUrlR2.test.js holds the two to each other.
 */
export function storedName(originalName, ext) {
  const base = path
    .basename(originalName || 'file', path.extname(originalName || ''))
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  return `${Date.now()}-${nanoid(8)}-${base}${ext}`;
}

/**
 * Store one file and return its public URL.
 *
 * `key` is a bare filename, never a path — see photoUrl.js, which refuses an
 * address with anything but a filename after the prefix.
 */
export async function put({ key, body, contentType }) {
  if (key.includes('/') || key.includes('..')) {
    throw new Error(`refusing to store under a path: ${key}`);
  }

  if (driver === 'disk') {
    if (!dirReady) { await fs.promises.mkdir(env.uploadDir, { recursive: true }); dirReady = true; }
    await fs.promises.writeFile(path.join(env.uploadDir, key), body);
    return `${publicBase}/${key}`;
  }

  await s3().send(new PutObjectCommand({
    Bucket: env.r2.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Every filename carries a timestamp and a nanoid, so a given URL's bytes
    // never change. Caching them for a year keeps a gate scan from re-fetching
    // a face it already has, which is the difference between an instant check
    // and waiting on mobile data.
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${publicBase}/${key}`;
}
