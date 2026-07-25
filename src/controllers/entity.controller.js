import { prisma } from '../lib/prisma.js';
import { resolveEntity, coerceInput } from '../lib/registry.js';
import { buildWhere, buildOrderBy, parsePaging } from '../lib/query.js';
import { assertPermission } from '../lib/permissions.js';
import { applyTenantScope, stampTenantOnCreate } from '../lib/tenant.js';
import { hashPassword } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { emitEntityEvent } from '../lib/realtime.js';
import { badRequest, notFound } from '../middleware/error.js';

// Resolve :entity into req.entityMeta or 404.
export function loadEntity(req, res, next) {
  const meta = resolveEntity(req.params.entity);
  if (!meta) return next(notFound(`Unknown entity "${req.params.entity}"`));
  req.entityMeta = meta;
  next();
}

// Remove sensitive fields before returning a record.
function serialize(meta, record) {
  if (!record) return record;
  if (meta.name === 'User') {
    const { password_hash, ...rest } = record;
    return rest;
  }
  return record;
}

// For the User entity, translate an incoming `password` into `password_hash`.
async function handleUserSecrets(meta, data, body) {
  if (meta.name !== 'User') return data;
  const out = { ...data };
  delete out.password_hash; // never settable directly
  if (body && body.password) out.password_hash = await hashPassword(body.password);
  return out;
}

const delegate = (meta) => prisma[meta.delegate];

// GET /:entity  — list with query-string filters, sort, paging
export async function list(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'read');
  let where = buildWhere(meta, req.query);
  where = applyTenantScope(req, meta, where);
  const orderBy = buildOrderBy(meta, req.query.sort);
  const { take, skip } = parsePaging(req.query);
  const rows = await delegate(meta).findMany({ where, orderBy, take, skip });
  res.json(rows.map((r) => serialize(meta, r)));
}

// POST /:entity/query — richer filtering via JSON body { where|filters, sort, limit, skip }
export async function query(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'read');
  const body = req.body || {};
  const rawFilters = body.where || body.filters || {};
  let where = buildWhere(meta, rawFilters);
  where = applyTenantScope(req, meta, where);
  const orderBy = buildOrderBy(meta, body.sort);
  const { take, skip } = parsePaging({ limit: body.limit, skip: body.skip, offset: body.offset });
  const rows = await delegate(meta).findMany({ where, orderBy, take, skip });
  res.json(rows.map((r) => serialize(meta, r)));
}

// GET /:entity/count — count matching records
export async function count(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'read');
  let where = buildWhere(meta, req.query);
  where = applyTenantScope(req, meta, where);
  const total = await delegate(meta).count({ where });
  res.json({ count: total });
}

// GET /:entity/:id
export async function getOne(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'read');
  const record = await delegate(meta).findUnique({ where: { id: req.params.id } });
  if (!record) throw notFound(`${meta.name} not found`);
  // Tenant check
  const scoped = applyTenantScope(req, meta, {});
  if (scoped.school_id && record.school_id && record.school_id !== scoped.school_id) {
    throw notFound(`${meta.name} not found`);
  }
  res.json(serialize(meta, record));
}

// POST /:entity
export async function create(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'create');
  let data = coerceInput(meta, req.body, { isCreate: true });
  data = await handleUserSecrets(meta, data, req.body);
  data = stampTenantOnCreate(req, meta, data);
  if (meta.hasCreatedBy && !data.created_by && req.user) data.created_by = req.user.email;
  const record = await delegate(meta).create({ data });
  emitEntityEvent(meta.name, 'create', record.id, record.school_id);
  if (meta.name !== 'AuditLog') {
    await writeAudit(req, {
      action: 'create',
      entity_type: meta.name,
      entity_id: record.id,
      description: `Created ${meta.name} ${record.id}`,
      after: serialize(meta, record),
    });
  }
  res.status(201).json(serialize(meta, record));
}

// POST /:entity/bulk  — bulk create (array body or { records: [...] })
export async function bulkCreate(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'create');
  const input = Array.isArray(req.body) ? req.body : req.body?.records;
  if (!Array.isArray(input)) throw badRequest('Bulk create expects an array of records');
  const created = [];
  for (const item of input) {
    let data = coerceInput(meta, item, { isCreate: true });
    data = await handleUserSecrets(meta, data, item);
    data = stampTenantOnCreate(req, meta, data);
    if (meta.hasCreatedBy && !data.created_by && req.user) data.created_by = req.user.email;
    const rec = await delegate(meta).create({ data });
    emitEntityEvent(meta.name, 'create', rec.id, rec.school_id);
    created.push(rec);
  }
  res.status(201).json(created.map((r) => serialize(meta, r)));
}

async function fetchScopedOr404(req, meta) {
  const existing = await delegate(meta).findUnique({ where: { id: req.params.id } });
  if (!existing) throw notFound(`${meta.name} not found`);
  const scoped = applyTenantScope(req, meta, {});
  if (scoped.school_id && existing.school_id && existing.school_id !== scoped.school_id) {
    throw notFound(`${meta.name} not found`);
  }
  return existing;
}

// PUT / PATCH /:entity/:id
export async function update(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'update');
  const existing = await fetchScopedOr404(req, meta);
  let data = coerceInput(meta, req.body);
  data = await handleUserSecrets(meta, data, req.body);
  // Do not allow a scoped user to move a record into another tenant.
  const scoped = applyTenantScope(req, meta, {});
  if (scoped.school_id) data.school_id = scoped.school_id;
  const record = await delegate(meta).update({ where: { id: req.params.id }, data });
  emitEntityEvent(meta.name, 'update', record.id, record.school_id);
  if (meta.name !== 'AuditLog') {
    await writeAudit(req, {
      action: 'update',
      entity_type: meta.name,
      entity_id: record.id,
      description: `Updated ${meta.name} ${record.id}`,
      before: serialize(meta, existing),
      after: serialize(meta, record),
    });
  }
  res.json(serialize(meta, record));
}

// DELETE /:entity/:id
export async function remove(req, res) {
  const meta = req.entityMeta;
  await assertPermission(req, meta, 'delete');
  const existing = await fetchScopedOr404(req, meta);
  await delegate(meta).delete({ where: { id: req.params.id } });
  emitEntityEvent(meta.name, 'delete', req.params.id, existing.school_id);
  if (meta.name !== 'AuditLog') {
    await writeAudit(req, {
      action: 'delete',
      entity_type: meta.name,
      entity_id: req.params.id,
      description: `Deleted ${meta.name} ${req.params.id}`,
      before: serialize(meta, existing),
    });
  }
  res.json({ success: true, id: req.params.id });
}
