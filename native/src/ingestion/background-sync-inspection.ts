/** FitPro Android Step 7B.2C: foreground-only, read-only pilot matching inspection.
 * Never calls ingestActivity, never writes Health Connect, never stores raw
 * activity IDs, never changes the uploader, and never logs raw health records.
 * Only launched by an explicit user tap while app is in foreground.
 */
import { Platform } from 'react-native';
import { strictAndroidBackgroundRun, type BackgroundSession, type BackgroundDistance } from './background-sync-safe';

export type InspectionReason =
  | 'MATCH_OK' | 'ENDS_BEFORE_OPT_IN' | 'NOT_FINISHED' | 'INVALID_INTERVAL'
  | 'MISSING_RECORD_ID' | 'MISSING_DATA_ORIGIN' | 'OVERLAPPING_SESSION'
  | 'NO_DISTANCE' | 'DIFFERENT_DATA_ORIGIN' | 'START_OR_END_MINUTE_MISMATCH'
  | 'MULTIPLE_DISTANCE_CANDIDATES' | 'PARTIAL_OR_INVALID_DISTANCE' | 'UNSAFE_PAIRING';
export type InspectedRun = Readonly<{
  startUtc: string; endUtc: string; durationSeconds: number;
  recordsFound: number; sameWriterRecords: number; sameMinutePairRecords: number;
  reason: InspectionReason;
}>;
export type PilotInspection = Readonly<{
  inspectedAtUtc: string; enabledAtUtc: string;
  totalSessions: number; runningSessions: number; recentRuns: ReadonlyArray<InspectedRun>;
  truncated: boolean;
}>;

const minute = (n: number): number => Math.floor(n / 60_000);
const safeDate = (value: string): string => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : 'Invalid timestamp';

/** This test reproduces the current upload matching function but never uploads. */
export async function inspectAndroidBackgroundSync(enabledAt: string): Promise<PilotInspection> {
  if (Platform.OS !== 'android') throw new Error('Android Health Connect inspection only.');
  const enabledMs = Date.parse(enabledAt);
  if (!Number.isFinite(enabledMs)) throw new Error('Background opt-in timestamp invalid.');
  const hc = await import('react-native-health-connect');
  if (await hc.getSdkStatus() !== hc.SdkAvailabilityStatus.SDK_AVAILABLE || !(await hc.initialize()))
    throw new Error('Health Connect is unavailable.');
  const granted = await hc.getGrantedPermissions();
  for (const recordType of ['ExerciseSession','Distance'] as const) {
    if (!granted.some((p) => p.accessType === 'read' && p.recordType === recordType))
      throw new Error(`Health Connect foreground ${recordType} read permission missing.`);
  }
  const now = Date.now();
  const since = new Date(Math.max(now - 24 * 60 * 60 * 1000, enabledMs - 24 * 60 * 60 * 1000)).toISOString();
  const timeRangeFilter = { operator: 'between' as const, startTime: since, endTime: new Date(now).toISOString() };
  const response = await hc.readRecords('ExerciseSession', { timeRangeFilter, ascendingOrder: false, pageSize: 100 });
  if (response.pageToken) throw new Error('More than 100 sessions found; inspection cannot safely identify overlaps.');
  const allSessions: BackgroundSession[] = response.records.map((r) => ({
    startTime: r.startTime, endTime: r.endTime, exerciseType: r.exerciseType,
    title: r.title, metadata: { id: r.metadata?.id, dataOrigin: r.metadata?.dataOrigin },
  }));
  const running = allSessions.filter((r) => r.exerciseType === 56 || r.exerciseType === 57)
    .sort((a, b) => Date.parse(b.endTime) - Date.parse(a.endTime));
  const recentRuns: InspectedRun[] = [];
  for (const s of running.slice(0, 5)) {
    const start = Date.parse(s.startTime), end = Date.parse(s.endTime);
    let reason: InspectionReason = 'UNSAFE_PAIRING';
    let recordsFound = 0, sameWriterRecords = 0, sameMinutePairRecords = 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 259200000) reason = 'INVALID_INTERVAL';
    else if (end < enabledMs) reason = 'ENDS_BEFORE_OPT_IN';
    else if (end > now) reason = 'NOT_FINISHED';
    else if (!s.metadata?.id?.trim()) reason = 'MISSING_RECORD_ID';
    else if (!s.metadata?.dataOrigin?.trim()) reason = 'MISSING_DATA_ORIGIN';
    else {
      const writer = s.metadata.dataOrigin;
      const overlap = allSessions.some((other) => other !== s &&
        Number.isFinite(Date.parse(other.startTime)) && Number.isFinite(Date.parse(other.endTime)) &&
        ((Date.parse(other.startTime) < end && Date.parse(other.endTime) > start) ||
         (minute(Date.parse(other.startTime)) === minute(start) && minute(Date.parse(other.endTime)) === minute(end))));
      const queryStart = new Date(minute(start) * 60_000).toISOString();
      const queryEnd = new Date((minute(end) + 1) * 60_000).toISOString();
      const dr = await hc.readRecords('Distance', {
        timeRangeFilter: { operator: 'between' as const, startTime: queryStart, endTime: queryEnd }, pageSize: 100,
      });
      if (dr.pageToken) throw new Error('Distance query contains more than 100 records; unable to inspect safely.');
      const distances: BackgroundDistance[] = dr.records.map((r) => ({
        startTime: r.startTime, endTime: r.endTime, distance: { inMeters: r.distance.inMeters },
        metadata: { dataOrigin: r.metadata?.dataOrigin },
      }));
      recordsFound = distances.length;
      const same = distances.filter((r) => r.metadata?.dataOrigin === writer);
      sameWriterRecords = same.length;
      sameMinutePairRecords = same.filter((r) => minute(Date.parse(r.startTime)) === minute(start) &&
        minute(Date.parse(r.endTime)) === minute(end)).length;
      if (strictAndroidBackgroundRun(s, distances, allSessions)) reason = 'MATCH_OK';
      else if (overlap) reason = 'OVERLAPPING_SESSION';
      else if (!recordsFound) reason = 'NO_DISTANCE';
      else if (!sameWriterRecords) reason = 'DIFFERENT_DATA_ORIGIN';
      else if (!sameMinutePairRecords) reason = 'START_OR_END_MINUTE_MISMATCH';
      else if (sameMinutePairRecords > 1) reason = 'MULTIPLE_DISTANCE_CANDIDATES';
      else if (same.some((r) => r.distance.inMeters <= 0 || !Number.isFinite(r.distance.inMeters))) reason = 'PARTIAL_OR_INVALID_DISTANCE';
      // Otherwise strictAndroidBackgroundRun's overlap/partial/extra-record safety
      // guards rejected the run: keep the reason generic rather than accepting it.
    }
    recentRuns.push({ startUtc: safeDate(s.startTime), endUtc: safeDate(s.endTime),
      durationSeconds: Number.isFinite(end - start) ? Math.round((end - start) / 1000) : -1,
      recordsFound, sameWriterRecords, sameMinutePairRecords, reason });
  }
  return { inspectedAtUtc: new Date(now).toISOString(), enabledAtUtc: new Date(enabledMs).toISOString(),
    totalSessions: allSessions.length, runningSessions: running.length, recentRuns, truncated: running.length > 5 };
}
