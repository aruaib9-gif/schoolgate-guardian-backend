import { prisma } from './prisma.js';

/**
 * Write an AuditLog row. Never throws — auditing must not break the request.
 */
export async function writeAudit(req, { action, entity_type, entity_id, description, before, after, metadata }) {
  try {
    const user = req?.user;
    await prisma.auditLog.create({
      data: {
        action,
        entity_type,
        entity_id,
        description,
        before: before ?? undefined,
        after: after ?? undefined,
        metadata: metadata ?? undefined,
        actor_email: user?.email,
        actor_name: user?.full_name,
        actor_role: req?.role || user?.user_category || user?.role,
        school_id: user?.school_id,
        created_by: user?.email,
      },
    });
  } catch (err) {
    console.warn('[audit] failed to write audit log:', err.message);
  }
}
