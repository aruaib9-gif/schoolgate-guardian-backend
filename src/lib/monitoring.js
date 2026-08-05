import * as Sentry from '@sentry/node';
import { env } from '../config/env.js';

/**
 * Error monitoring — dormant until SENTRY_DSN is set, so local dev and
 * installs without a Sentry account run exactly as before.
 */
const enabled = !!process.env.SENTRY_DSN;

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: env.nodeEnv,
    tracesSampleRate: 0.1,
    // Never ship request bodies — they can contain passwords and tokens.
    beforeSend(event) {
      if (event.request) delete event.request.data;
      return event;
    },
  });
  console.log('Monitoring: Sentry enabled');
}

/** Report an error with optional context. No-op when Sentry is off. */
export function captureError(err, context = {}) {
  if (!enabled) return;
  Sentry.captureException(err, { extra: context });
}

export const monitoringEnabled = enabled;
