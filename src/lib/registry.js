import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Entity registry
// Derived automatically from Prisma's DMMF so field-type coercion, tenant
// detection, and filter validation stay in sync with schema.prisma with zero
// hand-maintained duplication.
// ---------------------------------------------------------------------------

// Fields managed by the server; never settable directly from a request body.
const MANAGED_FIELDS = new Set(['id', 'created_date', 'updated_date']);

// Map an API/entity name -> the RolePermissions.permissions resource key used
// for authorization. Entities not listed here are open to any authenticated
// user (subject to the admin-role fast path in the permission middleware).
export const RESOURCE_MAP = {
  Person: 'people',
  User: 'users',
  AccessLog: 'access_logs',
  Attendance: 'attendance',
  GuestPass: 'guest_passes',
  OneTimePass: 'guest_passes',
  Visitor: 'guest_passes',
  SchoolBus: 'school_bus',
  BusScanLog: 'school_bus',
  RolePermissions: 'roles',
  AuditLog: 'audit_log',
};

// Map HTTP verbs to the permission action names stored in RolePermissions.
export const ACTION_MAP = {
  read: ['view'],
  create: ['create'],
  update: ['edit', 'manage'],
  delete: ['delete'],
};

function buildModelMeta(model) {
  const fields = {};
  const dateFields = [];
  const jsonFields = [];
  const listFields = [];
  const intFields = [];
  const floatFields = [];
  const boolFields = [];
  const scalarFields = [];

  for (const f of model.fields) {
    if (f.kind === 'object') continue; // relations — none defined, but be safe
    fields[f.name] = { type: f.type, isList: f.isList, kind: f.kind };
    scalarFields.push(f.name);
    if (f.isList) {
      listFields.push(f.name);
    } else if (f.type === 'DateTime') {
      dateFields.push(f.name);
    } else if (f.type === 'Json') {
      jsonFields.push(f.name);
    } else if (f.type === 'Int' || f.type === 'BigInt') {
      intFields.push(f.name);
    } else if (f.type === 'Float' || f.type === 'Decimal') {
      floatFields.push(f.name);
    } else if (f.type === 'Boolean') {
      boolFields.push(f.name);
    }
  }

  const name = model.name;
  const delegate = name.charAt(0).toLowerCase() + name.slice(1);

  return {
    name,
    delegate,
    fields,
    scalarFields: new Set(scalarFields),
    dateFields: new Set(dateFields),
    jsonFields: new Set(jsonFields),
    listFields: new Set(listFields),
    intFields: new Set(intFields),
    floatFields: new Set(floatFields),
    boolFields: new Set(boolFields),
    hasSchoolId: Object.prototype.hasOwnProperty.call(fields, 'school_id'),
    hasCreatedBy: Object.prototype.hasOwnProperty.call(fields, 'created_by'),
    resource: RESOURCE_MAP[name] || null,
  };
}

const _models = {};
const _lookup = {};
for (const model of Prisma.dmmf.datamodel.models) {
  const meta = buildModelMeta(model);
  _models[meta.name] = meta;
  _lookup[meta.name.toLowerCase()] = meta.name;
}

export const MODELS = _models;

// Case-insensitive resolve of an entity name from the URL.
export function resolveEntity(name) {
  if (!name) return null;
  const canonical = _lookup[String(name).toLowerCase()];
  return canonical ? _models[canonical] : null;
}

export function entityNames() {
  return Object.keys(_models);
}

// --- coercion --------------------------------------------------------------
function coerceScalar(meta, key, value) {
  if (value === null || value === undefined) return null;
  if (meta.dateFields.has(key)) {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (meta.jsonFields.has(key)) return value;
  if (meta.listFields.has(key)) return Array.isArray(value) ? value : [value];
  if (meta.intFields.has(key)) {
    const n = parseInt(value, 10);
    return isNaN(n) ? undefined : n;
  }
  if (meta.floatFields.has(key)) {
    const n = Number(value);
    return isNaN(n) ? undefined : n;
  }
  if (meta.boolFields.has(key)) {
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  }
  return String(value);
}

// Build a Prisma-safe `data` object from an arbitrary request body: keeps only
// known scalar fields, coerces types, and drops server-managed fields.
export function coerceInput(meta, body, { isCreate = false } = {}) {
  const data = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (MANAGED_FIELDS.has(key)) continue;
    if (!meta.scalarFields.has(key)) continue; // ignore unknown keys
    const coerced = coerceScalar(meta, key, value);
    if (coerced === undefined) continue;
    data[key] = coerced;
  }
  return data;
}

// Coerce a single value for use in a where-filter on a given field.
export function coerceFilterValue(meta, key, value) {
  return coerceScalar(meta, key, value);
}
