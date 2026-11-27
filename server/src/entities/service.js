import { HttpError } from '../lib/http.js';
import { isUuid, serialize } from '../lib/serialize.js';
import { coerce, filterToSql, paging, placeholder, sortToSql } from './query.js';
import { GUARDS } from './guards.js';
import { allows, ruleToSql } from './rules.js';

const MAX_BULK = 200;

// Generic record storage for every entity, enforcing the entity's access rules
// for the signed-in user. This is what replaced base44.entities.* on the server.
export function createEntityService(db, registry) {
  function entityOf(name) {
    const entity = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
    if (!entity) throw new HttpError(404, `Unknown entity "${name}".`);
    return entity;
  }

  // Validates and coerces client-supplied fields. Unknown fields are dropped.
  function prepare(entity, data, { partial }) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new HttpError(400, 'Record data must be an object.');
    }
    const values = {};
    for (const field of entity.writable) {
      if (!(field in data)) continue;
      values[field] = coerce(entity.columns[field], data[field], field);
    }
    if (!partial) {
      for (const [field, value] of Object.entries(entity.defaults)) {
        if (values[field] === undefined || values[field] === null) {
          values[field] = coerce(entity.columns[field], value, field);
        }
      }
    }
    for (const [field, allowed] of Object.entries(entity.enums)) {
      const v = values[field];
      if (v !== undefined && v !== null && !allowed.includes(v)) {
        throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}.`);
      }
    }
    return values;
  }

  function checkRequired(entity, record) {
    for (const field of entity.required) {
      const v = record[field];
      if (v === undefined || v === null || v === '') throw new HttpError(400, `${field} is required.`);
    }
  }

  // What a record looks like to the rule checker (jsonb values parsed back).
  function asRecord(entity, values) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      out[k] = entity.columns[k] === 'json' && typeof v === 'string' ? JSON.parse(v) : v;
    }
    return out;
  }

  async function findReadable(user, entity, id) {
    if (!isUuid(id)) return null;
    const params = [id];
    const scope = ruleToSql(entity.rls.read, user, entity, params);
    const rows = await db.query(`select * from ${entity.table} where id = $1 and ${scope}`, params);
    return rows[0] || null;
  }

  async function insertRows(entity, rows) {
    const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const params = [];
    const tuples = rows.map((row) => {
      const slots = fields.map((f) => {
        params.push(row[f] === undefined ? null : row[f]);
        return placeholder(entity.columns[f], params.length);
      });
      return `(${slots.join(', ')})`;
    });
    const result = await db.query(
      `insert into ${entity.table} (${fields.join(', ')}) values ${tuples.join(', ')} returning *`,
      params
    );
    return result;
  }

  function newRow(user, entity, data) {
    const values = prepare(entity, data, { partial: false });
    const row = { ...values, created_by_id: user.id, created_by: user.email };
    checkRequired(entity, row);
    if (!allows(entity.rls.create, user, asRecord(entity, row))) {
      throw new HttpError(403, `You can't create this ${entity.name}.`);
    }
    return row;
  }

  async function updateOne(user, entity, id, data) {
    const existing = await findReadable(user, entity, id);
    if (!existing) throw new HttpError(404, `${entity.name} not found.`);
    if (!allows(entity.rls.update, user, existing)) throw new HttpError(403, `You can't change this ${entity.name}.`);

    const changes = prepare(entity, data, { partial: true });
    const merged = { ...existing, ...asRecord(entity, changes) };
    checkRequired(entity, merged);
    // The record must still pass the rule afterwards: no handing records to someone else.
    if (!allows(entity.rls.update, user, merged)) throw new HttpError(403, `You can't change this ${entity.name} that way.`);

    GUARDS[entity.name]?.update?.(user, existing, changes);

    const fields = Object.keys(changes);
    if (!fields.length) return existing;
    const params = [id];
    const sets = fields.map((f) => {
      params.push(changes[f]);
      return `${f} = ${placeholder(entity.columns[f], params.length)}`;
    });
    const [row] = await db.query(
      `update ${entity.table} set ${sets.join(', ')}, updated_date = now() where id = $1 returning *`,
      params
    );
    return row;
  }

  async function matching(user, entity, filter, action) {
    const params = [];
    const where = filterToSql(filter, entity, params);
    const scope = ruleToSql(entity.rls.read, user, entity, params);
    const rows = await db.query(`select * from ${entity.table} where (${where}) and ${scope}`, params);
    return rows.filter((row) => allows(entity.rls[action], user, row));
  }

  return {
    entityOf,

    async query(user, name, { q, sort, limit, skip } = {}) {
      const entity = entityOf(name);
      const page = paging(limit, skip);
      const params = [];
      const where = filterToSql(q || {}, entity, params);
      const scope = ruleToSql(entity.rls.read, user, entity, params);
      params.push(page.limit, page.skip);
      const rows = await db.query(
        `select * from ${entity.table} where (${where}) and ${scope} ${sortToSql(sort, entity)}
          limit $${params.length - 1} offset $${params.length}`,
        params
      );
      return { items: rows.map(serialize), limit: page.limit, skip: page.skip };
    },

    async get(user, name, id) {
      const entity = entityOf(name);
      const row = await findReadable(user, entity, id);
      if (!row) throw new HttpError(404, `${entity.name} not found.`);
      return serialize(row);
    },

    async create(user, name, data) {
      const entity = entityOf(name);
      const fresh = newRow(user, entity, data);
      await GUARDS[entity.name]?.create?.(db, user, fresh);
      const [row] = await insertRows(entity, [fresh]);
      return serialize(row);
    },

    async bulkCreate(user, name, list) {
      const entity = entityOf(name);
      if (!Array.isArray(list)) throw new HttpError(400, 'Send a list of records.');
      if (list.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} records at once.`);
      if (!list.length) return [];
      const fresh = list.map((data) => newRow(user, entity, data));
      for (const row of fresh) await GUARDS[entity.name]?.create?.(db, user, row);
      const rows = await insertRows(entity, fresh);
      return rows.map(serialize);
    },

    async update(user, name, id, data) {
      const entity = entityOf(name);
      return serialize(await updateOne(user, entity, id, data));
    },

    async bulkUpdate(user, name, list) {
      const entity = entityOf(name);
      if (!Array.isArray(list)) throw new HttpError(400, 'Send a list of records, each with an id.');
      if (list.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} records at once.`);
      // All or nothing: one bad record rolls back the whole batch.
      return db.tx(async (tx) => {
        const inTx = createEntityService(tx, registry);
        const out = [];
        for (const item of list) {
          const { id, ...data } = item || {};
          out.push(await inTx.update(user, entity.name, id, data));
        }
        return out;
      });
    },

    // data may be { $set: {...} } (Base44 style) or the fields themselves.
    async updateMany(user, name, filter, data) {
      const entity = entityOf(name);
      const changes = data && typeof data === 'object' && data.$set ? data.$set : data;
      const rows = await matching(user, entity, filter, 'update');
      let updated = 0;
      for (const row of rows) {
        await updateOne(user, entity, row.id, changes);
        updated += 1;
      }
      return { updated };
    },

    async delete(user, name, id) {
      const entity = entityOf(name);
      const existing = await findReadable(user, entity, id);
      if (!existing) throw new HttpError(404, `${entity.name} not found.`);
      if (!allows(entity.rls.delete, user, existing)) throw new HttpError(403, `You can't delete this ${entity.name}.`);
      await db.query(`delete from ${entity.table} where id = $1 returning id`, [id]);
      return { id, deleted: true };
    },

    async deleteMany(user, name, filter) {
      const entity = entityOf(name);
      if (!filter || typeof filter !== 'object' || !Object.keys(filter).length) {
        throw new HttpError(400, 'deleteMany needs a filter.');
      }
      const ids = (await matching(user, entity, filter, 'delete')).map((r) => r.id);
      if (!ids.length) return { deleted: 0 };
      const rows = await db.query(`delete from ${entity.table} where id = any($1) returning id`, [ids]);
      return { deleted: rows.length };
    },
  };
}
