import { spawnSync } from 'node:child_process';

// Test-only database driver that runs each statement through the `psql` CLI.
// It implements the same small interface as src/db.js (query, exec, tx), so the
// API can be exercised against a real Postgres in environments where the `pg`
// npm package isn't installed. Production always uses src/db.js.
//
// Not transactional: tx(fn) just runs fn. Rows come back through json_agg, so
// timestamps arrive as ISO strings rather than Date objects (the API serializes
// both the same way).

function arrayLiteral(values) {
  return `{${values
    .map((v) => (v === null ? 'NULL' : `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`))
    .join(',')}}`;
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) value = value.toISOString();
  if (Array.isArray(value)) value = arrayLiteral(value);
  else if (typeof value === 'object') value = JSON.stringify(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function inline(sql, params) {
  return sql.replace(/\$(\d+)/g, (_, n) => {
    const i = Number(n) - 1;
    if (i >= params.length) throw new Error(`missing parameter $${n}`);
    return literal(params[i]);
  });
}

const PG_CODES = [
  [/duplicate key value/, '23505'],
  [/violates foreign key constraint/, '23503'],
  [/violates check constraint/, '23514'],
  [/invalid input syntax/, '22P02'],
];

export function createPsqlDb(url) {
  const run = (script) => {
    const out = spawnSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      input: script,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (out.status !== 0) {
      const message = (out.stderr || 'psql failed').replace(/^psql:[^:]*:\d+: /gm, '').trim();
      const error = new Error(message);
      error.code = PG_CODES.find(([re]) => re.test(message))?.[1];
      throw error;
    }
    return out.stdout;
  };

  const db = {
    async query(sql, params = []) {
      const statement = inline(sql.trim().replace(/;$/, ''), params);
      const isWrite = /^(insert|update|delete)\b/i.test(statement);
      if (isWrite && !/\breturning\b/i.test(statement)) {
        run(`${statement};`);
        return [];
      }
      const text = run(`with q as (${statement}) select coalesce(json_agg(q), '[]'::json) from q;`).trim();
      return JSON.parse(text || '[]');
    },
    async exec(sql) {
      run(sql);
    },
    async tx(fn) {
      return fn(db);
    },
    async close() {},
  };
  return db;
}
