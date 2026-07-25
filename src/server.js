import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { initRealtime } from './lib/realtime.js';

const app = createApp();
const server = http.createServer(app);

// Attach the realtime (Socket.IO) layer to the same HTTP server.
initRealtime(server);

server.listen(env.port, () => {
  console.log(`SchoolGate Guardian API listening on http://localhost:${env.port}`);
  console.log(`Realtime (Socket.IO) attached on the same port.`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
