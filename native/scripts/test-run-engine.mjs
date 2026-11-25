import assert from 'node:assert/strict';
import { load, test, done, at, near } from './run-test-kit.mjs';

const e = load('src/run/engine.ts');
const p = load('src/run/payload.ts');
const z = load('src/run/zones.ts');
const fmt = load('src/run/format.ts');

const T0 = Date.parse('2026-11-25T12:00:00Z');
const zone2 = { ...z.zoneTemplate(600)[1], id: 'zone-2' }; // 11:30–12:48 per mile, 60–70 %
const config = (over = {}) => ({ externalId: 'run-abc', mode: 'free', zone: zone2, hrMax: 190, route: null, ownerId: 'user-1', ...over });
const IN_ZONE = 1609.344 / 720; // 12:00 per mile, in metres per second
const FAST = 1609.344 / 600; // 10:00 per mile

/** Runs `seconds` of straight-line running from `fromSec`, one fix and one clock tick a second. */
function go(state, fromSec, seconds, speed, opts = {}) {
  const cues = opts.cues ?? [];
  let north = opts.north ?? 0;
  for (let s = fromSec + 1; s <= fromSec + seconds; s++) {
    const t = T0 + s * 1000;
    north += speed;
    if (!opts.noGps) {
      const out = e.onFix(state, { ...at(north, opts.east ?? 0), t, accuracy: 5 });
      state = out.state; cues.push(...out.cues);
    }
    if (opts.bpm) state = e.onHeartRate(state, typeof opts.bpm === 'function' ? opts.bpm(s) : opts.bpm, t, 'Polar H10');
    const out = e.onClock(state, t);
    state = out.state; cues.push(...out.cues);
  }
  return { state, cues, north };
}

await test('a steady in-zone run: distance, time, pace, split, time in zone', () => {
  let { state, cues } = go(e.startRun(config(), T0), 0, 780, IN_ZONE, { bpm: 125 });
  assert.equal(state.paceStatus, 'in');
  assert.equal(state.hrStatus, 'in');
  near(state.pace, 720, 4);
  assert.equal(state.bpm, 125);
  assert.deepEqual(cues, []);
  state = e.finishRun(state, T0 + 780000);
  const s = p.summarize(state);
  near(s.distanceMi, 780 / 720, 0.01);
  assert.equal(s.durationSec, 780);
  // a split closes at the first accepted fix past the mile mark, so it can read a few seconds long
  near(s.avgPaceSec, 720, 6);
  assert.equal(s.splits.length, 1);
  near(s.splits[0].pace_sec, 720, 6);
  assert.equal(s.paceInZonePct, 100);
  assert.equal(s.hrInZonePct, 100);
  assert.deepEqual(s.hr, { min: 125, max: 125, avg: 125 });
  assert.deepEqual(s.zone, { name: 'Zone 2', fast_sec: 690, slow_sec: 768, hrMin: 114, hrMax: 133 });
  assert.equal(s.startedAt, '2026-11-25T12:00:00.000Z');
  assert.equal(s.routeName, 'Free run');
});

await test('pace and heart rate disagree: both are shown, only the one that left is announced', () => {
  const { state, cues } = go(e.startRun(config(), T0), 0, 150, FAST, { bpm: 125 });
  assert.equal(state.paceStatus, 'faster');
  assert.equal(state.hrStatus, 'in');
  assert.deepEqual(cues.map((c) => c.text), ['Pace faster than zone']);
  assert.ok(cues[0].at >= T0 + 70000, 'not during the first minute');
});

await test('both out at once: one cue each, neither suppresses the other', () => {
  const { cues } = go(e.startRun(config(), T0), 0, 100, FAST, { bpm: 160 });
  assert.deepEqual(cues.map((c) => c.text).sort(), ['Heart rate above zone', 'Pace faster than zone']);
});

await test('muting one metric leaves the other speaking; it can change mid-run', () => {
  let r = go(e.startRun(config(), T0, { pace: true, hr: false }), 0, 100, FAST, { bpm: 160 });
  assert.deepEqual(r.cues.map((c) => c.text), ['Heart rate above zone']);
  const state = e.setMute(r.state, { pace: false, hr: true });
  r = go(state, 100, 300, FAST, { bpm: 160, north: r.north });
  // the pace reminder falls due after pace was un-muted; the heart-rate one is now silent
  assert.deepEqual(r.cues.map((c) => c.text), ['Still: Pace faster than zone']);
});

await test('time paused is not run time and the distance covered while paused is not counted', () => {
  let r = go(e.startRun(config(), T0), 0, 300, IN_ZONE);
  let state = e.pauseRun(r.state, T0 + 300000);
  assert.equal(state.status, 'paused');
  // walks 200 m during a 10 minute pause
  r = go(state, 300, 600, 200 / 600, { north: r.north });
  assert.equal(r.state.track.points.length, state.track.points.length);
  state = e.resumeRun(r.state, T0 + 900000);
  r = go(state, 900, 300, IN_ZONE, { north: r.north });
  const s = p.summarize(e.finishRun(r.state, T0 + 1200000));
  assert.equal(s.durationSec, 600);
  near(s.distanceMi, 600 / 720, 0.01);
  assert.equal(r.cues.length, 0);
});

await test('while paused the heart-rate status follows the live reading', () => {
  let r = go(e.startRun(config(), T0), 0, 100, IN_ZONE, { bpm: 160 });
  assert.equal(r.state.hrStatus, 'above');
  let state = e.pauseRun(r.state, T0 + 100000);
  for (let s = 101; s <= 130; s++) {
    state = e.onHeartRate(state, 120, T0 + s * 1000);
    state = e.onClock(state, T0 + s * 1000).state;
  }
  assert.deepEqual([state.bpm, state.hrStatus], [120, 'in']);
  // nothing from the pause reaches the run's heart-rate stats or zone time
  assert.equal(state.hr.min, 160);
  assert.equal(state.zoneSec.hrKnown, r.state.zoneSec.hrKnown);
});

await test('pause and resume are idempotent, and nothing changes after finish', () => {
  let state = e.startRun(config(), T0);
  state = e.pauseRun(e.pauseRun(state, T0 + 10000), T0 + 20000);
  state = e.resumeRun(e.resumeRun(state, T0 + 30000), T0 + 40000);
  state = e.finishRun(state, T0 + 50000);
  assert.equal(p.summarize(state).durationSec, 30);
  const after = e.onClock(e.finishRun(state, T0 + 90000), T0 + 99000).state;
  assert.equal(p.summarize(after).durationSec, 30);
  assert.equal(e.onFix(after, { ...at(0, 0), t: T0 + 99000, accuracy: 5 }).state.track.points.length, 0);
});

await test('a strap that drops out: unknown, no "below" cue, and time in zone only counts time with a reading', () => {
  let r = go(e.startRun(config(), T0), 0, 300, IN_ZONE, { bpm: 125 });
  r = go(r.state, 300, 300, IN_ZONE, { north: r.north, cues: r.cues });
  assert.equal(r.state.bpm, null);
  assert.equal(r.state.hrStatus, 'unknown');
  assert.deepEqual(r.cues, []);
  const s = p.summarize(e.finishRun(r.state, T0 + 600000));
  assert.equal(s.hrInZonePct, 100);
  assert.equal(s.paceInZonePct, 100);
  assert.deepEqual(s.hr, { min: 125, max: 125, avg: 125 });
});

await test('heart-rate stats: min, max, average, share in zone; junk readings ignored', () => {
  let state = e.startRun(config(), T0);
  state = e.onHeartRate(state, 0, T0 + 500);
  state = e.onHeartRate(state, 300, T0 + 600);
  state = e.onHeartRate(state, NaN, T0 + 700);
  assert.equal(state.hr.count, 0);
  const r = go(state, 0, 400, IN_ZONE, { bpm: (s) => (s <= 100 ? 110 : s <= 300 ? 130 : 150) });
  const s = p.summarize(e.finishRun(r.state, T0 + 400000));
  assert.deepEqual(s.hr, { min: 110, max: 150, avg: 130 });
  near(s.hrInZonePct, 50, 4);
  assert.equal(s.hrDevice, 'Polar H10');
});

await test('no heart-rate sensor: pace is still coached and no heart-rate numbers are invented', () => {
  const r = go(e.startRun(config(), T0), 0, 300, FAST);
  assert.equal(r.state.hrStatus, 'unknown');
  assert.deepEqual(r.cues.map((c) => c.text), ['Pace faster than zone', 'Still: Pace faster than zone']);
  const s = p.summarize(e.finishRun(r.state, T0 + 300000));
  assert.equal(s.hr, null);
  assert.equal(s.hrInZonePct, null);
  const payload = p.buildRunPayload(s);
  for (const key of ['avg_hr', 'max_hr', 'min_hr', 'hr_in_zone_pct', 'hr_device']) assert.ok(!(key in payload), key);
  assert.equal(payload.hr_target_min, 114);
});

await test('no max heart rate: heart rate is shown but not judged', () => {
  const r = go(e.startRun(config({ hrMax: null }), T0), 0, 200, IN_ZONE, { bpm: 180 });
  assert.equal(r.state.bpm, 180);
  assert.equal(r.state.hrStatus, 'unknown');
  const payload = p.buildRunPayload(p.summarize(e.finishRun(r.state, T0 + 200000)));
  assert.ok(!('hr_target_min' in payload) && !('hr_in_zone_pct' in payload));
  assert.equal(payload.max_hr, 180);
});

await test('a suspended timer credits the run time but not zone time it never observed', () => {
  let r = go(e.startRun(config(), T0), 0, 100, IN_ZONE);
  const out = e.onClock(r.state, T0 + 400000);
  assert.equal(p.summarize(e.finishRun(out.state, T0 + 400000)).durationSec, 400);
  assert.ok(out.state.zoneSec.paceKnown <= 106);
});

await test('the payload is exactly the contract', () => {
  const route = { id: '0b0e7c0e-1111-4222-8333-444455556666', name: 'Ironworks loop', path: [at(0, 0), at(5000, 0)], maneuvers: [] };
  const r = go(e.startRun(config({ mode: 'route', route }), T0), 0, 780, IN_ZONE, { bpm: 125 });
  const s = p.summarize(e.finishRun(r.state, T0 + 780000));
  const payload = p.buildRunPayload(s);
  assert.deepEqual(Object.keys(payload).sort(), ['avg_hr', 'distance_mi', 'duration_sec', 'external_id', 'hr_device', 'hr_in_zone_pct',
    'hr_target_max', 'hr_target_min', 'in_zone_pct', 'kind', 'max_hr', 'min_hr', 'points', 'route_id', 'route_name', 'source', 'splits',
    'started_at', 'target_fast_sec', 'target_slow_sec', 'target_zone_name']);
  assert.equal(payload.kind, 'run');
  assert.equal(payload.source, 'fitpro');
  assert.equal(payload.external_id, 'run-abc');
  assert.equal(payload.route_id, route.id);
  assert.equal(payload.route_name, 'Ironworks loop');
  assert.equal(payload.duration_sec, 780);
  assert.equal(payload.target_zone_name, 'Zone 2');
  assert.deepEqual([payload.target_fast_sec, payload.target_slow_sec, payload.hr_target_min, payload.hr_target_max], [690, 768, 114, 133]);
  assert.deepEqual(Object.keys(payload.points[0]), ['lat', 'lng']);
  assert.deepEqual(Object.keys(payload.splits[0]), ['mile', 'pace_sec']);
  assert.ok(payload.points.length <= 5000);
  assert.equal(JSON.parse(JSON.stringify(payload)).distance_mi, payload.distance_mi);
});

await test('a long run is thinned to 5000 points', () => {
  let state = e.startRun(config(), T0);
  for (let s = 1; s <= 7000; s++) state = e.onFix(state, { ...at(s * 3.2, 0), t: T0 + s * 1000, accuracy: 3 }).state;
  const s = p.summarize(e.finishRun(e.onClock(state, T0 + 7000000).state, T0 + 7000000));
  assert.equal(s.points.length, 5000);
});

await test('a run that went nowhere builds no payload', () => {
  const r = go(e.startRun(config(), T0), 0, 30, 0);
  const s = p.summarize(e.finishRun(r.state, T0 + 30000));
  assert.equal(s.distanceMi, 0);
  assert.equal(s.avgPaceSec, null);
  assert.equal(p.buildRunPayload(s), null);
});

await test('a route run speaks turns and off-route through the engine', () => {
  const MI = 1609.344;
  const route = { id: 'r1', name: 'Loop', path: [at(0, 0), at(300, 0), at(300, 300)],
    maneuvers: [{ index: 0, instruction: 'Head north', verbal: 'Head north.', type: 1, ...at(0, 0), at_mi: 0 },
      { index: 1, instruction: 'Turn right onto Oak Ave', verbal: 'Turn right onto Oak Ave.', type: 10, ...at(300, 0), at_mi: 300 / MI }] };
  let r = go(e.startRun(config({ mode: 'route', route }), T0), 0, 120, IN_ZONE);
  assert.deepEqual(r.cues.map((c) => c.text), ['Head north.', 'Turn right onto Oak Ave.']);
  assert.equal(r.state.next.maneuver.index, 1);
  // carries straight on past the corner instead of turning
  r = go(r.state, 120, 60, IN_ZONE, { north: r.north });
  assert.deepEqual(r.cues.map((c) => c.text), ['Off route']);
  assert.equal(r.state.nav.offRoute, true);
});

await test('state survives being written to disk and read back', () => {
  let r = go(e.startRun(config(), T0), 0, 120, IN_ZONE, { bpm: 125 });
  const revived = JSON.parse(JSON.stringify(r.state));
  r = go(revived, 120, 60, IN_ZONE, { bpm: 125, north: r.north });
  near(p.summarize(e.finishRun(r.state, T0 + 180000)).distanceMi, 180 / 720, 0.01);
});

await test('display text', () => {
  assert.equal(fmt.formatDuration(1182), '19:42');
  assert.equal(fmt.formatDuration(3723), '1:02:03');
  assert.equal(fmt.formatMiles(2.3149), '2.31');
  assert.equal(fmt.formatDistanceAway(1200), '0.7 mi');
  assert.equal(fmt.formatDistanceAway(120), '400 ft');
  assert.equal(fmt.formatDistanceAway(4), 'now');
  assert.deepEqual([fmt.paceLabel('in'), fmt.paceLabel('faster'), fmt.paceLabel('slower'), fmt.paceLabel('unknown')], ['in zone', 'faster', 'slower', '—']);
  assert.deepEqual([fmt.hrLabel('in'), fmt.hrLabel('above'), fmt.hrLabel('below'), fmt.hrLabel('unknown')], ['in zone', 'above', 'below', 'no sensor']);
  assert.equal(fmt.zoneLine({ name: 'Zone 2', fast_sec: 495, slow_sec: 540 }, { min: 125, max: 145 }), 'Zone 2 · 8:15–9:00 · 125–145');
  assert.equal(fmt.zoneLine({ name: 'Zone 2', fast_sec: 495, slow_sec: 540 }, null), 'Zone 2 · 8:15–9:00');
});
done('run engine, summary, payload, display text');
