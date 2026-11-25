/** Step 6: the ONLY health-data write path is the existing ingestActivity function.
 * This module is never called automatically on app startup, provider reads, or timer events.
 */
import { INGEST_URL } from '../config';
import type { NormalizedActivity } from '../health/types';

/** `skipped`: the server already has this run as one FitPro recorded itself; nothing was written. */
export type IngestOutcome = 'created' | 'updated' | 'skipped';
export type SyncSource = 'apple' | 'health_connect';
export type SyncPayload = Readonly<Record<string, unknown>>;

export function activitySyncKey(item: NormalizedActivity): string {
  return `${item.source}:${item.externalId}`;
}

function validDate(value: string, name: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${name} is not a valid date.`);
  return new Date(ms).toISOString();
}

function finiteInRange(value: number, low: number, high: number, name: string): number {
  if (!Number.isFinite(value) || value <= low || value > high) {
    throw new Error(`${name} must be greater than ${low} and at most ${high}.`);
  }
  return value;
}

/** Exact shape expected by docs/native-contract.md. No synthetic values, admin credentials,
 * or server-computed fields. Reject fake/manual activities before making a network request.
 */
export function buildActivityPayload(item: NormalizedActivity): SyncPayload {
  if (item.source !== 'apple' && item.source !== 'health_connect') {
    throw new Error('Offline demo/manual activities cannot be uploaded from the health import screen.');
  }
  const externalId = item.externalId?.trim();
  if (!externalId || externalId.length > 200) throw new Error('Stable external activity ID is missing or too long.');

  const base = { kind: item.kind, source: item.source, external_id: externalId };
  if (item.kind === 'run') {
    const distance = finiteInRange(item.distanceMi, 0, 500, 'Run distance');
    const duration = finiteInRange(item.durationSec, 0, 259200, 'Run duration');
    const points = item.points?.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180).slice(0, 5000);
    const splits = item.splits?.filter((s) => Number.isFinite(s.mile) && s.mile > 0
      && Number.isFinite(s.paceSec) && s.paceSec > 0).slice(0, 200)
      .map((s) => ({ mile: s.mile, pace_sec: s.paceSec }));
    return {
      ...base,
      distance_mi: distance,
      duration_sec: duration,
      started_at: validDate(item.startedAt, 'Run start'),
      route_name: (item.routeName?.trim() || 'Imported run').slice(0, 120),
      ...(points?.length ? { points } : {}),
      ...(splits?.length ? { splits } : {}),
      ...(Number.isFinite(item.avgHr) && item.avgHr! > 0 && item.avgHr! <= 300 ? { avg_hr: item.avgHr } : {}),
      ...(Number.isFinite(item.maxHr) && item.maxHr! > 0 && item.maxHr! <= 300 ? { max_hr: item.maxHr } : {}),
      ...(item.hrDevice ? { hr_device: item.hrDevice.slice(0, 80) } : {}),
      ...(item.notes ? { notes: item.notes.slice(0, 2000) } : {}),
    };
  }

  const exercises = item.exercises.slice(0, 60).flatMap((ex) => {
    const name = ex.name?.trim().slice(0, 80);
    if (!name) return [];
    const sets = ex.sets.filter((set) => Number.isFinite(set.reps) && set.reps > 0 && set.reps <= 1000
      && Number.isFinite(set.weight) && set.weight >= 0 && set.weight <= 2000).slice(0, 40);
    if (!sets.length) return [];
    return [{ name, ...(ex.muscle?.trim() ? { muscle: ex.muscle.trim().slice(0, 40) } : {}), sets }];
  });
  if (!exercises.length) throw new Error('Workout has no valid exercise sets. No strength details will be invented.');
  if (item.durationMin !== undefined) finiteInRange(item.durationMin, 0, 720, 'Workout duration');
  return {
    ...base,
    name: (item.name?.trim() || 'Imported workout').slice(0, 120),
    performed_at: validDate(item.performedAt, 'Workout date'),
    ...(item.durationMin === undefined ? {} : { duration_min: item.durationMin }),
    exercises,
    ...(item.notes ? { notes: item.notes.slice(0, 2000) } : {}),
  };
}

export class ActivitySyncError extends Error {
  constructor(message: string, readonly httpStatus: number | null = null) {
    super(message);
    this.name = 'ActivitySyncError';
  }
}

/** Called only from an explicit on-screen tap. The Bearer token is the existing
 * authenticated FitPro app-user token, never a builder/admin token.
 */
export async function submitHealthActivity(
  item: NormalizedActivity,
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ action: IngestOutcome; recordId: string | null }> {
  if (!accessToken) throw new ActivitySyncError('Sign in before importing a health activity.');
  const payload = buildActivityPayload(item);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      // Server or gateway might return non-JSON, handled as failure below.
    }
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : `HTTP ${response.status}: ${raw.slice(0, 200)}`;
      throw new ActivitySyncError(message, response.status);
    }
    if (data.ok === true && data.action === 'skipped' && data.kind === item.kind) {
      // docs/native-contract.md: treat `skipped` as success; do not retry it or show it as an error.
      return { action: 'skipped', recordId: typeof data.run_id === 'string' ? data.run_id : null };
    }
    if (data.ok !== true || (data.action !== 'created' && data.action !== 'updated') || data.kind !== item.kind) {
      throw new ActivitySyncError('Unexpected ingestion response; verify the record in FitPro before retrying.', response.status);
    }
    const recordId = item.kind === 'run' ? data.run_id : data.workout_id;
    return { action: data.action, recordId: typeof recordId === 'string' ? recordId : null };
  } catch (error) {
    if (error instanceof ActivitySyncError) throw error;
    if (controller.signal.aborted) {
      throw new ActivitySyncError(signal?.aborted ? 'Import cancelled.' : 'Import timed out. Check the server before retrying.');
    }
    throw new ActivitySyncError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
