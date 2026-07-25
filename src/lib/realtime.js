import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { env } from './../config/env.js';

// ---------------------------------------------------------------------------
// Realtime layer (Socket.IO)
// Clients authenticate with their JWT on the handshake, then subscribe to
// per-entity rooms. On any entity change the server emits a lightweight event
// (entity name + action + id only — no record data) so the client can refetch
// through the tenant-scoped REST API. This mirrors how the app's `.subscribe()`
// callbacks work (they trigger refetches) while never leaking data across
// tenants over the socket itself.
// ---------------------------------------------------------------------------

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin.includes('*') ? true : env.corsOrigin,
      credentials: true,
    },
  });

  // Authenticate every socket connection with the same JWT used for REST.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = verifyToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('subscribe', (entity) => {
      if (typeof entity === 'string' && entity) socket.join(`entity:${entity}`);
    });
    socket.on('unsubscribe', (entity) => {
      if (typeof entity === 'string' && entity) socket.leave(`entity:${entity}`);
    });
  });

  return io;
}

/**
 * Broadcast an entity change to subscribers.
 * @param {string} entity  canonical entity name (e.g. "AccessLog")
 * @param {string} action  "create" | "update" | "delete"
 * @param {string} id       affected record id
 * @param {string} [schoolId]  tenant, included for client-side filtering only
 */
export function emitEntityEvent(entity, action, id, schoolId) {
  if (!io) return;
  io.to(`entity:${entity}`).emit('entity_event', { entity, action, id, school_id: schoolId, at: Date.now() });
}

export function getIO() {
  return io;
}
