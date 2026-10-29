import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The allowlist is fixed when the module loads, so configuration comes first.
process.env.PUBLIC_URL = 'https://api.example.com';
process.env.R2_ACCOUNT_ID = 'acct123';
process.env.R2_BUCKET = 'schoolguardian-photos';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_PUBLIC_BASE = 'https://pub-ours.r2.dev';

const { normalisePhotoUrl } = await import('../src/lib/photoUrl.js');
const storage = await import('../src/lib/storage.js');

const INBUCKET = 'https://pub-ours.r2.dev/1700000000-ab12cd34-photo.jpg';
const LEGACY = 'https://api.example.com/uploads/1600000000-zz99yy88-photo.jpg';

describe('with object storage configured', () => {
  test('the bucket driver is the one selected', () => {
    assert.equal(storage.driver, 'r2');
    assert.equal(storage.publicBase, 'https://pub-ours.r2.dev');
  });

  /**
   * The printable ID-card sheet sets its own tight CSP. With photos in a
   * bucket they are cross-origin, so without the bucket named in img-src every
   * photo on a school's printed cards is a broken image — and the page would
   * look merely photo-less rather than broken.
   */
  test('the bucket origin is offered to the ID-card page CSP, without a wildcard', () => {
    assert.equal(storage.imgCspSources, 'https://pub-ours.r2.dev');
    assert.ok(!storage.imgCspSources.includes('*'), 'never a wildcard: the policy is what blocks arbitrary images');
  });

  test('a file in our bucket is kept', () => {
    assert.equal(normalisePhotoUrl(INBUCKET), INBUCKET);
  });

  /**
   * The point of accepting two prefixes. Everyone enrolled before the switch
   * has a photo at the API's own /uploads path; if that stopped validating,
   * saving any edit to those people — a changed phone number, a new class —
   * would fail on a photo nobody touched.
   */
  test('a photo stored before the switch is still valid', () => {
    assert.equal(normalisePhotoUrl(LEGACY), LEGACY);
  });

  /**
   * The one that matters most. r2.dev is shared by every Cloudflare customer,
   * so another account's bucket is a sibling on the same parent domain — not a
   * stranger's domain. Any check loose enough to accept "ends with .r2.dev"
   * would let anybody with a free Cloudflare account host the image that every
   * gate scan fetches, and so collect the school's attendance log.
   */
  test("another customer's bucket on the same shared domain is refused", () => {
    assert.equal(normalisePhotoUrl('https://pub-someoneelse.r2.dev/x.jpg'), null);
    assert.equal(normalisePhotoUrl('https://r2.dev/x.jpg'), null);
  });

  test('a host that merely starts with ours is refused', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev.evil.test/x.jpg'), null);
  });

  test('plain http to the bucket is refused', () => {
    assert.equal(normalisePhotoUrl('http://pub-ours.r2.dev/x.jpg'), null);
  });

  test('the S3 write endpoint is not a delivery address', () => {
    assert.equal(normalisePhotoUrl('https://acct123.r2.cloudflarestorage.com/schoolguardian-photos/x.jpg'), null);
  });

  test('it cannot climb out of the bucket root', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/../other/x.jpg'), null);
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/sub/x.jpg'), null);
  });

  test('an unrelated host is still refused', () => {
    assert.equal(normalisePhotoUrl('https://tracker.test/x.jpg'), null);
  });
});

/**
 * Both of these were accepted by an earlier version of this check, which
 * blocklisted "/" and ".." instead of allowlisting the characters our own
 * filenames use. "%2e%2e%2f" contains neither and decodes to "../".
 */
describe('the filename must be one we issued', () => {
  test('percent-encoded traversal is refused', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/%2e%2e%2fx.jpg'), null);
    assert.equal(normalisePhotoUrl('https://api.example.com/uploads/%2e%2e%2fx.jpg'), null);
  });

  test('a query or fragment is refused', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/x.jpg?next=https://evil.test'), null);
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/x.jpg#@evil.test'), null);
  });

  test('a backslash is refused', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/\\evil.test/x.jpg'), null);
  });

  test('an empty filename is refused', () => {
    assert.equal(normalisePhotoUrl('https://pub-ours.r2.dev/'), null);
  });

  /**
   * The invariant that makes the narrow pattern safe: it must not be narrower
   * than the generator. If it were, a real upload would be stored and then
   * refused when the record was saved — the photo would vanish on the next
   * edit. These original names are the awkward ones an admin actually has.
   */
  test('every name the upload endpoint issues validates', () => {
    const originals = [
      'passport.jpg', 'Ada Lovelace.JPG', 'IMG_2043.HEIC', 'photo (2).png',
      'Adaeze Okonkwo – class 5.jpeg', 'ЖЖЖ.png', '../../etc/passwd', '',
      'a'.repeat(200) + '.png', '....jpg', 'file.name.with.dots.webp',
      '%2e%2e%2fsneaky.png', 'emoji-\u{1f600}.png', 'tab\there.png',
    ];
    for (const original of originals) {
      for (const ext of ['.jpg', '.pdf']) {
        const name = storage.storedName(original, ext);
        const url = `${storage.publicBase}/${name}`;
        assert.equal(normalisePhotoUrl(url), url, `rejected its own filename for "${original}" -> "${name}"`);
      }
    }
  });
});

describe('storage.put refuses a key that is a path', () => {
  test('a slash or a climb is rejected before anything is written', async () => {
    await assert.rejects(() => storage.put({ key: 'a/b.jpg', body: Buffer.alloc(1), contentType: 'image/jpeg' }));
    await assert.rejects(() => storage.put({ key: '../b.jpg', body: Buffer.alloc(1), contentType: 'image/jpeg' }));
  });
});
