import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { initRealtime } from './lib/realtime.js';
import { activeProvider } from './lib/email.js';
import { captureError } from './lib/monitoring.js';

const app = createApp();
const server = http.createServer(app);

// Attach the realtime (Socket.IO) layer to the same HTTP server.
initRealtime(server);

server.listen(env.port, () => {
  console.log(`SchoolGate Guardian API listening on http://localhost:${env.port}`);
  console.log(`Realtime (Socket.IO) attached on the same port.`);

  // Email failures are non-fatal by design, so a misconfigured provider is
  // otherwise invisible until someone reports a missing invite. Say it once.
  const provider = activeProvider();
  if (provider === 'console') {
    const detail = env.emailProvider
      ? `EMAIL_PROVIDER="${env.emailProvider}" is set but its credentials are missing`
      : 'neither RESEND_API_KEY nor SMTP_HOST is set';
    const line = `Email: NOT SENDING — ${detail}. Messages will be logged only. See EMAIL_SETUP.md.`;
    if (env.nodeEnv === 'production') console.warn(`⚠️  ${line}`);
    else console.log(line);
  } else {
    console.log(`Email: ${provider}, from ${env.smtp.from}, links → ${env.appUrl}`);
  }
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down.`);
  // If open sockets keep the server from closing, don't hang the deploy —
  // Render kills the process anyway; better to exit on our own terms.
  const deadline = setTimeout(() => {
    console.error('Shutdown timed out after 10s; exiting.');
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A rejected promise nobody awaited (fire-and-forget email, cron function)
// should be loud in the logs, not a silent no-op — but it shouldn't kill the
// process. A synchronous uncaught throw means unknown state: log and exit so
// the platform restarts us clean.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  captureError(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  captureError(err, { source: 'uncaughtException' });
  process.exit(1);
});
