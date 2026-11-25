import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const q = load('src/run/queue.ts');

function memoryStore(seed = {}) {
  const files = new Map(Object.entries(seed).map(([id, run]) => [id, JSON.stringify(run)]));
  const store = {
    failWrites: 0,
    writes: 0,
    list: async () => [...files.keys()],
    read: async (id) => (files.has(id) ? JSON.parse(files.get(id)) : null),
    write: async (id, run) => {
      if (store.failWrites > 0) { store.failWrites -= 1; throw new Error('disk full'); }
      store.writes += 1;
      files.set(id, JSON.stringify(run));
    },
    remove: async (id) => { files.delete(id); },
    files,
  };
  return store;
}
const summary = (id, startedAt = '2026-11-25T12:00:00.000Z') => ({ externalId: id, startedAt, distanceMi: 3.1, durationSec: 1800 });
const run = (id, over = {}) => q.newStoredRun(summary(id, over.startedAt), { external_id: id, kind: 'run' }, 'user-1', '2026-11-25T12:30:00.000Z');
const ok = async () => ({ kind: 'ok', runId: 'server-1' });

await test('server replies are sorted into saved, try again, and needs attention', () => {
  assert.deepEqual(q.classifyResponse(200, { ok: true, action: 'created', run_id: 'r1' }), { kind: 'ok', runId: 'r1' });
  assert.deepEqual(q.classifyResponse(200, { ok: true, action: 'updated', run_id: 'r1' }), { kind: 'ok', runId: 'r1' });
  assert.equal(q.classifyResponse(200, { ok: true, action: 'skipped' }).kind, 'ok');
  assert.deepEqual(q.classifyResponse(null, null, 'Network request failed'), { kind: 'retry', error: 'Network request failed', stop: true });
  for (const status of [401, 403, 408, 429, 500, 502, 503]) {
    const r = q.classifyResponse(status, { error: 'nope' });
    assert.deepEqual([r.kind, r.stop, r.error], ['retry', true, 'nope'], String(status));
  }
  assert.deepEqual(q.classifyResponse(400, { error: 'distance_mi must be greater than 0.' }), { kind: 'rejected', error: 'distance_mi must be greater than 0.' });
  assert.equal(q.classifyResponse(413, null).kind, 'rejected');
  // a 200 that is not the documented body (a captive portal page, a proxy) is not proof of saving
  assert.equal(q.classifyResponse(200, '<html>Sign in to Wi-Fi</html>').kind, 'retry');
  assert.equal(q.classifyResponse(200, { ok: false }).kind, 'retry');
});

await test('a new run is pending; one too short to send stays on the device only', () => {
  assert.equal(run('a').status, 'pending');
  const short = q.newStoredRun(summary('b'), null, 'user-1', '2026-11-25T12:30:00.000Z');
  assert.equal(short.status, 'local_only');
});

await test('accepted by the server: marked uploaded, file kept', async () => {
  const store = memoryStore({ a: run('a') });
  const result = await q.flushQueue(store, 'user-1', ok);
  assert.deepEqual(result, { uploaded: 1, pending: 0, needsAttention: 0 });
  const saved = await store.read('a');
  assert.deepEqual([saved.status, saved.serverRunId, saved.attempts, saved.lastError], ['uploaded', 'server-1', 1, null]);
});

await test('offline: the run stays pending, the attempt is counted, later runs are not hammered', async () => {
  const store = memoryStore({ a: run('a', { startedAt: '2026-11-24T12:00:00.000Z' }), b: run('b') });
  let calls = 0;
  const result = await q.flushQueue(store, 'user-1', async () => { calls += 1; return { kind: 'retry', error: 'Network request failed', stop: true }; });
  assert.equal(calls, 1);
  assert.deepEqual(result, { uploaded: 0, pending: 2, needsAttention: 0 });
  const a = await store.read('a');
  assert.deepEqual([a.status, a.attempts, a.lastError], ['pending', 1, 'Network request failed']);
  // connection back: both go, oldest first
  const order = [];
  await q.flushQueue(store, 'user-1', async (payload) => { order.push(payload.external_id); return { kind: 'ok', runId: null }; });
  assert.deepEqual(order, ['a', 'b']);
});

await test('rejected by the server: kept on the device and flagged, never deleted, not re-sent on its own', async () => {
  const store = memoryStore({ a: run('a') });
  let calls = 0;
  const send = async () => { calls += 1; return { kind: 'rejected', error: 'duration_sec must be greater than 0.' }; };
  assert.deepEqual(await q.flushQueue(store, 'user-1', send), { uploaded: 0, pending: 0, needsAttention: 1 });
  await q.flushQueue(store, 'user-1', send);
  assert.equal(calls, 1);
  const a = await store.read('a');
  assert.deepEqual([a.status, a.lastError], ['needs_attention', 'duration_sec must be greater than 0.']);
  // the runner can ask for another try
  await q.retryRun(store, 'a');
  assert.equal((await store.read('a')).status, 'pending');
});

await test('a sender that throws is treated as a failed attempt, not a crash', async () => {
  const store = memoryStore({ a: run('a') });
  const result = await q.flushQueue(store, 'user-1', async () => { throw new Error('boom'); });
  assert.deepEqual(result, { uploaded: 0, pending: 1, needsAttention: 0 });
  assert.equal((await store.read('a')).lastError, 'boom');
});

await test("another account's runs are never sent with this account's sign-in", async () => {
  const store = memoryStore({ a: run('a'), z: { ...run('z'), ownerId: 'user-2' } });
  const sent = [];
  await q.flushQueue(store, 'user-1', async (payload) => { sent.push(payload.external_id); return { kind: 'ok', runId: null }; });
  assert.deepEqual(sent, ['a']);
  assert.equal((await store.read('z')).status, 'pending');
});

await test('the disk failing after a successful send loses nothing', async () => {
  const store = memoryStore({ a: run('a') });
  store.failWrites = 1;
  const result = await q.flushQueue(store, 'user-1', ok);
  assert.deepEqual(result, { uploaded: 0, pending: 1, needsAttention: 0 });
  assert.deepEqual(await store.list(), ['a']);
  // the next flush sends it again; the server updates the same run (same external_id)
  assert.deepEqual(await q.flushQueue(store, 'user-1', ok), { uploaded: 1, pending: 0, needsAttention: 0 });
});

await test('two flushes at once send each run once', async () => {
  const store = memoryStore({ a: run('a'), b: run('b') });
  let calls = 0;
  const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return { kind: 'ok', runId: null }; };
  const [one, two] = await Promise.all([q.flushQueue(store, 'user-1', slow), q.flushQueue(store, 'user-1', slow)]);
  assert.equal(calls, 2);
  assert.deepEqual(one, two);
});

await test('runs too short to send and unreadable files are left alone', async () => {
  const store = memoryStore({ short: q.newStoredRun(summary('short'), null, 'user-1', '2026-11-25T12:30:00.000Z') });
  store.files.set('junk', '{"not":"a run"}');
  let calls = 0;
  await q.flushQueue(store, 'user-1', async () => { calls += 1; return { kind: 'ok', runId: null }; });
  assert.equal(calls, 0);
  assert.deepEqual((await store.list()).sort(), ['junk', 'short']);
});

await test('tidying only ever removes runs the server has', async () => {
  const seed = {};
  for (let i = 0; i < 6; i++) seed[`u${i}`] = { ...run(`u${i}`, { startedAt: `2026-11-2${i}T12:00:00.000Z` }), status: 'uploaded' };
  seed.p = run('p', { startedAt: '2026-11-01T12:00:00.000Z' });
  seed.n = { ...run('n', { startedAt: '2026-11-02T12:00:00.000Z' }), status: 'needs_attention' };
  seed.l = q.newStoredRun(summary('l', '2026-11-03T12:00:00.000Z'), null, 'user-1', '2026-11-03T12:30:00.000Z');
  const store = memoryStore(seed);
  await q.pruneUploaded(store, 2);
  assert.deepEqual((await store.list()).sort(), ['l', 'n', 'p', 'u4', 'u5']);
});

await test('listing for the home screen: newest first, this account only', async () => {
  const store = memoryStore({ a: run('a', { startedAt: '2026-11-24T12:00:00.000Z' }), b: run('b'), z: { ...run('z'), ownerId: 'user-2' } });
  assert.deepEqual((await q.listRuns(store, 'user-1')).map((r) => r.summary.externalId), ['b', 'a']);
  assert.deepEqual(await q.countWaiting(store, 'user-1'), { pending: 2, needsAttention: 0 });
});

await test('deleting an account removes only that account\'s runs from the phone', async () => {
  const store = memoryStore({ a: run('a'), z: { ...run('z'), ownerId: 'user-2' } });
  await q.removeOwnerRuns(store, 'user-1');
  assert.deepEqual(await store.list(), ['z']);
});
done('offline upload queue');
