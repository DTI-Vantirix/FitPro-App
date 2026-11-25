/** Finished runs waiting to reach the server — pure (storage and sending are passed in).
 *
 * A run is written to the phone before any upload is tried and is removed only once
 * the server has it (or the owner deletes their account). No reply from the server —
 * offline, signed out, an error, a rejection — ever deletes a run.
 */
import type { RunSummary } from './payload';

export type RunStatus = 'pending' | 'uploaded' | 'needs_attention' | 'local_only';
export type StoredRun = {
  summary: RunSummary;
  /** The ingestActivity body; null for a run too short for the server to accept. */
  payload: Record<string, unknown> | null;
  ownerId: string;
  status: RunStatus;
  attempts: number;
  lastError: string | null;
  serverRunId: string | null;
  savedAt: string;
};
export type RunStore = {
  list(): Promise<string[]>;
  read(id: string): Promise<StoredRun | null>;
  write(id: string, run: StoredRun): Promise<void>;
  remove(id: string): Promise<void>;
};
export type SendResult =
  | { kind: 'ok'; runId: string | null }
  /** Not saved, worth trying again later. `stop` ends the flush: the next run would fail the same way. */
  | { kind: 'retry'; error: string; stop: boolean }
  /** The server understood and refused. Sending the same thing again will fail again. */
  | { kind: 'rejected'; error: string };
export type FlushResult = { uploaded: number; pending: number; needsAttention: number };

export function newStoredRun(
  summary: RunSummary,
  payload: Record<string, unknown> | null,
  ownerId: string,
  savedAt: string,
): StoredRun {
  return { summary, payload, ownerId, status: payload ? 'pending' : 'local_only', attempts: 0, lastError: null, serverRunId: null, savedAt };
}

function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') return (body as { error: string }).error;
  return fallback;
}

/** Sorts a reply from ingestActivity. `status` is null when the request never got an answer. */
export function classifyResponse(status: number | null, body: unknown, error?: string): SendResult {
  if (status == null) return { kind: 'retry', error: error || 'No connection.', stop: true };
  if (status >= 200 && status < 300) {
    const data = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (data && data.ok === true && (data.action === 'created' || data.action === 'updated' || data.action === 'skipped')) {
      return { kind: 'ok', runId: typeof data.run_id === 'string' ? data.run_id : null };
    }
    return { kind: 'retry', error: 'The server reply was not understood.', stop: true };
  }
  const message = errorText(body, `The server answered ${status}.`);
  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) {
    return { kind: 'retry', error: message, stop: true };
  }
  return { kind: 'rejected', error: message };
}

function isStoredRun(value: unknown): value is StoredRun {
  const run = value as StoredRun | null;
  return !!run && typeof run === 'object' && !!run.summary && typeof run.summary.externalId === 'string'
    && typeof run.ownerId === 'string' && typeof run.status === 'string';
}

async function readAll(store: RunStore): Promise<StoredRun[]> {
  const runs: StoredRun[] = [];
  for (const id of await store.list()) {
    try {
      const run = await store.read(id);
      if (isStoredRun(run)) runs.push(run);
    } catch {
      // An unreadable file is left where it is; it is never deleted from here.
    }
  }
  return runs;
}

const byStart = (a: StoredRun, b: StoredRun) => a.summary.startedAt.localeCompare(b.summary.startedAt);

export async function enqueueRun(store: RunStore, run: StoredRun): Promise<void> {
  await store.write(run.summary.externalId, run);
}

export async function listRuns(store: RunStore, ownerId: string): Promise<StoredRun[]> {
  return (await readAll(store)).filter((run) => run.ownerId === ownerId).sort(byStart).reverse();
}

export async function countWaiting(store: RunStore, ownerId: string): Promise<{ pending: number; needsAttention: number }> {
  const runs = await listRuns(store, ownerId);
  return {
    pending: runs.filter((run) => run.status === 'pending').length,
    needsAttention: runs.filter((run) => run.status === 'needs_attention').length,
  };
}

const flushing = new WeakMap<RunStore, Promise<FlushResult>>();

/** Sends this account's pending runs, oldest first. Never throws. Concurrent calls share one pass. */
export function flushQueue(
  store: RunStore,
  ownerId: string,
  send: (payload: Record<string, unknown>) => Promise<SendResult>,
): Promise<FlushResult> {
  const running = flushing.get(store);
  if (running) return running;
  const pass = flushOnce(store, ownerId, send).finally(() => flushing.delete(store));
  flushing.set(store, pass);
  return pass;
}

async function flushOnce(
  store: RunStore,
  ownerId: string,
  send: (payload: Record<string, unknown>) => Promise<SendResult>,
): Promise<FlushResult> {
  let mine: StoredRun[] = [];
  try {
    mine = (await readAll(store)).filter((run) => run.ownerId === ownerId).sort(byStart);
  } catch {
    return { uploaded: 0, pending: 0, needsAttention: 0 };
  }
  let uploaded = 0;
  let stopped = false;
  for (const run of mine) {
    if (stopped || run.status !== 'pending' || !run.payload) continue;
    let result: SendResult;
    try {
      result = await send(run.payload);
    } catch (cause) {
      result = { kind: 'retry', error: cause instanceof Error ? cause.message : String(cause), stop: true };
    }
    const attempts = run.attempts + 1;
    const next: StoredRun = result.kind === 'ok'
      ? { ...run, status: 'uploaded', attempts, lastError: null, serverRunId: result.runId }
      : result.kind === 'rejected'
        ? { ...run, status: 'needs_attention', attempts, lastError: result.error }
        : { ...run, attempts, lastError: result.error };
    try {
      await store.write(run.summary.externalId, next);
      Object.assign(run, next);
      if (result.kind === 'ok') uploaded += 1;
    } catch {
      // The file still says "pending". It is sent again next time and the server
      // updates the same run, because external_id does not change.
    }
    if (result.kind === 'retry' && result.stop) stopped = true;
  }
  return {
    uploaded,
    pending: mine.filter((run) => run.status === 'pending').length,
    needsAttention: mine.filter((run) => run.status === 'needs_attention').length,
  };
}

/** Puts a flagged run back in line after the runner asks for another try. */
export async function retryRun(store: RunStore, id: string): Promise<void> {
  const run = await store.read(id);
  if (run && run.status === 'needs_attention' && run.payload) await store.write(id, { ...run, status: 'pending' });
}

/** Keeps the newest `keep` uploaded runs for the summary screen. Touches nothing the server lacks. */
export async function pruneUploaded(store: RunStore, keep: number): Promise<void> {
  const done = (await readAll(store)).filter((run) => run.status === 'uploaded').sort(byStart).reverse();
  for (const run of done.slice(Math.max(0, keep))) await store.remove(run.summary.externalId);
}

/** Account deletion: the owner asked for their data to go, including what is on this phone. */
export async function removeOwnerRuns(store: RunStore, ownerId: string): Promise<void> {
  for (const run of await readAll(store)) if (run.ownerId === ownerId) await store.remove(run.summary.externalId);
}
