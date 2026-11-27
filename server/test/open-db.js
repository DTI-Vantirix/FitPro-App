// Chooses the database driver for the API tests.
//
// The suite is written for the real driver (src/db.js, which needs the `pg` package).
// Where `pg` is not installed, a developer can still run most of it through the psql
// stand-in (psql-db.js), which has no transactions: tests that need locks or a rollback
// skip themselves on it (`db.transactional === false`).
//
// In CI that fallback would be a quiet way to stop testing transactions altogether, so
// there a `pg` that cannot be loaded fails the run instead.
import { createPsqlDb } from './psql-db.js';

const inCi = (env) => Boolean(env.CI) && env.CI !== 'false' && env.CI !== '0';

export async function chooseDb({ url, load = () => import('../src/db.js'), env = process.env }) {
  let createDb;
  try {
    ({ createDb } = await load());
  } catch (cause) {
    if (inCi(env)) {
      throw new Error(
        'The `pg` package could not be loaded in CI. The API tests would fall back to the psql stand-in, ' +
          'which has no transactions, and every test of locking and rollback would be skipped without a word. ' +
          'Install the dependencies (npm ci) and run again.',
        { cause }
      );
    }
    return createPsqlDb(url);
  }
  return createDb(url);
}
