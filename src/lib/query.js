import { coerceFilterValue } from './registry.js';

// Operators supported via field-name suffixes in query strings or the JSON
// body of the /query endpoint, e.g. estimated_value_gte=1000 or
// { "next_follow_up_lte": "2024-01-01" }.
const OPERATOR_SUFFIXES = {
  _gte: 'gte',
  _lte: 'lte',
  _gt: 'gt',
  _lt: 'lt',
  _ne: 'not',
  _contains: 'contains',
  _startsWith: 'startsWith',
  _in: 'in',
};

const RESERVED = new Set(['sort', 'limit', 'skip', 'offset', 'page', 'select']);

/**
 * Build a Prisma `where` object from a flat map of filters (query params or a
 * JSON body). Only recognised scalar fields are honoured; unknown keys are
 * ignored so a stray param can never crash a query.
 */
export function buildWhere(meta, raw = {}) {
  const where = {};
  for (const [rawKey, rawVal] of Object.entries(raw)) {
    if (RESERVED.has(rawKey)) continue;
    if (rawVal === undefined) continue;

    let field = rawKey;
    let op = 'equals';
    for (const [suffix, prismaOp] of Object.entries(OPERATOR_SUFFIXES)) {
      if (rawKey.endsWith(suffix)) {
        field = rawKey.slice(0, -suffix.length);
        op = prismaOp;
        break;
      }
    }

    if (!meta.scalarFields.has(field)) continue;

    if (op === 'in') {
      const arr = Array.isArray(rawVal) ? rawVal : String(rawVal).split(',');
      where[field] = { in: arr.map((v) => coerceFilterValue(meta, field, v)) };
      continue;
    }

    if (op === 'contains' || op === 'startsWith') {
      where[field] = { [op]: String(rawVal), mode: 'insensitive' };
      continue;
    }

    const value = coerceFilterValue(meta, field, rawVal);
    where[field] = op === 'equals' ? value : { [op]: value };
  }
  return where;
}

/**
 * Parse a sort spec like "-created_date,full_name" into a Prisma orderBy array.
 * Leading "-" means descending. Unknown fields are dropped.
 */
export function buildOrderBy(meta, sort) {
  if (!sort) return [{ created_date: 'desc' }];
  const parts = Array.isArray(sort) ? sort : String(sort).split(',');
  const orderBy = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const desc = trimmed.startsWith('-');
    const field = desc ? trimmed.slice(1) : trimmed;
    if (!meta.scalarFields.has(field)) continue;
    orderBy.push({ [field]: desc ? 'desc' : 'asc' });
  }
  return orderBy.length ? orderBy : [{ created_date: 'desc' }];
}

export function parsePaging(query = {}) {
  const limit = query.limit !== undefined ? Math.max(0, parseInt(query.limit, 10) || 0) : undefined;
  const skip =
    query.skip !== undefined
      ? Math.max(0, parseInt(query.skip, 10) || 0)
      : query.offset !== undefined
      ? Math.max(0, parseInt(query.offset, 10) || 0)
      : undefined;
  return {
    take: limit && limit > 0 ? limit : undefined,
    skip,
  };
}
