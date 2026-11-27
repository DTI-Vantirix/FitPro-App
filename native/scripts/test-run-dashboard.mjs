import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const d = load('src/run/dashboard.ts');

// Friday 27 November 2026, midday, local time. That week's Monday is the 23rd.
const NOW = new Date(2026, 10, 27, 12, 0, 0);
const on = (day, hour = 7, minute = 0) => new Date(2026, 10, day, hour, minute, 0).toISOString();

const server = (id, startedAt, distanceMi, durationSec, extra = {}) => ({
  id, routeId: null, routeName: 'Free run', distanceMi, durationSec, avgPaceSec: durationSec / distanceMi, startedAt,
  targetZoneName: null, inZonePct: null, avgHr: null, source: 'fitpro', externalId: null, ...extra,
});
const stored = (externalId, startedAt, distanceMi, durationSec, status, extra = {}) => ({
  summary: { externalId, startedAt, routeName: 'Phone run', distanceMi, durationSec, avgPaceSec: distanceMi > 0 ? Math.round(durationSec / distanceMi) : null },
  payload: status === 'local_only' ? null : {}, ownerId: 'u1', status, attempts: 0, lastError: null, serverRunId: null, savedAt: startedAt, ...extra,
});

await test('weeks start on Monday at midnight, local time', () => {
  const monday = d.startOfWeek(NOW);
  assert.deepEqual([monday.getFullYear(), monday.getMonth(), monday.getDate(), monday.getDay(), monday.getHours(), monday.getMinutes()], [2026, 10, 23, 1, 0, 0]);
  assert.equal(d.startOfWeek(new Date(2026, 10, 29, 23, 59)).getDate(), 23); // Sunday night is still that week
  assert.equal(d.startOfWeek(new Date(2026, 10, 23, 0, 0)).getDate(), 23);
  assert.equal(d.startOfWeek(new Date(2026, 10, 22, 23, 59)).getDate(), 16);
});

await test('a run the server already has is counted once, matched on external_id', () => {
  const merged = d.mergeRuns(
    [server('s1', on(25), 3, 1800, { externalId: 'x-1', routeName: 'Loop' }), server('s2', on(24), 5, 3000, { source: 'garmin' })],
    [stored('x-1', on(25), 3, 1800, 'uploaded', { serverRunId: 's1' })],
  );
  assert.deepEqual(merged.map((r) => [r.key, r.status, r.localId, r.counted]), [['s1', 'saved', 'x-1', true], ['s2', 'saved', null, true]]);
  assert.equal(merged[0].routeName, 'Loop');
});

await test('a run marked pending on the phone but already on the server is still counted once', () => {
  // The upload landed but the phone has not recorded the answer yet.
  const merged = d.mergeRuns([server('s1', on(25), 3, 1800, { externalId: 'x-1' })], [stored('x-1', on(25), 3, 1800, 'pending')]);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].status, merged[0].localId], ['saved', 'x-1']);
});

await test('the server run id links a run whose external_id did not come back', () => {
  const merged = d.mergeRuns([server('s1', on(25), 3, 1800)], [stored('x-1', on(25), 3, 1800, 'uploaded', { serverRunId: 's1' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].localId, 'x-1');
});

await test('runs that have not uploaded are added, newest first; short ones are shown but never counted', () => {
  const merged = d.mergeRuns(
    [server('s1', on(24), 4, 2400)],
    [stored('p1', on(26), 2, 1200, 'pending'), stored('a1', on(25), 1, 700, 'needs_attention'), stored('l1', on(27, 6), 0.004, 10, 'local_only')],
  );
  assert.deepEqual(merged.map((r) => [r.key, r.status, r.counted]),
    [['phone-l1', 'local_only', false], ['phone-p1', 'pending', true], ['phone-a1', 'needs_attention', true], ['s1', 'saved', true]]);
  assert.equal(merged[1].localId, 'p1');
});

await test('an uploaded run the server no longer lists is not counted from the phone copy', () => {
  // Deleted on the website: the server is the record of what was saved.
  const merged = d.mergeRuns([server('s1', on(24), 4, 2400)], [stored('gone', on(25), 3, 1800, 'uploaded', { serverRunId: 'old' })]);
  assert.deepEqual(merged.map((r) => r.key), ['s1']);
});

await test('offline: every run stored on the phone, uploaded ones included', () => {
  const merged = d.mergeRuns(null, [stored('u1', on(25), 3, 1800, 'uploaded'), stored('p1', on(26), 2, 1200, 'pending'), stored('l1', on(24), 0.004, 10, 'local_only')]);
  assert.deepEqual(merged.map((r) => [r.key, r.status, r.counted]),
    [['phone-p1', 'pending', true], ['phone-u1', 'saved', true], ['phone-l1', 'local_only', false]]);
});

await test('runs with no usable start time sort last and belong to no week', () => {
  const merged = d.mergeRuns([server('s0', null, 9, 5000), server('s1', on(24), 4, 2400)], []);
  assert.deepEqual(merged.map((r) => r.key), ['s1', 's0']);
  assert.equal(d.weekStats(merged, NOW).distance, 4);
});

await test('this week: distance, runs, time and average pace', () => {
  const merged = d.mergeRuns(
    [server('s1', on(23, 0, 0), 3, 1800), server('s2', on(25), 5, 2700), server('old', on(22, 23, 59), 10, 6000)],
    [stored('p1', on(26), 2, 1500, 'pending'), stored('l1', on(26, 9), 0.004, 10, 'local_only')],
  );
  const week = d.weekStats(merged, NOW);
  assert.deepEqual([week.runs, week.distance, week.time], [3, 10, 6000]);
  assert.equal(week.avgPaceSec, 600);
});

await test('the change against last week, as the website works it out', () => {
  const run = (day, miles) => server(`s${day}`, on(day), miles, miles * 600);
  assert.equal(d.weekStats(d.mergeRuns([run(24, 6), run(18, 4)], []), NOW).deltaPct, 50);
  assert.equal(d.weekStats(d.mergeRuns([run(24, 3), run(16, 2), run(22, 2)], []), NOW).deltaPct, -25);
  assert.equal(d.weekStats(d.mergeRuns([run(24, 3)], []), NOW).deltaPct, 100); // nothing last week
  assert.equal(d.weekStats(d.mergeRuns([run(18, 3)], []), NOW).deltaPct, -100);
  assert.equal(d.weekStats(d.mergeRuns([run(15, 9)], []), NOW).deltaPct, 0); // two weeks ago counts for neither
  assert.equal(d.weekStats([], NOW).deltaPct, 0);
});

await test('an empty week has no average pace', () => {
  const week = d.weekStats([], NOW);
  assert.deepEqual([week.runs, week.distance, week.time, week.avgPaceSec], [0, 0, 0, null]);
  assert.equal(d.weekStats(d.mergeRuns([server('s', on(24), 0.05, 40)], []), NOW).avgPaceSec, null); // too short to be a pace
});

await test('a run can be shared only once the server has it: its server id, or none', () => {
  const merged = d.mergeRuns(
    [server('s1', on(25), 3, 1800, { externalId: 'x-1' }), server('s2', on(24), 5, 3000)],
    [stored('x-1', on(25), 3, 1800, 'uploaded', { serverRunId: 's1' }), stored('x-9', on(26), 2, 1200, 'pending')],
  );
  assert.deepEqual(merged.map((r) => [r.key, r.serverId]), [['phone-x-9', null], ['s1', 's1'], ['s2', 's2']]);
  // With no connection, a run the phone saw uploaded keeps the id the server gave it.
  assert.deepEqual(d.mergeRuns(null, [stored('x-1', on(25), 3, 1800, 'uploaded', { serverRunId: 's1' })]).map((r) => r.serverId), ['s1']);
  assert.deepEqual(d.mergeRuns(null, [stored('x-2', on(25), 3, 1800, 'pending')]).map((r) => r.serverId), [null]);
});

done('dashboard: merging server and phone runs, weekly totals');
