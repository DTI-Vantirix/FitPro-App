/** The one run controller for the app, wired to the phone. Screens use the hooks in
 * use-run.tsx; nothing else should import the device adapters directly.
 */
import { sendRun } from './api';
import { createRunController } from './controller';
import { clearCueNotifications, playCue, stopSpeaking } from './device/alerts';
import { createHeartRateMonitor } from './device/heart-rate';
import { startTracking, stopTracking } from './device/location';
import { runCheckpoint, runStore } from './device/run-files';
import { countWaiting, flushQueue, pruneUploaded, type FlushResult } from './queue';

/** Uploaded runs kept on the phone so their summaries can still be opened. */
const KEEP_UPLOADED = 20;

let auth: { token: string; ownerId: string } | null = null;
let waiting = { pending: 0, needsAttention: 0 };
const waitingListeners = new Set<() => void>();

function setWaiting(next: { pending: number; needsAttention: number }, changed = false) {
  if (!changed && next.pending === waiting.pending && next.needsAttention === waiting.needsAttention) return;
  // Always a new object: screens re-read the run files whenever this changes identity.
  waiting = { pending: next.pending, needsAttention: next.needsAttention };
  for (const listener of waitingListeners) listener();
}

export const getWaiting = () => waiting;
export function subscribeWaiting(listener: () => void): () => void {
  waitingListeners.add(listener);
  return () => { waitingListeners.delete(listener); };
}

/** Called whenever the signed-in account changes. Uploads only ever use the current sign-in. */
export function setRunAuth(next: { token: string; ownerId: string } | null): void {
  auth = next;
  if (!next) setWaiting({ pending: 0, needsAttention: 0 });
}

export async function refreshWaiting(): Promise<void> {
  if (!auth) return;
  try { setWaiting(await countWaiting(runStore, auth.ownerId)); } catch { /* storage unreadable: keep the last count */ }
}

/** Sends every run of this account that the server does not have yet. Never throws. */
export async function flushRuns(): Promise<FlushResult | null> {
  const current = auth;
  if (!current) return null;
  const result = await flushQueue(runStore, current.ownerId, (payload) => sendRun(current.token, payload));
  if (auth === current) setWaiting({ pending: result.pending, needsAttention: result.needsAttention }, result.uploaded > 0);
  if (result.uploaded) await pruneUploaded(runStore, KEEP_UPLOADED).catch(() => {});
  return result;
}

export const runController = createRunController({
  now: () => Date.now(),
  startTracking,
  async stopTracking() {
    stopSpeaking();
    await stopTracking();
    await clearCueNotifications();
  },
  startClock(tick) {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  },
  playCue,
  store: runStore,
  checkpoint: runCheckpoint,
  // Count the new run as waiting straight away, then try to send it.
  requestUpload: () => { void refreshWaiting().then(flushRuns); },
});

export const heartRateMonitor = createHeartRateMonitor((bpm, device) => runController.heartRate(bpm, device));
