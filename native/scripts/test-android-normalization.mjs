import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/health/android-normalize.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { normalizeAndroidRun, sanitizeAndroidRoute, RUNNING_TYPES } = context.exports;
assert.equal(RUNNING_TYPES.join(','), '56,57');
const run = { exerciseType: 56, startTime: '2026-11-12T12:00:00.000Z', endTime: '2026-11-12T12:10:00.000Z', title: 'Evening loop', metadata: { id: 'hc-run-123', dataOrigin: 'com.example.watch' } };
const meters = { inMeters: 1609.344 };
const dist = [{ startTime: run.startTime, endTime: run.endTime, distance: meters, metadata: { dataOrigin: 'com.example.watch' } }];
const heart = [{ startTime: run.startTime, endTime: run.endTime, metadata: { dataOrigin: 'com.example.watch' }, samples: [
  { time: '2026-11-12T12:01:00.000Z', beatsPerMinute: 140 },
  { time: '2026-11-12T12:09:00.000Z', beatsPerMinute: 160 },
  { time: '2026-11-12T11:50:00.000Z', beatsPerMinute: 300 },
] }];
const result = normalizeAndroidRun(run, dist, heart);
assert.equal(result.run?.externalId, 'hc-run-123');
assert.equal(result.run?.source, 'health_connect');
assert.equal(result.run?.distanceMi, 1);
assert.equal(result.run?.durationSec, 600);
assert.equal(result.run?.routeName, 'Evening loop');
assert.equal(result.run?.avgHr, 150);
assert.equal(result.run?.maxHr, 160);
assert.equal(result.reasons.length, 0);
const wrongOrigin = [{ ...dist[0], metadata: { dataOrigin: 'com.other.tracker' } }];
assert.equal(normalizeAndroidRun(run, wrongOrigin).run, null, 'Must not attribute distance from another writer');
assert(normalizeAndroidRun(run, wrongOrigin).reasons.some((reason) => reason.includes('distance')));
// A single same-writer record whose edges are within 2 seconds of the session is
// accepted (Health Connect can round the two records differently).
const nearExact = [{ ...dist[0], startTime: '2026-11-12T11:59:59.000Z' }];
assert.equal(normalizeAndroidRun(run, nearExact).run?.distanceMi, 1, 'A same-writer record within 2 seconds of the session is accepted');
// Beyond that tolerance it is a partial overlap and must be refused.
const overlap = [{ ...dist[0], startTime: '2026-11-12T11:59:57.000Z' }];
assert.equal(normalizeAndroidRun(run, overlap).run, null, 'Cannot overcount distance from partially overlapping records');
// Two near-exact records are ambiguous: never pick one or sum them.
const twoNear = [nearExact[0], { ...dist[0], endTime: '2026-11-12T12:10:01.000Z' }];
assert.equal(normalizeAndroidRun(run, twoNear).run, null, 'Two near-exact records from the same writer are ambiguous');
const noId = { ...run, metadata: { dataOrigin: 'com.example.watch' } };
assert(normalizeAndroidRun(noId, dist).reasons.some((reason) => reason.includes('ID')));
assert.equal(normalizeAndroidRun({ ...run, exerciseType: 79 }, dist).run, null, 'Walking is not running');
assert.equal(normalizeAndroidRun({ ...run, exerciseType: 57, title: undefined }, dist).run?.routeName, 'Health Connect treadmill run');
assert.equal(normalizeAndroidRun({ ...run, endTime: run.startTime }, dist).run, null, 'Zero-duration run invalid');
assert.equal(normalizeAndroidRun(run, [{ ...dist[0], distance: { inMeters: 1000000000 } }]).run, null, 'Over-limit distance invalid');
const locations = Array.from({ length: 6000 }, (_, i) => ({ latitude: 38 + (i / 100000), longitude: -77 }));
const points = sanitizeAndroidRoute(locations);
assert.equal(points.length, 5000);
assert.equal(points[0].lat, 38);
assert.equal(points.at(-1).lat, locations.at(-1).latitude);
assert.equal(sanitizeAndroidRoute([{latitude:200,longitude:0},{latitude:1,longitude:2}]).length, 1);
assert.equal(normalizeAndroidRun({ ...run, exerciseRoute: { type: 2, route: locations } }, dist).run?.points, undefined,
  'Must not ingest routes requiring separate OS consent');
assert.equal(normalizeAndroidRun({ ...run, exerciseRoute: { type: 0, route: locations } }, dist).run?.points?.length, 5000);
console.log('PASS: Android running/treadmill mapping, stable IDs, source-safe distance, duration, heart rate, route consent and 5,000-point cap.');
