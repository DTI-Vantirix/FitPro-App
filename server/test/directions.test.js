// Unit tests for turning a Valhalla trip into the maneuver list the app follows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toManeuvers } from '../src/functions/routeDirections.js';
import { routerRequestUrl } from '../src/functions/snapRoute.js';

const leg1Points = [[40.7, -74.0], [40.702, -74.0], [40.702, -74.004]];
const leg2Points = [[40.702, -74.004], [40.703, -74.004]];

// Valhalla maneuver types: 1-3 start, 4-6 destination, 15 left.
const trip = {
  legs: [
    {
      shape: leg1Points,
      maneuvers: [
        { type: 1, instruction: 'Walk north on Elm Street.', verbal_pre_transition_instruction: 'Walk north on Elm Street.', length: 0.2, begin_shape_index: 0 },
        { type: 15, instruction: 'Turn left onto Oak Avenue.', verbal_pre_transition_instruction: 'Turn left onto Oak Avenue.', length: 0.3, begin_shape_index: 1 },
        { type: 4, instruction: 'You have arrived at your destination.', length: 0, begin_shape_index: 2 },
      ],
    },
    {
      shape: leg2Points,
      maneuvers: [
        { type: 2, instruction: 'Walk north on Pine Street.', length: 0.1, begin_shape_index: 0 },
        { type: 5, instruction: 'Your destination is on the right.', length: 0, begin_shape_index: 1 },
      ],
    },
  ],
};

test('maneuvers are flattened across legs with running distance', () => {
  const out = toManeuvers(trip);
  assert.deepEqual(out.map((m) => m.at_mi), [0, 0.2, 0.5, 0.6]);
  assert.deepEqual(out.map((m) => m.index), [0, 1, 2, 3]);
  assert.deepEqual([out[1].lat, out[1].lng], [40.702, -74.0]);
  assert.equal(out[1].instruction, 'Turn left onto Oak Avenue.');
  assert.equal(out[1].verbal, 'Turn left onto Oak Avenue.');
  assert.equal(out[1].type, 15);
});

test('a waypoint in the middle is not announced as an arrival', () => {
  const out = toManeuvers(trip);
  assert.equal(out.filter((m) => /arrived|destination/i.test(m.instruction)).length, 1);
  assert.equal(out.at(-1).instruction, 'Your destination is on the right.');
  assert.equal(out[2].instruction, 'Walk north on Pine Street.', 'the way on from a waypoint is kept');
  assert.equal(out[2].verbal, 'Walk north on Pine Street.', 'verbal falls back to the instruction');
});

test('an empty or malformed trip gives no maneuvers', () => {
  assert.deepEqual(toManeuvers(null), []);
  assert.deepEqual(toManeuvers({ legs: [{}] }), []);
  assert.deepEqual(toManeuvers({ legs: [{ shape: leg2Points, maneuvers: [{ type: 15, instruction: 'x', begin_shape_index: 99 }] }] }), []);
});

test('the router URL is unchanged without a key, and carries the key when there is one', () => {
  const payload = { locations: [{ lat: 40.7, lon: -74 }], costing: 'pedestrian' };
  const json = encodeURIComponent(JSON.stringify(payload));
  assert.equal(routerRequestUrl({ routerUrl: 'https://valhalla1.openstreetmap.de/route', routerApiKey: '' }, payload),
    `https://valhalla1.openstreetmap.de/route?json=${json}`);
  assert.equal(routerRequestUrl({ routerUrl: 'https://api.stadiamaps.com/route/v1', routerApiKey: 'k/ey+1' }, payload),
    `https://api.stadiamaps.com/route/v1?json=${json}&api_key=k%2Fey%2B1`);
  assert.equal(routerRequestUrl({ routerUrl: 'https://router.example/route?profile=x', routerApiKey: 'abc' }, payload),
    `https://router.example/route?profile=x&json=${json}&api_key=abc`);
});
