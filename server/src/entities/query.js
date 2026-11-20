import { HttpError } from '../lib/http.js';
import { isUuid } from '../lib/serialize.js';

// ------------------------------------------------------------------ value coercion

// Turns an incoming JSON value into what the column stores. Empty strings mean
// "not set" for non-text columns, matching how the old app sent blank fields.
export function coerce(kind, value, field) {
  if (value === undefined || value === null) return null;
  switch (kind) {
    case 'text':
      if (typeof value === 'object') throw new HttpError(400, `${field} must be text.`);
      return String(value);
    case 'number': {
      if (value === '') return null;
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${field} must be a number.`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new HttpError(400, `${field} must be true or false.`);
    case 'timestamp': {
      if (value === '') return null;
      const d = new Date(value);
      if (typeof value === 'boolean' || Number.isNaN(d.getTime())) throw new HttpError(400, `${field} must be a date.`);
      return d.toISOString();
    }
    case 'uuid':
      if (value === '') return null;
      if (!isUuid(value)) throw new HttpError(400, `${field} must be a record id.`);
      return value.toLowerCase();
    case 'json':
      // Stored as jsonb; serialized here so arrays aren't mistaken for Postgres arrays.
      return JSON.stringify(value);
    default:
      return value;
  }
}

export const placeholder = (kind, index) => (kind === 'json' ? `$${index}::jsonb` : `$${index}`);

// ------------------------------------------------------------------ filters

const OPERATORS = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

function filterValue(kind, value, field) {
  if (kind === 'uuid') return isUuid(value) ? value.toLowerCase() : undefined; // undefined = can never match
  if (kind === 'number') {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${field} must be compared with a number.`);
    return n;
  }
  if (kind === 'timestamp') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} must be compared with a date.`);
    return d.toISOString();
  }
  if (kind === 'boolean') return value === true || value === 'true';
  return String(value);
}

function condition(entity, field, spec, params) {
  const kind = entity.columns[field];
  if (!kind) throw new HttpError(400, `Unknown field "${field}".`);
  if (kind === 'json') throw new HttpError(400, `Filtering on "${field}" isn't supported.`);

  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  // Plain value: equality.
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    if (spec === null) return `${field} is null`;
    if (Array.isArray(spec)) throw new HttpError(400, `Use { "$in": [...] } to match "${field}" against a list.`);
    const v = filterValue(kind, spec, field);
    return v === undefined ? 'false' : `${field} = ${push(v)}`;
  }

  const parts = [];
  for (const [op, operand] of Object.entries(spec)) {
    if (op === '$in' || op === '$nin') {
      if (!Array.isArray(operand)) throw new HttpError(400, `${op} on "${field}" needs a list.`);
      const values = operand.map((v) => filterValue(kind, v, field)).filter((v) => v !== undefined);
      if (op === '$in') parts.push(values.length ? `${field} = any(${push(values)})` : 'false');
      else parts.push(values.length ? `not (${field} = any(${push(values)}))` : 'true');
    } else if (op === '$ne') {
      if (operand === null) parts.push(`${field} is not null`);
      else {
        const v = filterValue(kind, operand, field);
        parts.push(v === undefined ? 'true' : `${field} is distinct from ${push(v)}`);
      }
    } else if (op === '$exists') {
      parts.push(operand ? `${field} is not null` : `${field} is null`);
    } else if (OPERATORS[op]) {
      // Base44 ignored an undefined bound; so do we.
      if (operand === undefined || operand === null) continue;
      const v = filterValue(kind, operand, field);
      parts.push(v === undefined ? 'false' : `${field} ${OPERATORS[op]} ${push(v)}`);
    } else {
      throw new HttpError(400, `Unsupported filter operator "${op}".`);
    }
  }
  return parts.length ? `(${parts.join(' and ')})` : 'true';
}

// Translates a Mongo-style filter ({ field: value, $or: [...], field: { $in: [...] } })
// into a SQL condition.
export function filterToSql(filter, entity, params) {
  if (filter === undefined || filter === null) return 'true';
  if (typeof filter !== 'object' || Array.isArray(filter)) throw new HttpError(400, 'Filter must be an object.');
  const parts = [];
  for (const [key, spec] of Object.entries(filter)) {
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(spec)) throw new HttpError(400, `${key} needs a list of filters.`);
      if (!spec.length) {
        parts.push(key === '$or' ? 'false' : 'true');
        continue;
      }
      const joined = spec.map((f) => filterToSql(f, entity, params)).join(key === '$or' ? ' or ' : ' and ');
      parts.push(`(${joined})`);
    } else {
      // Base44 spelled record fields both "field" and "data.field".
      parts.push(condition(entity, key.startsWith('data.') ? key.slice(5) : key, spec, params));
    }
  }
  return parts.length ? parts.join(' and ') : 'true';
}

// ------------------------------------------------------------------ sort and paging

export function sortToSql(sort, entity) {
  const spec = typeof sort === 'string' && sort.trim() ? sort.trim() : '-created_date';
  const desc = spec.startsWith('-');
  const field = spec.replace(/^[-+]/, '');
  if (!entity.columns[field] || entity.columns[field] === 'json') {
    throw new HttpError(400, `Can't sort by "${field}".`);
  }
  const dir = desc ? 'desc nulls last' : 'asc nulls last';
  return `order by ${field} ${dir}, id ${desc ? 'desc' : 'asc'}`;
}

export const MAX_LIMIT = 1000;

export function paging(limit, skip) {
  const l = Number(limit);
  const s = Number(skip);
  return {
    limit: Number.isInteger(l) && l > 0 ? Math.min(l, MAX_LIMIT) : 50,
    skip: Number.isInteger(s) && s > 0 ? s : 0,
  };
}
