/**
 * The upload chain end to end: an image arrives, is re-encoded, is stored, and
 * the address it is stored at is one the photo validator accepts. That last
 * link is the one worth testing — if the validator were stricter than the
 * name generator, a photo would upload fine and then vanish the next time
 * anyone saved that person.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-upload-'));
process.env.NODE_ENV = 'test';
process.env.PUBLIC_URL = 'https://api.example.com';
process.env.UPLOAD_DIR = tmp;

const { processUpload } = await import('../src/lib/photoPipeline.js');
const storage = await import('../src/lib/storage.js');
const { normalisePhotoUrl } = await import('../src/lib/photoUrl.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A 3000x4000 phone photo: noisy, so it compresses like a real photograph. */
async function phonePhoto({ orientation = 1 } = {}) {
  const noise = await sharp({
    create: { width: 3000, height: 4000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  }).jpeg({ quality: 92 }).toBuffer();
  return sharp(noise).withMetadata({ orientation }).toBuffer();
}

describe('an uploaded photo', () => {
  test('is shrunk, straightened, stripped, and stored where the validator accepts it', async () => {
    const original = await phonePhoto({ orientation: 6 });   // phone held sideways

    const { body, contentType, ext } = await processUpload({ buffer: original, mimetype: 'image/jpeg' });
    const key = storage.storedName('IMG_2043.HEIC', ext);
    const url = await storage.put({ key, body, contentType });

    const meta = await sharp(body).metadata();
    assert.ok(body.length < original.length / 10, `expected a large reduction, got ${original.length} -> ${body.length}`);
    assert.ok(Math.max(meta.width, meta.height) <= 800, 'longest edge should be capped at 800');
    assert.equal(meta.width, 800, 'orientation 6 should have been baked in, swapping the axes');
    assert.equal(meta.height, 600);
    assert.ok(!meta.exif, 'EXIF — which carries the GPS location the photo was taken at — must be gone');
    assert.equal(contentType, 'image/jpeg');

    // Stored where it says it is...
    assert.ok(fs.existsSync(path.join(tmp, key)), 'the file should be on disk under its key');
    // ...and that address survives the rule that guards every write.
    assert.equal(normalisePhotoUrl(url), url, `the validator rejected our own upload: ${url}`);
  });

  test('a small photo is not blown up', async () => {
    const small = await sharp({ create: { width: 200, height: 240, channels: 3, background: '#555' } }).jpeg().toBuffer();
    const { body } = await processUpload({ buffer: small, mimetype: 'image/jpeg' });
    const meta = await sharp(body).metadata();
    assert.equal(meta.width, 200);
    assert.equal(meta.height, 240);
  });

  test('a PDF is stored exactly as it arrived', async () => {
    const pdf = Buffer.from('%PDF-1.4\nnot really a pdf\n%%EOF');
    const { body, contentType, ext } = await processUpload({ buffer: pdf, mimetype: 'application/pdf' });
    assert.ok(body.equals(pdf), 'a document must not be re-encoded');
    assert.equal(contentType, 'application/pdf');
    assert.equal(ext, '.pdf');
  });

  test('a file claiming to be an image is a 400, not a 500', async () => {
    await assert.rejects(
      () => processUpload({ buffer: Buffer.from('<html><script>alert(1)</script></html>'), mimetype: 'image/png' }),
      (err) => err.status === 400
    );
  });

  test('the stored name is never a path, whatever it was called', () => {
    for (const original of ['../../etc/passwd', 'a/b/c.png', '..', '']) {
      const key = storage.storedName(original, '.jpg');
      assert.ok(!key.includes('/'), `"${original}" produced a key with a slash: ${key}`);
      assert.ok(!key.includes('..'), `"${original}" produced a key that can climb: ${key}`);
    }
  });
});
