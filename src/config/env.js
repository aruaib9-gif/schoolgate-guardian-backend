import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  corsOrigin: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  uploadDir: process.env.UPLOAD_DIR || './uploads',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 4000)}`).replace(/\/$/, ''),
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 10),

  // Email transport: 'resend' | 'smtp' | 'console'. Auto-detected when unset.
  emailProvider: process.env.EMAIL_PROVIDER || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  // Where emailed links point — the web app, not the API. Falls back to PUBLIC_URL.
  appUrl: (process.env.APP_URL || process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 4000)}`).replace(/\/$/, ''),
  // How long a set-password / reset link stays valid.
  inviteTtlDays: num(process.env.INVITE_TTL_DAYS, 7),
  resetTtlHours: num(process.env.RESET_TTL_HOURS, 2),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'SchoolGate Guardian <no-reply@schoolgate.example>',
  },

  seed: {
    superadminEmail: process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@schoolgate.example',
    superadminPassword: process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!',
  },

  cronSecret: process.env.CRON_SECRET || '',
};
