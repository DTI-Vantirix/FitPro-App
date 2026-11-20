import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from './config.js';

const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'migrations');

// Applies migrations/NNN_*.sql in order, each once. Applied files are recorded
// in schema_migrations. Never edit a migration after it has run anywhere; add a
// new one instead.
export async function migrate(db, { log = console.log } = {}) {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const done = new Set((await db.query('select name from schema_migrations', [])).map((r) => r.name));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (name) values ($1) returning name', [file]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  if (!applied.length) log('database is up to date');
  return applied;
}
