import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_URL = 'https://api.example.com';
const { normalisePhotoUrl } = await import('../src/lib/photoUrl.js');
const { coerceInput } = await import('../src/lib/registry.js');

const OURS = 'https://api.example.com/uploads/1700000000-ab12cd34-photo.jpg';

/**
 * A person's photo is fetched by every device that scans them. Pointing it at
 * someone else's host would hand that host a log of who was scanned, where and
 * when — so the only accepted value is a file this server is serving.
 */
describe('a photo must be our own file', () => {
  test('a file from our upload endpoint is kept', () => {
    assert.equal(normalisePhotoUrl(OURS), OURS);
  });

  test('an outside host is refused', () => {
    assert.equal(normalisePhotoUrl('https://tracker.test/uploads/x.jpg'), null);
  });

  test('a lookalike host is refused', () => {
    assert.equal(normalisePhotoUrl('https://api.example.com.evil.test/uploads/x.jpg'), null);
  });

  test('plain http on our host is refused', () => {
    assert.equal(normalisePhotoUrl('http://api.example.com/uploads/x.jpg'), null);
  });

  test('it cannot climb out of the uploads directory', () => {
    assert.equal(normalisePhotoUrl('https://api.example.com/uploads/../../etc/passwd'), null);
    assert.equal(normalisePhotoUrl('https://api.example.com/uploads/sub/x.jpg'), null);
  });

  test('a script URL is refused', () => {
    assert.equal(normalisePhotoUrl('javascript:alert(1)'), null);
  });

  test('not supplying the field leaves it alone; empty clears it', () => {
    assert.equal(normalisePhotoUrl(undefined), undefined);
    assert.equal(normalisePhotoUrl(''), null);
    assert.equal(normalisePhotoUrl(null), null);
  });
});

const meta = {
  scalarFields: new Set(['photo_url', 'visitor_photo_url', 'full_name']),
  boolFields: new Set(), intFields: new Set(), floatFields: new Set(),
  dateFields: new Set(), jsonFields: new Set(), listFields: new Set(),
};

describe('the entity write path refuses rather than blanks', () => {
  test('a good photo passes through', () => {
    assert.deepEqual(coerceInput(meta, { photo_url: OURS }), { photo_url: OURS });
  });

  test('a bad photo is a 400, not a silent wipe of the existing one', () => {
    assert.throws(() => coerceInput(meta, { photo_url: 'https://tracker.test/x.jpg' }), { status: 400 });
  });

  test('visitor photos are held to the same rule', () => {
    assert.throws(() => coerceInput(meta, { visitor_photo_url: 'https://tracker.test/x.jpg' }), { status: 400 });
  });

  test('clearing a photo on purpose is still allowed', () => {
    assert.deepEqual(coerceInput(meta, { photo_url: '' }), { photo_url: null });
  });

  test('other fields are untouched', () => {
    assert.deepEqual(coerceInput(meta, { full_name: 'Ada Lovelace' }), { full_name: 'Ada Lovelace' });
  });
});
