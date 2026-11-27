import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const BASE = 'http://192.168.1.50:4000';
process.env.EXPO_PUBLIC_API_URL = BASE;
const calls = [];
let responder = () => ({ status: 200, data: {} });
const fetch = async (url, options) => {
  const call = { url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined };
  calls.push(call);
  const reply = await responder(call);
  if (reply === 'offline') throw new TypeError('Network request failed');
  const text = typeof reply.data === 'string' ? reply.data : JSON.stringify(reply.data);
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, text: async () => text };
};
const api = load('src/run/api.ts', {}, { fetch, AbortController, setTimeout, clearTimeout });
const reset = (fn) => { calls.length = 0; responder = fn; };
const last = () => calls[calls.length - 1];
const pt = (lat, lng) => ({ lat, lng });

await test('snapRoute sends the waypoints, off-road flags only where set', async () => {
  reset(() => ({ status: 200, data: { snapped: true, path: [pt(42, -71), pt(42.005, -71.001), pt(42.01, -71)], distance_mi: 0.712 } }));
  const result = await api.snapRoute('tok', [{ lat: 42, lng: -71, accuracy: 4 }, { lat: 42.01, lng: -71, offroad: true }, { lat: 42.02, lng: -71, offroad: false }]);
  assert.deepEqual([last().method, last().url, last().headers.Authorization], ['POST', `${BASE}/api/functions/snapRoute`, 'Bearer tok']);
  assert.deepEqual(last().body, { points: [{ lat: 42, lng: -71 }, { lat: 42.01, lng: -71, offroad: true }, { lat: 42.02, lng: -71 }] });
  assert.deepEqual(result, { snapped: true, path: [pt(42, -71), pt(42.005, -71.001), pt(42.01, -71)], distanceMi: 0.712 });
});
await test('snapRoute: straight-line fallback is reported, bad geometry dropped', async () => {
  reset(() => ({ status: 200, data: { snapped: false, path: [pt(42, -71), pt(999, 0), pt('x', 1), pt(42.01, -71)], distance_mi: '0.69' } }));
  assert.deepEqual(await api.snapRoute('tok', [pt(42, -71), pt(42.01, -71)]),
    { snapped: false, path: [pt(42, -71), pt(42.01, -71)], distanceMi: 0.69 });
  // Anything but a plain `true` is not a road-following line.
  reset(() => ({ status: 200, data: { path: [pt(42, -71), pt(42.01, -71)] } }));
  assert.deepEqual(await api.snapRoute('tok', [pt(42, -71), pt(42.01, -71)]),
    { snapped: false, path: [pt(42, -71), pt(42.01, -71)], distanceMi: null });
  reset(() => ({ status: 200, data: '<html>' }));
  assert.deepEqual(await api.snapRoute('tok', [pt(42, -71), pt(42.01, -71)]), { snapped: false, path: [], distanceMi: null });
});
await test('snapRoute: a refusal or no connection throws the plain sentence', async () => {
  reset(() => ({ status: 400, data: { error: 'Too many waypoints (max 40)' } }));
  await assert.rejects(api.snapRoute('tok', [pt(42, -71), pt(42.01, -71)]), (e) => e.status === 400 && e.message === 'Too many waypoints (max 40)');
  reset(() => 'offline');
  await assert.rejects(api.snapRoute('tok', [pt(42, -71), pt(42.01, -71)]), (e) => e.status === 0 && /Can't reach VantraRun/.test(e.message));
});
await test('createRoute posts the record as given and returns the new id', async () => {
  const record = { name: 'River loop', distance_mi: 2.35, points: [pt(42, -71), { lat: 42.01, lng: -71, offroad: true }],
    path: [pt(42, -71), pt(42.01, -71)], target_zone_id: 'z2', target_zone_name: 'Zone 2' };
  reset(() => ({ status: 201, data: { id: 'r9', ...record, created_by_id: 'u1' } }));
  assert.equal(await api.createRoute('tok', record), 'r9');
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization],
    ['POST', `${BASE}/api/entities/Route`, record, 'Bearer tok']);
  reset(() => ({ status: 400, data: { error: 'name is required' } }));
  await assert.rejects(api.createRoute('tok', record), (e) => e.status === 400 && e.message === 'name is required');
  reset(() => ({ status: 201, data: {} }));
  await assert.rejects(api.createRoute('tok', record), /did not confirm/);
});
await test('deleteRoute is DELETE on that one route', async () => {
  reset(() => ({ status: 200, data: { ok: true } }));
  await api.deleteRoute('tok', 'r 9/x');
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization],
    ['DELETE', `${BASE}/api/entities/Route/r%209%2Fx`, undefined, 'Bearer tok']);
  reset(() => ({ status: 404, data: { error: 'Not found' } }));
  await assert.rejects(api.deleteRoute('tok', 'gone'), (e) => e.status === 404);
});
await test('server runs: the caller\'s own, newest first, read with one query and nothing written', async () => {
  reset(() => ({ status: 200, data: { items: [
    { id: 'a', route_id: 'r1', route_name: 'Loop', distance_mi: 3.1, duration_sec: 1800, avg_pace_sec: 580.6, started_at: '2026-11-20T07:00:00.000Z',
      target_zone_name: 'Zone 2', in_zone_pct: 82, avg_hr: 148, source: 'fitpro', external_id: 'x-1', points: [pt(42, -71)] },
    { id: 'b', distance_mi: '5', duration_sec: 3000, started_at: 'not a date', source: 'garmin' },
    { id: 'c', distance_mi: 0, duration_sec: 60 },
    { distance_mi: 2, duration_sec: 900 }] } }));
  const runs = await api.listServerRuns('tok', 'u1', { limit: 40 });
  assert.equal(calls.length, 1);
  assert.deepEqual([last().method, last().url, last().headers.Authorization], ['POST', `${BASE}/api/entities/Run/query`, 'Bearer tok']);
  assert.deepEqual(last().body, { q: { created_by_id: 'u1' }, sort: '-started_at', limit: 40 });
  assert.deepEqual(runs, [
    { id: 'a', routeId: 'r1', routeName: 'Loop', distanceMi: 3.1, durationSec: 1800, avgPaceSec: 580.6, startedAt: '2026-11-20T07:00:00.000Z',
      targetZoneName: 'Zone 2', inZonePct: 82, avgHr: 148, source: 'fitpro', externalId: 'x-1' },
    { id: 'b', routeId: null, routeName: 'Free run', distanceMi: 5, durationSec: 3000, avgPaceSec: 600, startedAt: null,
      targetZoneName: null, inZonePct: null, avgHr: null, source: 'garmin', externalId: null },
  ]);
});
await test('server runs: a sensible default and ceiling on how many are asked for', async () => {
  reset(() => ({ status: 200, data: { items: [] } }));
  assert.deepEqual(await api.listServerRuns('tok', 'u1'), []);
  assert.equal(last().body.limit, 40);
  await api.listServerRuns('tok', 'u1', { limit: 5000 });
  assert.equal(last().body.limit, 200);
  await api.listServerRuns('tok', 'u1', { limit: 0 });
  assert.equal(last().body.limit, 40);
  reset(() => ({ status: 500, data: { error: 'Server error' } }));
  await assert.rejects(api.listServerRuns('tok', 'u1'), (e) => e.status === 500);
});
await test('server runs: a run with no start time is dated by when it was created, as on the website', async () => {
  reset(() => ({ status: 200, data: { items: [
    { id: 'a', distance_mi: 2, duration_sec: 1200, created_date: '2026-11-21T09:00:00.000Z' },
    { id: 'b', distance_mi: 2, duration_sec: 1200, started_at: '2026-11-20T07:00:00.000Z', created_date: '2026-11-22T09:00:00.000Z' }] } }));
  const runs = await api.listServerRuns('tok', 'u1');
  assert.deepEqual(runs.map((r) => r.startedAt), ['2026-11-21T09:00:00.000Z', '2026-11-20T07:00:00.000Z']);
});
done('route and run-list API client');
