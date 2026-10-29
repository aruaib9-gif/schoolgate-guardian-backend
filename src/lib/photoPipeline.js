import path from 'node:path';
import sharp from 'sharp';
import { badRequest } from '../middleware/error.js';

/**
 * Every uploaded image is re-encoded before it is stored. Nothing here is
 * cosmetic:
 *
 *  - Size. A phone photo is 3-8MB and gets displayed at 92x104 on an ID card
 *    and 64x76 at the gate. Storing the original meant a guard waited on
 *    several megabytes over Nigerian mobile data to compare one face, and that
 *    a gigabyte of storage held about 330 people.
 *
 *  - Orientation. A photo from a phone held sideways is stored upright with an
 *    EXIF tag saying "rotate me". Print pipelines and <img> tags honour that
 *    tag inconsistently, so faces came out sideways on printed cards.
 *    .rotate() bakes the rotation into the pixels instead.
 *
 *  - Location. A camera roll photo carries GPS coordinates in EXIF — where the
 *    child was photographed, usually their home. That rode along into a
 *    publicly readable bucket. Re-encoding drops all metadata, because sharp
 *    keeps none unless asked.
 *
 *  - Format. Everything stored is a JPEG, whatever arrived, so nothing
 *    downstream has to care what a camera produced. The exception is HEIC:
 *    libvips here ships without an HEVC decoder, and an iPhone HEIC is HEVC.
 *    It can read such a file's dimensions and not its pixels, so the failure
 *    surfaces at decode — see the error below, which says so plainly rather
 *    than suggesting the file is corrupt.
 */

// The longest edge we keep. An ID card prints the photo at 0.92in x 1.06in,
// which is ~320px at 300dpi, so 800 leaves room to re-crop and still print
// sharply while cutting a typical upload by roughly fifty times.
const MAX_EDGE = 800;

/**
 * JPEG rather than WebP. WebP is ~25% smaller, but the ID card is a printed
 * credential generated through expo-print and a system webview, and a school
 * printing cards is the worst possible place to discover a format gap. R2
 * charges nothing for egress, so the bytes we save would save no money.
 * Switching is a one-line change if that calculus ever changes.
 */
const OUTPUT = { ext: '.jpg', mime: 'image/jpeg' };

/**
 * Normalise one uploaded file for storage.
 * Returns the bytes to store, the content type to store them as, and the
 * extension the stored filename should carry.
 */
export async function processUpload({ buffer, mimetype }) {
  // A PDF is a document, not a picture — stored exactly as it arrived.
  if (mimetype === 'application/pdf') {
    return { body: buffer, contentType: mimetype, ext: '.pdf' };
  }

  try {
    const body = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { body, contentType: OUTPUT.mime, ext: OUTPUT.ext };
  } catch (err) {
    // The type allowlist already passed, so this is either a file that claims to
    // be an image and is not one, or an encoding this build of libvips cannot
    // read. The admin needs to know which — and for HEIC we know exactly which,
    // so say it instead of implying their photo is broken.
    if (/hei[cf]/i.test(mimetype)) {
      throw badRequest(
        'An iPhone HEIC photo cannot be read by this server. Open it on your device, ' +
        'export or "Save as" a JPEG, and upload that instead.'
      );
    }
    throw badRequest(
      `That file could not be read as an image (${mimetype}). ` +
      'Try saving it as JPEG or PNG and uploading again.'
    );
  }
}
