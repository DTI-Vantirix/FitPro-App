import assert from 'node:assert/strict';
import { load, test, done, at, near } from './run-test-kit.mjs';

const d = load('src/run/directions.ts');
const MI = 1609.344;
const path = [at(0, 0), at(300, 0), at(300, 300)];
const turn = (index, north, east, alongM, text) => ({ index, instruction: text, verbal: `${text}.`, type: 10, ...at(north, east), at_mi: alongM / MI });
const maneuvers = [turn(0, 0, 0, 0, 'Head north on Elm St'), turn(1, 300, 0, 300, 'Turn right onto Oak Ave'), turn(2, 300, 300, 600, 'You have arrived')];
function walk(nav, steps, cues = []) {
  let next = null;
  for (const [north, east, sec] of steps) {
    const out = d.stepNav(nav, { path, maneuvers, position: at(north, east), nowMs: sec * 1000 });
    nav = out.nav; next = out.next; cues.push(...out.cues.map((x) => x.text));
  }
  return { nav, next, cues };
}

await test('the next turn and how far away it is', () => {
  const r = walk(d.initialNavState(), [[100, 0, 10]]);
  assert.equal(r.next.maneuver.index, 1);
  near(r.next.metersAway, 200, 1);
});
await test('each turn is spoken once, when 60 m or less remains', () => {
  let r = walk(d.initialNavState(), [[0, 0, 0]]);
  assert.deepEqual(r.cues, ['Head north on Elm St.']);
  r = walk(r.nav, [[100, 0, 30], [230, 0, 60]], r.cues);
  assert.equal(r.cues.length, 1);
  r = walk(r.nav, [[245, 0, 65], [260, 0, 70], [290, 0, 80]], r.cues);
  assert.deepEqual(r.cues, ['Head north on Elm St.', 'Turn right onto Oak Ave.']);
  r = walk(r.nav, [[300, 100, 110], [300, 250, 150], [300, 299, 165]], r.cues);
  assert.deepEqual(r.cues.slice(2), ['You have arrived.']);
  // at the finish the arrival stays on screen and is not spoken again
  const end = walk(r.nav, [[300, 300, 170]], r.cues);
  assert.equal(end.next.maneuver.index, 2);
  assert.equal(end.cues.length, 3);
});
await test('off route after 10 s at 40 m or more; back on route within 25 m', () => {
  let r = walk(d.initialNavState(), [[100, 0, 0], [100, 45, 1], [110, 45, 9]]);
  assert.deepEqual(r.cues, []);
  r = walk(r.nav, [[120, 45, 11], [130, 50, 60], [140, 50, 200]], r.cues);
  assert.deepEqual(r.cues, ['Off route']);
  assert.equal(r.nav.offRoute, true);
  r = walk(r.nav, [[150, 30, 210]], r.cues);
  assert.equal(r.nav.offRoute, true);
  r = walk(r.nav, [[160, 20, 220], [170, 0, 230]], r.cues);
  assert.deepEqual(r.cues, ['Off route', 'Back on route']);
});
await test('a brief wander does not count', () => {
  const r = walk(d.initialNavState(), [[100, 0, 0], [100, 45, 1], [100, 10, 8], [100, 45, 9], [100, 10, 17]]);
  assert.deepEqual(r.cues, []);
});
await test('no turn is spoken while off route', () => {
  const r = walk(d.initialNavState(), [[230, 0, 0], [235, 45, 1], [238, 45, 12], [245, 50, 20]]);
  assert.deepEqual(r.cues, ['Off route']);
});
await test('without directions the route line still gives off-route', () => {
  let nav = d.initialNavState();
  const cues = [];
  for (const [n, e, s] of [[100, 0, 0], [100, 60, 1], [100, 60, 12]]) {
    const out = d.stepNav(nav, { path, maneuvers: [], position: at(n, e), nowMs: s * 1000 });
    nav = out.nav; cues.push(...out.cues.map((x) => x.text));
    assert.equal(out.next, null);
  }
  assert.deepEqual(cues, ['Off route']);
});
await test('a route with no usable line does nothing', () => {
  const out = d.stepNav(d.initialNavState(), { path: [], maneuvers, position: at(0, 0), nowMs: 0 });
  assert.deepEqual([out.next, out.cues.length], [null, 0]);
});
done('directions and off-route');
