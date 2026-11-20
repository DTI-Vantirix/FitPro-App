import pg from 'pg';

// Postgres access. Everything else in the server talks to this small interface:
//   query(sql, params) -> rows
//   exec(sql)          -> runs a multi-statement script (migrations)
//   tx(fn)             -> runs fn(db) inside a transaction
// Keeping it this small lets tests swap in another driver.
export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });

  const wrap = (runner) => ({
    async query(sql, params = []) {
      const result = await runner.query(sql, params);
      return result.rows;
    },
    async exec(sql) {
      await runner.query(sql);
    },
  });

  const db = {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const inner = { ...wrap(client), tx: (f) => f(inner) };
        const result = await fn(inner);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}
