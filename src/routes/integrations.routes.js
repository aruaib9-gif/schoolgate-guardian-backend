import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, badRequest } from '../middleware/error.js';
import { env } from '../config/env.js';
import { sendEmail } from '../lib/email.js';

const router = Router();
router.use(requireAuth);

// Ensure upload dir exists.
fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'file', ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}-${nanoid(8)}-${base}${ext}`);
  },
});
// Allowlist, not blocklist. Notably absent: SVG and HTML — both execute script
// when served inline from /uploads, which would be stored XSS on our origin.
const ALLOWED_UPLOADS = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['image/gif', ['.gif']],
  ['image/heic', ['.heic']],
  ['application/pdf', ['.pdf']],
]);

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExts = ALLOWED_UPLOADS.get(file.mimetype);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExts) {
      return cb(badRequest(`Unsupported file type "${file.mimetype}". Allowed: images (jpeg/png/webp/gif/heic) and PDF.`));
    }
    // Extension must agree with the declared type so a .html can't sneak in
    // under an image/* label and be served with a script-running extension.
    if (!allowedExts.includes(ext)) {
      return cb(badRequest(`File extension "${ext}" does not match type "${file.mimetype}".`));
    }
    cb(null, true);
  },
});

// POST /integrations/upload  (multipart, field name "file")
// Mirrors integrations.Core.UploadFile -> returns { file_url }.
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded (expected multipart field "file")');
    const file_url = `${env.publicUrl}/uploads/${req.file.filename}`;
    res.json({
      file_url,
      filename: req.file.filename,
      original_name: req.file.originalname,
      size: req.file.size,
      mime_type: req.file.mimetype,
    });
  })
);

// POST /integrations/send-email  { to, subject, body, from_name?, html? }
// Mirrors integrations.Core.SendEmail.
router.post(
  '/send-email',
  asyncHandler(async (req, res) => {
    const { to, subject, body, html, from_name, from } = req.body || {};
    if (!to || !subject) throw badRequest('"to" and "subject" are required');
    const result = await sendEmail({ to, subject, body, html, from_name, from });
    res.json({ success: true, ...result });
  })
);

// POST /integrations/extract-data
// Mirrors integrations.Core.ExtractDataFromUploadedFile. Full document parsing
// (OCR/LLM extraction) is environment-specific and left as an integration
// point; this returns a clear, structured "not implemented" response instead
// of failing silently so callers can detect it.
router.post(
  '/extract-data',
  asyncHandler(async (req, res) => {
    res.status(501).json({
      success: false,
      error: 'extract-data is not implemented in this backend',
      hint: 'Wire this route to your document-extraction provider (e.g. an OCR/LLM service).',
      received: { file_url: req.body?.file_url, has_schema: Boolean(req.body?.json_schema) },
    });
  })
);

export default router;
