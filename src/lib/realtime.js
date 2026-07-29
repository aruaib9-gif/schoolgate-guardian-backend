import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { prisma } from './prisma.js';
import { env } from './../config/env.js';

// Roles that legitimately see activity across every school. Everyone else is
// confined to their own school's room.
const CROSS_TENANT_ROLES = new Set(['superadmin', 'head_of_schools']);

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

  // Authenticate like REST does: verify the JWT, then load the user so we get
  // user_category (the effective RBAC role) and the is_active flag — a token
  // alone says nothing about either.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.is_active === false) return next(new Error('unauthorized'));
      socket.data.user = user;
      socket.data.role = user.user_category || user.role || 'user';
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  // Room layout: cross-tenant roles join the global `entity:<Name>` room;
  // everyone else joins `entity:<Name>:school:<their school>` — the school id
  // comes from their own account, never from the client, so a subscriber can
  // only ever hear about their own tenant.
  const roomFor = (socket, entity) => {
    if (typeof entity !== 'string' || !entity || entity.includes(':')) return null;
    if (CROSS_TENANT_ROLES.has(socket.data.role)) return `entity:${entity}`;
    if (socket.data.user.school_id) return `entity:${entity}:school:${socket.data.user.school_id}`;
    return null; // school-less non-admin account: nothing to subscribe to
  };

  io.on('connection', (socket) => {
    socket.on('subscribe', (entity) => {
      const room = roomFor(socket, entity);
      if (room) socket.join(room);
    });
    socket.on('unsubscribe', (entity) => {
      const room = roomFor(socket, entity);
      if (room) socket.leave(room);
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
  const event = { entity, action, id, school_id: schoolId, at: Date.now() };
  // Global room (cross-tenant admins) always hears it; the owning school's
  // room hears it too. A record with no school reaches admins only.
  io.to(`entity:${entity}`).emit('entity_event', event);
  if (schoolId) io.to(`entity:${entity}:school:${schoolId}`).emit('entity_event', event);
}

export function getIO() {
  return io;
}
