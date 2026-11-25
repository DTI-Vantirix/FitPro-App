import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const c = load('src/run/cues.ts');
const open = { muted: false, graceUntil: 0 };
/** Feeds one status per second from `from` to `to` (seconds) and collects cues. */
function feed(state, metric, status, from, to, opts = open, cues = []) {
  for (let s = from; s <= to; s++) {
    const pick = typeof status === 'function' ? status(s) : status;
    const out = c.stepMetricCue(state, metric, pick, s * 1000, opts);
    state = out.state;
    if (out.cue) cues.push({ ...out.cue, s });
  }
  return { state, cues };
}

await test('a change is announced only after it has held 10 s', () => {
  let r = feed(c.initialMetricCueState(), 'hr', 'high', 1, 10);
  assert.equal(r.cues.length, 0);
  r = feed(r.state, 'hr', 'high', 11, 11, open, r.cues);
  assert.deepEqual(r.cues.map((x) => [x.text, x.kind, x.metric, x.s]), [['Heart rate above zone', 'left', 'hr', 11]]);
});
await test('one reminder after 120 s out, then silence', () => {
  const r = feed(c.initialMetricCueState(), 'hr', 'high', 1, 600);
  assert.deepEqual(r.cues.map((x) => [x.text, x.kind]), [['Heart rate above zone', 'left'], ['Still: Heart rate above zone', 'reminder']]);
  assert.equal(r.cues[1].s, 131);
});
await test('coming back is announced, and a later exit can be reminded again', () => {
  let r = feed(c.initialMetricCueState(), 'pace', 'low', 1, 200);
  r = feed(r.state, 'pace', 'in', 201, 230, open, r.cues);
  r = feed(r.state, 'pace', 'low', 231, 400, open, r.cues);
  assert.deepEqual(r.cues.map((x) => x.text), ['Pace slower than zone', 'Still: Pace slower than zone', 'Pace back in zone', 'Pace slower than zone', 'Still: Pace slower than zone']);
  assert.equal(r.cues[2].kind, 'returned');
});
await test('flicker across the edge makes no noise', () => {
  const r = feed(c.initialMetricCueState(), 'pace', (s) => (Math.floor(s / 4) % 2 ? 'high' : 'in'), 1, 120);
  assert.equal(r.cues.length, 0);
});
await test('switching sides announces the new side', () => {
  let r = feed(c.initialMetricCueState(), 'pace', 'high', 1, 20);
  r = feed(r.state, 'pace', 'low', 21, 40, open, r.cues);
  assert.deepEqual(r.cues.map((x) => x.text), ['Pace faster than zone', 'Pace slower than zone']);
});
await test('no reading: nothing is said and the timers wait', () => {
  let r = feed(c.initialMetricCueState(), 'hr', 'low', 1, 60);
  r = feed(r.state, 'hr', 'unknown', 61, 400, open, r.cues);
  assert.deepEqual(r.cues.map((x) => x.text), ['Heart rate below zone']);
  // about 50 s out before the gap, so the reminder needs about 70 s more of readings
  r = feed(r.state, 'hr', 'low', 401, 460, open, r.cues);
  assert.equal(r.cues.length, 1);
  r = feed(r.state, 'hr', 'low', 461, 480, open, r.cues);
  assert.deepEqual(r.cues.map((x) => x.kind), ['left', 'reminder']);
});
await test('a strap that drops while in zone never says "below"', () => {
  let r = feed(c.initialMetricCueState(), 'hr', 'in', 1, 100);
  r = feed(r.state, 'hr', 'unknown', 101, 500, open, r.cues);
  assert.equal(r.cues.length, 0);
});
await test('nothing during the start grace, then the normal 10 s hold', () => {
  const grace = { muted: false, graceUntil: 60000 };
  const r = feed(c.initialMetricCueState(), 'pace', 'high', 1, 75, grace);
  assert.deepEqual(r.cues.map((x) => [x.text, x.s]), [['Pace faster than zone', 70]]);
});
await test('muted: silent, and un-muting does not replay what was missed', () => {
  let r = feed(c.initialMetricCueState(), 'hr', 'high', 1, 300, { muted: true, graceUntil: 0 });
  assert.equal(r.cues.length, 0);
  r = feed(r.state, 'hr', 'high', 301, 600, open, r.cues);
  assert.equal(r.cues.length, 0);
  r = feed(r.state, 'hr', 'in', 601, 620, open, r.cues);
  assert.deepEqual(r.cues.map((x) => x.text), ['Heart rate back in zone']);
});
await test('no cue ever tells the runner what to do', () => {
  const texts = Object.values(c.CUE_TEXT).flatMap((m) => Object.values(m)).concat(c.ROUTE_TEXT.off, c.ROUTE_TEXT.back);
  assert.equal(texts.length, 8);
  for (const text of texts) assert.ok(!/slow down|speed up|ease|push|should|try|keep/i.test(text), text);
});
done('cue scheduling');
