/** Drives one run: feeds the engine from the device and plays what it asks for.
 * Everything that touches the phone arrives through `RunDeps`, so this file has no
 * Expo imports and is exercised in the unit tests with fakes.
 */
import type { Cue } from './cues';
import { finishRun, onClock, onFix, onHeartRate, pauseRun, resumeRun, setMute, startRun, type Mute, type RunConfig, type RunState } from './engine';
import { buildRunPayload, summarize } from './payload';
import { enqueueRun, newStoredRun, type RunStore } from './queue';
import type { Fix } from './tracker';

export type RunDeps = {
  now(): number;
  /** Starts background-capable location updates. Rejects when permission is missing.
   * `stopTracking` must be safe to call when nothing is running. */
  startTracking(onFixReceived: (fix: Fix) => void): Promise<void>;
  stopTracking(): Promise<void>;
  /** Calls `tick` about once a second until the returned function is called. */
  startClock(tick: () => void): () => void;
  playCue(cue: Cue): void;
  store: RunStore;
  checkpoint: {
    /** One checkpoint per account (`state.config.ownerId`), so two people sharing a phone cannot overwrite each other. */
    save(state: RunState): Promise<void>;
    load(ownerId: string): Promise<RunState | null>;
    clear(ownerId: string): Promise<void>;
  };
  /** Asks for the upload queue to be flushed. Must not throw. */
  requestUpload(ownerId: string): void;
};

export const CHECKPOINT_EVERY_MS = 15000;

export type RunController = ReturnType<typeof createRunController>;

export function createRunController(deps: RunDeps) {
  let state: RunState | null = null;
  let stopClock: (() => void) | null = null;
  let tracking = false;
  let lastCheckpoint = 0;
  let finishing: Promise<string> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => { for (const listener of listeners) listener(); };
  const play = (cues: Cue[]) => { for (const cue of cues) { try { deps.playCue(cue); } catch { /* a cue that cannot play must not stop the run */ } } };

  function checkpoint(force: boolean) {
    if (!state) return;
    const now = deps.now();
    if (!force && now - lastCheckpoint < CHECKPOINT_EVERY_MS) return;
    lastCheckpoint = now;
    void deps.checkpoint.save(state).catch(() => { /* tried again on the next tick */ lastCheckpoint = 0; });
  }

  function tick() {
    if (!state || state.status === 'finished') return;
    const out = onClock(state, deps.now());
    state = out.state;
    play(out.cues);
    checkpoint(false);
    notify();
  }

  function handleFix(fix: Fix) {
    if (!state || state.status !== 'running') return;
    const out = onFix(state, fix);
    state = out.state;
    play(out.cues);
    tick();
  }

  async function ensureTracking() {
    if (!tracking) {
      await deps.startTracking(handleFix);
      tracking = true;
    }
    if (!stopClock) stopClock = deps.startClock(tick);
  }

  async function stopDevice() {
    stopClock?.();
    stopClock = null;
    // Always asked, even if this process never started it: after the app was closed mid-run the
    // operating system can still be running the location task from before.
    tracking = false;
    try { await deps.stopTracking(); } catch { /* nothing more to do */ }
  }

  /** Writes the finished run to the phone, then (and only then) drops the checkpoint. */
  async function store(finished: RunState): Promise<string> {
    const summary = summarize(finished);
    const stored = newStoredRun(summary, buildRunPayload(summary), finished.config.ownerId, new Date(deps.now()).toISOString());
    await enqueueRun(deps.store, stored);
    await deps.checkpoint.clear(finished.config.ownerId).catch(() => { /* a stale checkpoint is offered again; the run file is already safe */ });
    state = null;
    notify();
    deps.requestUpload(finished.config.ownerId);
    return summary.externalId;
  }

  return {
    getState: (): RunState | null => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async begin(config: RunConfig, mute: Mute): Promise<void> {
      if (state) throw new Error('A run is already in progress.');
      await ensureTracking();
      state = startRun(config, deps.now(), mute);
      checkpoint(true);
      notify();
    },

    /** Heart-rate samples come from the Bluetooth monitor, which outlives a single run. */
    heartRate(bpm: number, device?: string): void {
      if (!state) return;
      state = onHeartRate(state, bpm, deps.now(), device);
    },

    pause(): void {
      if (!state) return;
      state = pauseRun(state, deps.now());
      checkpoint(true);
      notify();
    },

    async resume(): Promise<void> {
      if (!state || state.status !== 'paused') return;
      await ensureTracking();
      state = resumeRun(state, deps.now());
      checkpoint(true);
      notify();
    },

    setMute(mute: Mute): void {
      if (!state) return;
      state = setMute(state, mute);
      notify();
    },

    /** Ends the run and saves it on the phone. Resolves with the run's id once the file is written. */
    finish(): Promise<string> {
      if (finishing) return finishing;
      if (!state) return Promise.reject(new Error('No run in progress.'));
      state = finishRun(state, deps.now());
      const finished = state;
      notify();
      finishing = (async () => {
        // Checkpoint first: if writing the run file fails, the finished run is still recoverable.
        await deps.checkpoint.save(finished).catch(() => {});
        await stopDevice();
        return store(finished);
      })().finally(() => { finishing = null; });
      return finishing;
    },

    async discard(): Promise<void> {
      const ownerId = state?.config.ownerId ?? null;
      await stopDevice();
      state = null;
      if (ownerId) await deps.checkpoint.clear(ownerId).catch(() => {});
      notify();
    },

    /** After the app was closed mid-run: brings the run back paused at the last moment it was
     * known to be running, or finishes saving one that had already been ended.
     * Returns what happened so the home screen can say so. */
    async recover(ownerId: string): Promise<'none' | 'paused' | 'saved'> {
      if (state) return 'none';
      let saved: RunState | null = null;
      try { saved = await deps.checkpoint.load(ownerId); } catch { return 'none'; }
      if (!saved || saved.config?.ownerId !== ownerId) return 'none';
      // Whatever happens next, the location task left over from the closed app is not feeding
      // anything: stop it. Resume starts a fresh one.
      await stopDevice();
      if (saved.status === 'finished') {
        await store(saved);
        return 'saved';
      }
      state = pauseRun(saved, saved.lastClock);
      notify();
      return 'paused';
    },
  };
}
