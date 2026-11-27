// Routes that leave the road: a waypoint marked `offroad` is reached in a
// straight line, while the rest of the route still follows roads and paths.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import snapRoute, { routeSections } from '../src/functions/snapRoute.js';
import { buildTrip, toManeuvers } from '../src/functions/routeDirections.js';

const A = { lat: 40.7, lng: -74.0 };
const B = { lat: 40.702, lng: -74.0 };
const C = { lat: 40.704, lng: -74.002, offroad: true };
const D = { lat: 40.706, lng: -74.002 };
const config = { routerUrl: 'https://router.test/route', routerApiKey: '' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A router that answers each request with one leg per pair of locations, bending
// through a midpoint so routed geometry can be told from a straight line.
function fakeRouter(calls, { fail = false } = {}) {
  globalThis.fetch = async (url) => {
    const payload = JSON.parse(new URL(url).searchParams.get('json'));
    calls.push(payload);
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    const legs = [];
    for (let i = 1; i < payload.locations.length; i += 1) {
      const from = payload.locations[i - 1];
      const to = payload.locations[i];
      const mid = [(from.lat + to.lat) / 2, (from.lon + to.lon) / 2 + 0.001];
      legs.push({
        shape: [[from.lat, from.lon], mid, [to.lat, to.lon]],
        maneuvers: [
          { type: 1, instruction: `Walk from ${i - 1}.`, length: 0.2, begin_shape_index: 0 },
          { type: 4, instruction: 'You have arrived at your destination.', length: 0, begin_shape_index: 2 },
        ],
      });
    }
    return { ok: true, status: 200, json: async () => ({ trip: { legs } }) };
  };
}

test('waypoints split into road sections and straight off-road sections', () => {
  assert.deepEqual(
    routeSections([A, B, C, D]).map((s) => [s.offroad, s.points.length]),
    [[false, 2], [true, 2], [false, 2]]
  );
  assert.deepEqual(routeSections([A, B, D]).map((s) => [s.offroad, s.points.length]), [[false, 3]]);
  assert.deepEqual(
    routeSections([A, C, { ...D, offroad: true }]).map((s) => [s.offroad, s.points.length]),
    [[true, 3]]
  );
  // The first waypoint has nothing arriving at it, so its flag means nothing.
  assert.deepEqual(routeSections([{ ...A, offroad: true }, B]).map((s) => s.offroad), [false]);
});

test('only the road sections are sent to the router; the off-road leg is a straight line', async () => {
  const calls = [];
  fakeRouter(calls);
  const out = await snapRoute({ body: { points: [A, B, C, D] }, config });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.locations.length), [2, 2]);
  assert.equal(out.snapped, true);
  // A, bend, B, then straight to C, then bend, D.
  assert.deepEqual(out.path.map((p) => [p.lat, p.lng]), [
    [40.7, -74.0],
    [40.701, -73.999],
    [40.702, -74.0],
    [40.704, -74.002],
    [40.705, -74.001],
    [40.706, -74.002],
  ]);
  assert.ok(out.distance_mi > 0);
});

test('a route that is all off-road never calls the router and is not reported as a failure', async () => {
  const calls = [];
  fakeRouter(calls);
  const out = await snapRoute({ body: { points: [A, C, { ...D, offroad: true }] }, config });
  assert.equal(calls.length, 0);
  assert.equal(out.snapped, true);
  assert.equal(out.path.length, 3);
});

test('when the router is down the road sections fall back to straight lines and say so', async () => {
  const calls = [];
  fakeRouter(calls, { fail: true });
  const out = await snapRoute({ body: { points: [A, B, C, D] }, config });
  assert.equal(out.snapped, false);
  assert.deepEqual(out.path.map((p) => [p.lat, p.lng]), [[40.7, -74.0], [40.702, -74.0], [40.704, -74.002], [40.706, -74.002]]);
});

test('directions cover the road sections and call out each off-road section once', async () => {
  const calls = [];
  fakeRouter(calls);
  const trip = await buildTrip([A, B, C, D], config);
  const out = toManeuvers(trip);

  assert.equal(calls.length, 2);
  assert.deepEqual(out.map((m) => m.instruction), [
    'Walk from 0.',
    'Leave the road and head straight for the next marker.',
    'Walk from 0.',
    'You have arrived at your destination.',
  ]);
  const off = out[1];
  assert.deepEqual([off.lat, off.lng], [40.702, -74.0]);
  assert.equal(off.type, 0);
  assert.ok(out[2].at_mi > off.at_mi, 'distance keeps running across the off-road section');
  assert.equal(out.filter((m) => /arrived/.test(m.instruction)).length, 1);
});

test('a route that ends off-road still announces the finish', async () => {
  const calls = [];
  fakeRouter(calls);
  const out = toManeuvers(await buildTrip([A, B, C], config));
  assert.deepEqual(out.map((m) => m.instruction), [
    'Walk from 0.',
    'Leave the road and head straight for the next marker.',
    'You have arrived at your destination.',
  ]);
  assert.deepEqual([out[2].lat, out[2].lng], [40.704, -74.002]);
});

test('if any road section cannot be routed there are no directions at all', async () => {
  fakeRouter([], { fail: true });
  assert.equal(await buildTrip([A, B, C, D], config), null);
});
