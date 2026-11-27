// Which database driver the API tests run on. No database is opened here.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chooseDb } from './open-db.js';

describe('the test database driver', () => {
  const url = 'postgres://nobody@localhost:1/none';
  const real = { query: async () => [], tx: async () => {}, close: async () => {} };
  const works = async () => ({ createDb: () => real });
  const broken = async () => {
    throw Object.assign(new Error("Cannot find package 'pg'"), { code: 'ERR_MODULE_NOT_FOUND' });
  };

  test('the real driver is used whenever it loads', async () => {
    assert.equal(await chooseDb({ url, load: works, env: {} }), real);
    assert.equal(await chooseDb({ url, load: works, env: { CI: 'true' } }), real);
  });

  test('on a developer machine without `pg`, the psql stand-in is used, and says it has no transactions', async () => {
    const db = await chooseDb({ url, load: broken, env: {} });
    assert.equal(db.transactional, false);
    assert.equal(typeof db.query, 'function');
  });

  test('in CI a missing `pg` is a failure, never a quiet switch to the stand-in', async () => {
    for (const CI of ['true', '1']) {
      await assert.rejects(chooseDb({ url, load: broken, env: { CI } }), (error) => {
        assert.match(error.message, /pg.*could not be loaded.*CI/s);
        assert.match(error.message, /transaction/);
        assert.match(String(error.cause?.message), /Cannot find package/);
        return true;
      });
    }
    // CI=false or empty is not CI
    assert.equal((await chooseDb({ url, load: broken, env: { CI: '' } })).transactional, false);
    assert.equal((await chooseDb({ url, load: broken, env: { CI: 'false' } })).transactional, false);
  });
});
