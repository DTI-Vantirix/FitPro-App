import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from '../config.js';

// Entity name (as the app uses it) -> table.
export const TABLES = {
  AccessGrant: 'access_grants',
  Challenge: 'challenges',
  ChallengeMember: 'challenge_members',
  Connection: 'connections',
  InviteCode: 'invite_codes',
  PaceZone: 'pace_zones',
  Post: 'posts',
  Profile: 'profiles',
  Route: 'routes',
  Run: 'runs',
  SocialProfile: 'social_profiles',
  Workout: 'workouts',
};

// Columns the server owns. Clients can filter and sort on them but never write them.
export const SYSTEM_COLUMNS = ['id', 'created_date', 'updated_date', 'created_by_id', 'created_by'];

const KIND_BY_PG_TYPE = {
  text: 'text',
  'character varying': 'text',
  'double precision': 'number',
  integer: 'number',
  numeric: 'number',
  boolean: 'boolean',
  'timestamp with time zone': 'timestamp',
  uuid: 'uuid',
  jsonb: 'json',
};

// Builds the entity registry: access rules, required fields, defaults and enums
// come from server/entities/*.json (the former Base44 schemas); column types come
// from the live database, so the SQL migrations stay the single source of truth
// for storage.
export async function loadRegistry(db, entitiesDir = path.join(SERVER_ROOT, 'entities')) {
  const columnRows = await db.query(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = current_schema()`,
    []
  );
  const columnsByTable = {};
  for (const row of columnRows) {
    (columnsByTable[row.table_name] ||= {})[row.column_name] = KIND_BY_PG_TYPE[row.data_type] || 'text';
  }

  const registry = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const file = path.join(entitiesDir, `${name}.json`);
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    const columns = columnsByTable[table];
    if (!columns) throw new Error(`Table ${table} for entity ${name} is missing; run the migrations`);

    const properties = schema.properties || {};
    for (const field of Object.keys(properties)) {
      if (!columns[field]) throw new Error(`Entity ${name}.${field} has no column in table ${table}`);
    }

    const defaults = {};
    const enums = {};
    for (const [field, spec] of Object.entries(properties)) {
      if (spec.default !== undefined) defaults[field] = spec.default;
      if (Array.isArray(spec.enum)) enums[field] = spec.enum;
    }

    registry[name] = {
      name,
      table,
      columns,
      writable: Object.keys(properties),
      required: schema.required || [],
      defaults,
      enums,
      rls: schema.rls || {},
    };
  }
  return registry;
}
