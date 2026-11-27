import assert from 'node:assert/strict';
import { load, test, done, near } from './run-test-kit.mjs';

const a = load('src/run/analytics.ts');

// Friday 27 November 2026, local time. That week's Monday is the 23rd.
const NOW = new Date(2026, 10, 27, 12, 0, 0);
const at = (month, day, hour = 7) => new Date(2026, month - 1, day, hour).toISOString();
const run = (startedAt, distanceMi, durationSec, extra = {}) => ({
  routeName: 'Free run', distanceMi, durationSec, avgPaceSec: durationSec / distanceMi, startedAt, targetZoneName: null, ...extra,
});

await test('short dates read like the website', () => {
  assert.equal(a.shortDate(new Date(2026, 10, 23)), 'Nov 23');
  assert.equal(a.shortDate(new Date(2026, 0, 5)), 'Jan 5');
  assert.equal(a.shortDate(at(10, 5)), 'Oct 5');
  assert.equal(a.shortDate(null), '');
  assert.equal(a.shortDate('nonsense'), '');
});

await test('weekly distance: the last eight weeks, Monday to Sunday, oldest first', () => {
  const weeks = a.weeklyDistance([
    run(at(11, 27), 3.104, 1800), run(at(11, 23, 0), 2, 1200), // this week
    run(at(11, 22, 23), 5, 3000),                               // last week (Sunday night)
    run(at(10, 5), 6, 3600),                                    // first of the eight weeks
    run(at(10, 4), 20, 9000),                                   // a day too old
    run(null, 7, 4000),                                         // no date: in no week
  ], NOW);
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.map((w) => w.label), ['Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16', 'Nov 23']);
  assert.deepEqual(weeks.map((w) => w.miles), [6, 0, 0, 0, 0, 0, 5, 5.1]);
});

await test('pace trend: the latest fourteen runs with a pace, oldest first', () => {
  const runs = Array.from({ length: 16 }, (_, i) => run(at(11, 27 - i), 3, 1800 + i * 3)); // newest first, as the server sends
  runs.splice(1, 0, { ...run(at(11, 26, 9), 1, 0), avgPaceSec: 0 });                        // no pace: skipped
  const trend = a.paceTrend(runs);
  assert.equal(trend.length, 14);
  assert.deepEqual([trend[0].label, trend[13].label], ['Nov 14', 'Nov 27']);
  assert.deepEqual([trend[0].pace, trend[13].pace], [613, 600]);
  assert.deepEqual(a.paceTrend([]), []);
});

await test('totals across every run, and how often each zone was the target', () => {
  const totals = a.totals([
    run(at(11, 27), 3, 1800, { targetZoneName: 'Zone 2' }), run(at(11, 25), 5, 2700, { targetZoneName: 'Zone 3' }),
    run(at(11, 20), 2, 1500, { targetZoneName: 'Zone 2' }), run(at(11, 18), 2, 1200),
  ]);
  assert.deepEqual([totals.runs, totals.miles, totals.timeSec, totals.avgPaceSec], [4, 12, 7200, 600]);
  assert.deepEqual(totals.zones, [{ name: 'Zone 2', count: 2, share: 0.5 }, { name: 'Zone 3', count: 1, share: 0.25 }, { name: 'Unzoned', count: 1, share: 0.25 }]);
  const none = a.totals([]);
  assert.deepEqual([none.runs, none.miles, none.timeSec, none.avgPaceSec, none.zones], [0, 0, 0, null, []]);
});

await test('best efforts: the longest run and the fastest average pace', () => {
  const best = a.bestEfforts([
    run(at(11, 27), 3, 1500, { routeName: 'Quick' }), run(at(11, 25), 8, 5200, { routeName: 'Long' }), { ...run(at(11, 24), 1, 0), avgPaceSec: 0 },
  ]);
  assert.deepEqual([best.longest.routeName, best.fastest.routeName], ['Long', 'Quick']);
  assert.deepEqual(a.bestEfforts([]), { longest: null, fastest: null });
});

await test('moving time reads in hours once there is an hour of it', () => {
  assert.deepEqual(a.movingTime(7200), { value: '2:00:00', unit: 'hrs' });
  assert.deepEqual(a.movingTime(1835), { value: '30:35', unit: 'min' });
  assert.deepEqual(a.movingTime(0), { value: '0:00', unit: 'min' });
});

await test('distance axis: round steps that clear the tallest bar', () => {
  assert.deepEqual(a.distanceAxis([6, 0, 13.2]), { max: 15, ticks: [0, 5, 10, 15] });
  assert.deepEqual(a.distanceAxis([3.1, 2]), { max: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(a.distanceAxis([0.7]), { max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8] });
  assert.deepEqual(a.distanceAxis([40]), { max: 40, ticks: [0, 10, 20, 30, 40] });
  assert.deepEqual(a.distanceAxis([0, 0]), { max: 1, ticks: [0, 1] });
  assert.deepEqual(a.distanceAxis([]), { max: 1, ticks: [0, 1] });
});

await test('pace axis is reversed: the fastest pace is at the top, with 20 s of room either side', () => {
  const axis = a.paceAxis([{ label: 'a', pace: 600 }, { label: 'b', pace: 540 }, { label: 'c', pace: 570 }]);
  assert.deepEqual([axis.top, axis.bottom], [520, 620]);
  assert.deepEqual(axis.ticks, [520, 570, 620]);
});

await test('pace line: left to right in time, faster is higher on the screen', () => {
  const trend = [{ label: 'a', pace: 600 }, { label: 'b', pace: 540 }, { label: 'c', pace: 570 }];
  const points = a.plotPace(trend, 200, 100);
  assert.deepEqual(points.map((p) => p.x), [0, 100, 200]);
  assert.deepEqual(points.map((p) => p.y), [80, 20, 50]);       // y grows downwards: 540 (fastest) is nearest the top
  assert.ok(points[1].y < points[2].y && points[2].y < points[0].y);
  assert.deepEqual(a.plotPace([{ label: 'a', pace: 600 }], 200, 100), [{ x: 100, y: 50 }]);
  assert.deepEqual(a.plotPace(trend, 0, 100), []);               // not laid out yet
  const flat = a.plotPace([{ label: 'a', pace: 600 }, { label: 'b', pace: 600 }], 200, 100);
  assert.deepEqual(flat.map((p) => p.y), [50, 50]);
});

await test('line segments between points: centre, length and angle for a rotated bar', () => {
  const [up, level] = a.lineSegments([{ x: 0, y: 30 }, { x: 40, y: 0 }, { x: 90, y: 0 }]);
  assert.deepEqual([up.cx, up.cy, up.length], [20, 15, 50]);
  near(up.angleDeg, -36.87, 0.01);
  assert.deepEqual(level, { cx: 65, cy: 0, length: 50, angleDeg: 0 });
  assert.deepEqual(a.lineSegments([{ x: 1, y: 1 }]), []);
});

await test('bar heights are a share of the axis, never outside it', () => {
  assert.equal(a.barHeight(5, 20, 160), 40);
  assert.equal(a.barHeight(0, 20, 160), 0);
  assert.equal(a.barHeight(25, 20, 160), 160);
  assert.equal(a.barHeight(0.01, 20, 160), 2); // a week with any running shows a sliver
});

done('analytics: weekly distance, pace trend, totals, chart geometry');
