import assert from 'node:assert/strict';
import { load, test, done, at, near } from './run-test-kit.mjs';

const { createRunController, CHECKPOINT_EVERY_MS } = load('src/run/controller.ts');
const z = load('src/run/zones.ts');

const T0 = Date.parse('2026-11-25T12:00:00Z');
const zone2 = { ...z.zoneTemplate(600)[1], id: 'zone-2' };
const config = (over = {}) => ({ externalId: 'run-1', mode: 'free', zone: zone2, hrMax: 190, route: null, ownerId: 'user-1', ...over });
const FAST = 1609.344 / 600;

function world() {
  const w = {
    now: T0, onFix: null, tickFn: null, tracking: 0, stops: 0, clockStops: 0, cues: [], files: new Map(), uploads: [],
    checkpointFile: null, checkpointSaves: 0, events: [], failStoreWrite: false, denyLocation: false,
  };
  w.deps = {
    now: () => w.now,
    startTracking: async (handler) => { if (w.denyLocation) throw new Error('Location permission is needed to record a run.'); w.tracking += 1; w.onFix = handler; },
    stopTracking: async () => { w.stops += 1; w.onFix = null; w.events.push('stopTracking'); },
    startClock: (tick) => { w.tickFn = tick; return () => { w.tickFn = null; w.clockStops += 1; }; },
    playCue: (cue) => { w.cues.push(cue.text); },
    store: {
      list: async () => [...w.files.keys()],
      read: async (id) => (w.files.has(id) ? JSON.parse(w.files.get(id)) : null),
      write: async (id, run) => { if (w.failStoreWrite) throw new Error('disk full'); w.files.set(id, JSON.stringify(run)); w.events.push('storeWrite'); },
      remove: async (id) => { w.files.delete(id); },
    },
    checkpoint: {
      save: async (state) => { w.checkpointFile = JSON.stringify(state); w.checkpointSaves += 1; },
      load: async () => (w.checkpointFile ? JSON.parse(w.checkpointFile) : null),
      clear: async () => { w.checkpointFile = null; w.events.push('checkpointClear'); },
    },
    requestUpload: (ownerId) => { w.uploads.push(ownerId); w.events.push('upload'); },
  };
  /** One second of running: a fix `speed` metres further north, then the 1 s timer. */
  w.north = 0;
  w.run = (seconds, speed, bpm) => {
    for (let i = 0; i < seconds; i++) {
      w.now += 1000;
      w.north += speed;
      w.onFix?.({ ...at(w.north, 0), t: w.now, accuracy: 5 });
      if (bpm) w.controller.heartRate(bpm, 'Polar H10');
      w.tickFn?.();
    }
  };
  w.controller = createRunController(w.deps);
  return w;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

await test('begin starts tracking and the clock; cues from the engine are played once', async () => {
  const w = world();
  let notified = 0;
  w.controller.subscribe(() => { notified += 1; });
  await w.controller.begin(config(), { pace: false, hr: false });
  assert.equal(w.tracking, 1);
  assert.ok(w.tickFn);
  w.run(100, FAST, 160);
  assert.deepEqual([...w.cues].sort(), ['Heart rate above zone', 'Pace faster than zone']);
  assert.ok(notified >= 100);
  const state = w.controller.getState();
  assert.equal(state.paceStatus, 'faster');
  assert.equal(state.hrStatus, 'above');
  await assert.rejects(w.controller.begin(config({ externalId: 'run-2' }), { pace: false, hr: false }), /already in progress/);
});

await test('no location permission: no run starts', async () => {
  const w = world();
  w.denyLocation = true;
  await assert.rejects(w.controller.begin(config(), { pace: false, hr: false }), /Location permission/);
  assert.equal(w.controller.getState(), null);
  assert.equal(w.checkpointFile, null);
});

await test('the checkpoint is written at the start, on pause, and at most every 15 s in between', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  await settle();
  assert.equal(w.checkpointSaves, 1);
  w.run(60, FAST);
  await settle();
  assert.equal(w.checkpointSaves, 1 + Math.floor(60000 / CHECKPOINT_EVERY_MS));
  w.controller.pause();
  await settle();
  assert.equal(JSON.parse(w.checkpointFile).status, 'paused');
});

await test('finish: stop the phone, write the run, then clear the checkpoint, then ask for upload', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(300, FAST, 150);
  const id = await w.controller.finish();
  assert.equal(id, 'run-1');
  assert.deepEqual(w.events, ['stopTracking', 'storeWrite', 'checkpointClear', 'upload']);
  assert.equal(w.clockStops, 1);
  assert.equal(w.controller.getState(), null);
  const stored = JSON.parse(w.files.get('run-1'));
  assert.equal(stored.status, 'pending');
  assert.equal(stored.ownerId, 'user-1');
  assert.equal(stored.payload.source, 'fitpro');
  assert.equal(stored.payload.external_id, 'run-1');
  near(stored.summary.distanceMi, 0.5, 0.01);
  assert.equal(stored.summary.durationSec, 300);
  assert.deepEqual(w.uploads, ['user-1']);
});

await test('finish pressed twice saves one run', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(120, FAST);
  const [a, b] = await Promise.all([w.controller.finish(), w.controller.finish()]);
  assert.deepEqual([a, b], ['run-1', 'run-1']);
  assert.equal(w.events.filter((e) => e === 'storeWrite').length, 1);
});

await test('the run file cannot be written: the run is not lost and can be recovered', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(300, FAST);
  w.failStoreWrite = true;
  await assert.rejects(w.controller.finish(), /disk full/);
  assert.ok(w.checkpointFile, 'checkpoint kept');
  assert.equal(JSON.parse(w.checkpointFile).status, 'finished');
  assert.deepEqual(w.uploads, []);
  // next launch: storage works again
  const next = world();
  next.checkpointFile = w.checkpointFile;
  assert.equal(await next.controller.recover('user-1'), 'saved');
  assert.equal(JSON.parse(next.files.get('run-1')).summary.durationSec, 300);
  assert.equal(next.checkpointFile, null);
});

await test('a short walk to nowhere is kept on the phone and not queued for upload', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(20, 0);
  await w.controller.finish();
  const stored = JSON.parse(w.files.get('run-1'));
  assert.deepEqual([stored.status, stored.payload], ['local_only', null]);
});

await test('app closed mid-run: the run comes back paused at the last known moment', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(60, FAST);
  await settle();
  // the app is killed; an hour later it is opened again
  const next = world();
  next.checkpointFile = w.checkpointFile;
  next.now = w.now + 3600000;
  assert.equal(await next.controller.recover('someone-else'), 'none');
  assert.equal(await next.controller.recover('user-1'), 'paused');
  const state = next.controller.getState();
  assert.equal(state.status, 'paused');
  assert.equal(Math.round(state.movingMs / 1000), 60);
  assert.equal(next.tracking, 0);
  await next.controller.resume();
  assert.equal(next.tracking, 1);
  next.north = w.north + 5000; // they are somewhere else now
  next.run(60, FAST);
  const id = await next.controller.finish();
  const stored = JSON.parse(next.files.get(id));
  assert.equal(stored.summary.durationSec, 120);
  near(stored.summary.distanceMi, 0.2, 0.01);
});

await test('discard removes the run and its checkpoint', async () => {
  const w = world();
  await w.controller.begin(config(), { pace: false, hr: false });
  w.run(30, FAST);
  await w.controller.discard();
  assert.equal(w.controller.getState(), null);
  assert.equal(w.checkpointFile, null);
  assert.equal(w.files.size, 0);
  assert.equal(w.stops, 1);
});

await test('muting mid-run reaches the engine; a cue that fails to play does not stop the run', async () => {
  const w = world();
  w.deps.playCue = () => { throw new Error('speech unavailable'); };
  await w.controller.begin(config(), { pace: false, hr: false });
  w.controller.setMute({ pace: true, hr: true });
  assert.deepEqual(w.controller.getState().mute, { pace: true, hr: true });
  w.controller.setMute({ pace: false, hr: false });
  w.run(100, FAST);
  assert.equal(w.controller.getState().status, 'running');
});
done('run controller');
