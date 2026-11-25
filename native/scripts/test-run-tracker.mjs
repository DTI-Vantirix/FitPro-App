import assert from 'node:assert/strict';
import { load, test, done, at, near } from './run-test-kit.mjs';

const geo = load('src/run/geo.ts');
const tr = load('src/run/tracker.ts');
const fix = (north, east, sec, accuracy = 5) => ({ ...at(north, east), t: sec * 1000, accuracy });

await test('distance between fixes', () => {
  near(geo.metersBetween(at(0, 0), at(100, 0)), 100, 0.5);
  near(geo.metersBetween(at(0, 0), at(0, 100)), 100, 0.5);
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0), 0);
  t = tr.addFix(t, fix(100, 0, 30), 30);
  near(t.meters, 100, 0.5);
  assert.equal(t.points.length, 2);
});
await test('jitter under 3 m adds nothing', () => {
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0), 0);
  for (let s = 1; s <= 60; s++) t = tr.addFix(t, fix(s % 2 ? 2 : 0, s % 3 ? 1 : 0, s), s);
  assert.equal(t.meters, 0);
  assert.equal(t.points.length, 1);
});
await test('poor accuracy and impossible jumps are dropped', () => {
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0), 0);
  t = tr.addFix(t, fix(50, 0, 10, 60), 10);
  assert.equal(t.meters, 0);
  t = tr.addFix(t, fix(500, 0, 11), 11);
  assert.equal(t.meters, 0);
  t = tr.addFix(t, fix(30, 0, 12), 12);
  near(t.meters, 30, 0.5);
  // a fix with no accuracy reading is accepted; one that goes back in time is not
  t = tr.addFix(t, fix(60, 0, 20, null), 20);
  near(t.meters, 60, 0.5);
  t = tr.addFix(t, fix(90, 0, 15), 21);
  near(t.meters, 60, 0.5);
  // garbage coordinates never reach the track
  t = tr.addFix(t, { lat: NaN, lng: 0, t: 30000, accuracy: 5 }, 22);
  t = tr.addFix(t, { lat: 95, lng: 0, t: 31000, accuracy: 5 }, 23);
  assert.equal(t.points.length, 3);
});
await test('standing still with a noisy GPS adds (almost) nothing', () => {
  // deterministic pseudo-noise of up to +/-5 m around one spot, accuracy 8 m, for 3 minutes
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 10; };
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0, 8), 0);
  for (let s = 1; s <= 180; s++) t = tr.addFix(t, fix(noise(), noise(), s, 8), s);
  assert.ok(t.meters < 15, `stationary phone ran up ${t.meters.toFixed(1)} m`);
  assert.equal(tr.rollingPaceSec(t.points, 180000), null);
});
await test('the phone saying it is not moving is believed', () => {
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0), 0);
  t = tr.addFix(t, { ...fix(6, 0, 2), speed: 0 }, 2);
  t = tr.addFix(t, { ...fix(0, 6, 4), speed: 0.1 }, 4);
  assert.equal(t.meters, 0);
  // moving again: counted from the anchor, so nothing is lost
  t = tr.addFix(t, { ...fix(12, 0, 8), speed: 3 }, 8);
  near(t.meters, 12, 0.5);
  // a phone that reports no speed (null or negative) is judged on position alone
  t = tr.addFix(t, { ...fix(24, 0, 12), speed: -1 }, 12);
  near(t.meters, 24, 0.5);
});
await test('a real run with ordinary accuracy still measures true', () => {
  let t = tr.emptyTrack();
  for (let s = 0; s <= 600; s++) t = tr.addFix(t, { ...fix(s * 3, 0, s, 12), speed: 3 }, s);
  near(t.meters, 1800, 8);
  near(tr.rollingPaceSec(t.points, 600000), 536, 6);
});
await test('a first fix that is inaccurate does not anchor the track', () => {
  const t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0, 80), 0);
  assert.equal(t.points.length, 0);
});
await test('the gap across a pause adds no distance', () => {
  let t = tr.addFix(tr.emptyTrack(), fix(0, 0, 0), 0);
  t = tr.addFix(t, fix(50, 0, 15), 15);
  t = tr.breakTrack(t);
  t = tr.addFix(t, fix(400, 0, 300), 15);
  near(t.meters, 50, 0.5);
  t = tr.addFix(t, fix(450, 0, 315), 30);
  near(t.meters, 100, 0.5);
  assert.equal(t.points[2].seg, true);
});
await test('a split closes at each whole mile', () => {
  let t = tr.emptyTrack();
  // 3.4 m/s: a mile every ~473 s
  for (let s = 0; s <= 1000; s += 2) t = tr.addFix(t, fix(s * 3.4, 0, s), s);
  assert.equal(t.splits.length, 2);
  assert.equal(t.splits[0].mile, 1);
  near(t.splits[0].pace_sec, 474, 3);
  near(t.splits[1].pace_sec, 473, 3);
});
await test('rolling pace', () => {
  let t = tr.emptyTrack();
  for (let s = 0; s <= 60; s += 1) t = tr.addFix(t, fix(s * 3, 0, s), s);
  near(tr.rollingPaceSec(t.points, 60000), 536, 3);
  let short = tr.emptyTrack();
  for (let s = 0; s <= 8; s += 1) short = tr.addFix(short, fix(s * 3, 0, s), s);
  assert.equal(tr.rollingPaceSec(short.points, 8000), null);
  // stale: nothing accepted for a while (standing still) -> unknown, not a made-up pace
  assert.equal(tr.rollingPaceSec(t.points, 100000), null);
  // the window never reaches back across a pause
  let paused = tr.breakTrack(t);
  for (let s = 200; s <= 205; s += 1) paused = tr.addFix(paused, fix(180 + (s - 200) * 3, 0, s), 60 + s - 200);
  assert.equal(tr.rollingPaceSec(paused.points, 205000), null);
});
await test('projection onto a path', () => {
  const path = [at(0, 0), at(100, 0), at(100, 100)];
  let p = geo.projectOnPath(path, at(50, 10));
  near(p.offMeters, 10, 0.5); near(p.alongMeters, 50, 0.5);
  p = geo.projectOnPath(path, at(120, 60));
  near(p.offMeters, 20, 0.5); near(p.alongMeters, 160, 0.5);
  p = geo.projectOnPath(path, at(-30, 0));
  near(p.offMeters, 30, 0.5); near(p.alongMeters, 0, 0.5);
  assert.equal(geo.projectOnPath([at(0, 0)], at(1, 1)), null);
  near(geo.pathLengthMeters(path), 200, 1);
});
await test('an out-and-back uses the hint to stay on the return leg', () => {
  const path = [at(0, 0), at(200, 0), at(0, 0)];
  near(geo.projectOnPath(path, at(50, 0)).alongMeters, 50, 0.5);
  near(geo.projectOnPath(path, at(50, 0), 340).alongMeters, 350, 0.5);
});
await test('thinning keeps the ends and the cap', () => {
  const many = Array.from({ length: 12000 }, (_, i) => i);
  const thin = geo.thinPoints(many, 5000);
  assert.equal(thin.length, 5000);
  assert.equal(thin[0], 0);
  assert.equal(thin[4999], 11999);
  assert.deepEqual(geo.thinPoints([1, 2, 3], 5000), [1, 2, 3]);
});
done('geometry and tracking');
