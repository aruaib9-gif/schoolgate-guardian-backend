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

  // Object storage for uploads (Cloudflare R2, reached over its S3-compatible
  // API). Set these and photos go to the bucket instead of the container's
  // local disk, which Render wipes on every deploy. Leave them unset and the
  // app uses ./uploads — which is what local development and the tests do.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    bucket: process.env.R2_BUCKET || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    // Where the bucket is readable from: its r2.dev address or a custom
    // domain. Not the S3 endpoint, which is for writing and needs signing.
    publicBase: (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, ''),
  },

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

  // Paystack (billing). Secret keys server-side only. Live and test can be
  // configured together: real invoices use the live key, test invoices (an
  // explicit superadmin choice) use the test key and test cards.
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackTestSecretKey: process.env.PAYSTACK_TEST_SECRET_KEY || '',

  // Open self-registration is a dev/demo convenience. In production it must be
  // opted into explicitly — see the guard below and /auth/register.
  allowSelfSignup: bool(process.env.ALLOW_SELF_SIGNUP, process.env.NODE_ENV !== 'production'),
};

/**
 * Object storage is all-or-nothing. A half-configured bucket would fall back to
 * the local disk without a word, and the whole point of the bucket is that the
 * disk silently loses files — so a typo in one variable would look exactly like
 * success until the next deploy took the photos with it. Fail loudly instead,
 * in every environment.
 */
{
  const r2Keys = {
    R2_ACCOUNT_ID: env.r2.accountId,
    R2_BUCKET: env.r2.bucket,
    R2_ACCESS_KEY_ID: env.r2.accessKeyId,
    R2_SECRET_ACCESS_KEY: env.r2.secretAccessKey,
    R2_PUBLIC_BASE: env.r2.publicBase,
  };
  const set = Object.entries(r2Keys).filter(([, v]) => v);
  const missing = Object.entries(r2Keys).filter(([, v]) => !v).map(([k]) => k);

  if (set.length && missing.length) {
    console.error(
      'Refusing to start: object storage is partly configured.\n' +
      `  Set: ${set.map(([k]) => k).join(', ')}\n` +
      `  Missing: ${missing.join(', ')}\n` +
      '  Set all five to use the bucket, or none to use the local ./uploads directory.'
    );
    process.exit(1);
  }

  if (!missing.length && !env.r2.publicBase.startsWith('https://')) {
    console.error(`Refusing to start: R2_PUBLIC_BASE "${env.r2.publicBase}" is not https.`);
    process.exit(1);
  }
}

/**
 * Refuse to boot with a configuration that is known-unsafe in production.
 * Every check here corresponds to a real foot-gun: dev defaults that are fine
 * locally but, left in place on a public deployment, hand out access.
 */
if (env.nodeEnv === 'production') {
  const fatal = [];
  if (!process.env.JWT_SECRET || env.jwtSecret === 'dev-insecure-secret-change-me') {
    fatal.push('JWT_SECRET is unset or still the dev default — every token would be forgeable.');
  } else if (env.jwtSecret.length < 32) {
    fatal.push('JWT_SECRET is shorter than 32 characters — use a long random value.');
  }
  if (!env.cronSecret) {
    fatal.push('CRON_SECRET is unset — /functions/* scheduled endpoints would be weakly protected.');
  }
  if (env.corsOrigin.includes('*')) {
    fatal.push('CORS_ORIGIN contains "*" — set the explicit web app origin(s), comma-separated.');
  }
  if (!env.publicUrl.startsWith('https://')) {
    fatal.push(`PUBLIC_URL "${env.publicUrl}" is not https — file links would be served over http.`);
  }
  if (env.seed.superadminPassword === 'ChangeMe123!') {
    fatal.push('SEED_SUPERADMIN_PASSWORD is still the example value.');
  }
  if (!env.r2.bucket && env.uploadDir.startsWith('./')) {
    console.warn(
      `Warning: uploads go to "${env.uploadDir}", a relative path on the container filesystem.\n` +
      '  On a host with an ephemeral filesystem every uploaded photo is lost at the next deploy.\n' +
      '  Configure R2_* for object storage, or point UPLOAD_DIR at a mounted disk.'
    );
  }
  if (fatal.length) {
    console.error('Refusing to start: unsafe production configuration.\n' + fatal.map((m) => `  - ${m}`).join('\n'));
    process.exit(1);
  }
}
