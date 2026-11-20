import { isUuid } from '../lib/serialize.js';

// Per-record access rules, in the same format the Base44 schemas used (the "rls"
// block in server/entities/*.json). A rule is one of:
//
//   {}                                   anyone signed in
//   { "created_by_id": "{{user.id}}" }   the record's owner
//   { "data.user_id": "{{user.id}}" }    a field on the record equals a value
//   { "user_condition": { "role": "admin" } }   a property of the signed-in user
//   { "$or": [rule, ...] } / { "$and": [rule, ...] }
//
// Several keys in one object must all hold. An action with no rule at all is
// admin-only. Rules are applied two ways: as a SQL condition (to scope lists and
// lookups) and as a check on a single record (before create, update and delete).

function resolve(value, user) {
  if (typeof value !== 'string') return value;
  const m = /^\{\{\s*user\.(\w+)\s*\}\}$/.exec(value);
  return m ? user?.[m[1]] ?? null : value;
}

function fieldOf(key) {
  if (key === 'created_by_id' || key === 'created_by' || key === 'id') return key;
  if (key.startsWith('data.')) return key.slice(5);
  return null;
}

function userMatches(condition, user) {
  return Object.entries(condition || {}).every(([k, v]) => user && String(user[k]) === String(resolve(v, user)));
}

// True when `record` passes `rule` for `user`.
export function allows(rule, user, record) {
  if (rule === undefined) return user?.role === 'admin';
  if (!rule || typeof rule !== 'object') return false;
  return Object.entries(rule).every(([key, value]) => {
    if (key === '$or') return Array.isArray(value) && value.some((r) => allows(r, user, record));
    if (key === '$and') return Array.isArray(value) && value.every((r) => allows(r, user, record));
    if (key === 'user_condition') return userMatches(value, user);
    const field = fieldOf(key);
    if (!field) return false;
    const expected = resolve(value, user);
    const actual = record?.[field];
    if (expected === null || expected === undefined) return actual === null || actual === undefined;
    return actual !== null && actual !== undefined && String(actual) === String(expected);
  });
}

// SQL condition equivalent to `allows`, with values pushed onto `params`.
export function ruleToSql(rule, user, entity, params) {
  if (rule === undefined) return user?.role === 'admin' ? 'true' : 'false';
  if (!rule || typeof rule !== 'object') return 'false';
  const parts = Object.entries(rule).map(([key, value]) => {
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(value) || !value.length) return key === '$or' ? 'false' : 'true';
      const joined = value.map((r) => ruleToSql(r, user, entity, params)).join(key === '$or' ? ' or ' : ' and ');
      return `(${joined})`;
    }
    if (key === 'user_condition') return userMatches(value, user) ? 'true' : 'false';
    const field = fieldOf(key);
    if (!field || !entity.columns[field]) return 'false';
    const expected = resolve(value, user);
    if (expected === null || expected === undefined) return `${field} is null`;
    if (entity.columns[field] === 'uuid') {
      // Typed comparison so the owner indexes are used.
      if (!isUuid(String(expected))) return 'false';
      params.push(String(expected));
      return `${field} = $${params.length}::uuid`;
    }
    params.push(String(expected));
    return `${field}::text = $${params.length}`;
  });
  return parts.length ? `(${parts.join(' and ')})` : 'true';
}
