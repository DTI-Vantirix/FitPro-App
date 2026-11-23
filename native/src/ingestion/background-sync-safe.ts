/** Step 7B.2C — bounded background RUN import policy.
 * Android permits a guarded SAME-CLOCK-MINUTE match on both interval boundaries
 * for records from the exact same Health Connect writer. It rejects ambiguous
 * distances, concurrent exercises, cross-source pairing and partial intervals.
 * Minute matching is a controlled pilot compromise, NOT proof of attribution.
 * No GPS route or heart-rate fields are synthesized in this background pilot.
 */
import type { NormalizedRun } from '../health/types';
import { activitySyncKey, buildActivityPayload } from './activity-sync';
import { activityMark } from './auto-sync-state';

export const BACKGROUND_PILOT_BATCH = 1;
export const BACKGROUND_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export type BackgroundProvider = 'apple' | 'health_connect';
export type BackgroundSession = Readonly<{
  startTime: string; endTime: string; exerciseType: number; title?: string;
  metadata?: { id?: string; dataOrigin?: string };
}>;
export type BackgroundDistance = Readonly<{
  startTime: string; endTime: string; distance: { inMeters: number };
  metadata?: { dataOrigin?: string };
}>;

const isRun = (value: number) => value === 56 || value === 57;
const validMs = (value: string): number => Date.parse(value);
const minute = (ms: number): number => Math.floor(ms / 60_000);

/** Allow start/end times in the same clock minute, independently; seconds and
 * milliseconds may differ. Never use a rolling +/-60-second match that could
 * drift into another minute. Require one same-writer full-interval candidate,
 * and reject duplicate, competing or overlapping records/sessions.
 */
export function strictAndroidBackgroundRun(
  session: BackgroundSession,
  distanceRecords: ReadonlyArray<BackgroundDistance>,
  sessionInventory: ReadonlyArray<BackgroundSession>,
): NormalizedRun | null {
  const start = validMs(session.startTime), end = validMs(session.endTime);
  const id = session.metadata?.id?.trim();
  const writer = session.metadata?.dataOrigin?.trim();
  if (!isRun(session.exerciseType) || !id || !writer || id.length > 200 ||
      !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 259200000) return null;
  // Other concurrent exercises (of ANY type/source) make attribution ambiguous.
  // Also reject distinct sessions that share the two same-minute buckets:
  // minute-aligned distance could be incorrectly paired with either session.
  if (sessionInventory.some((other) => other !== session &&
      Number.isFinite(validMs(other.startTime)) && Number.isFinite(validMs(other.endTime)) &&
      ((validMs(other.startTime) < end && validMs(other.endTime) > start) ||
       (minute(validMs(other.startTime)) === minute(start) &&
        minute(validMs(other.endTime)) === minute(end))))) return null;
  const matches = distanceRecords.filter((record) => {
    const dStart = validMs(record.startTime), dEnd = validMs(record.endTime);
    return record.metadata?.dataOrigin === writer &&
      Number.isFinite(dStart) && Number.isFinite(dEnd) && dEnd > dStart &&
      minute(dStart) === minute(start) && minute(dEnd) === minute(end) &&
      dStart < end && dEnd > start &&
      // Reject near-zero length partial records spuriously sharing a minute.
      Math.min(end, dEnd) - Math.max(start, dStart) >= (end - start) / 2 &&
      Number.isFinite(record.distance?.inMeters) && record.distance.inMeters > 0 &&
      record.distance.inMeters <= 500 * 1609.344;
  });
  // No second same-writer distance may overlap the actual session or the
  // selected distance, even if it is too partial to qualify as a match.
  if (matches.length !== 1 || distanceRecords.some((r) => {
      if (r === matches[0] || r.metadata?.dataOrigin !== writer) return false;
      const rStart = validMs(r.startTime), rEnd = validMs(r.endTime);
      if (!Number.isFinite(rStart) || !Number.isFinite(rEnd)) return true;
      const chosenStart = validMs(matches[0].startTime), chosenEnd = validMs(matches[0].endTime);
      return rStart < end && rEnd > start || rStart < chosenEnd && rEnd > chosenStart;
    })) return null;
  const run: NormalizedRun = {
    kind: 'run', source: 'health_connect', externalId: id,
    startedAt: new Date(start).toISOString(), durationSec: (end - start) / 1000,
    distanceMi: matches[0].distance.inMeters / 1609.344,
    routeName: session.title?.trim().slice(0, 120) || (session.exerciseType === 57
      ? 'Health Connect treadmill run' : 'Health Connect run'),
  };
  try { buildActivityPayload(run); return run; } catch { return null; }
}

export type SucceededReceipt = Readonly<{ activityKey: string; outcome: string }>;
/** Select a single recent NEW run after the independent background opt-in.
 * Local fingerprints reduce redundant upserts; the backend's (source, external_id)
 * idempotency remains authoritative. Never uses foreground opt-in as authorization.
 */
export function selectSafeBackgroundPilot(
  activities: ReadonlyArray<NormalizedRun>, provider: BackgroundProvider, enabledAt: string,
  backgroundMarks: ReadonlyArray<string>, manualReceipts: ReadonlyArray<SucceededReceipt>,
  foregroundMarks: ReadonlyArray<string>, nowMs = Date.now(),
): NormalizedRun[] {
  const enabledMs = Date.parse(enabledAt);
  if (!Number.isFinite(enabledMs)) return [];
  const successes = new Set(manualReceipts.filter((r) => r.outcome === 'created' || r.outcome === 'updated')
    .map((r) => r.activityKey));
  const marks = new Set([...backgroundMarks, ...foregroundMarks]);
  const seen = new Set<string>();
  const eligible: Array<{ item: NormalizedRun; end: number }> = [];
  for (const item of activities) {
    if (item.kind !== 'run' || item.source !== provider) continue;
    const key = activitySyncKey(item);
    if (seen.has(key) || successes.has(key) || marks.has(activityMark(key))) continue;
    seen.add(key);
    const start = Date.parse(item.startedAt);
    const end = start + item.durationSec * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < enabledMs || end > nowMs ||
      end < nowMs - BACKGROUND_LOOKBACK_MS) continue;
    try { buildActivityPayload(item); } catch { continue; }
    eligible.push({ item, end });
  }
  eligible.sort((a, b) => a.end - b.end);
  return eligible.slice(0, BACKGROUND_PILOT_BATCH).map(({ item }) => item);
}
