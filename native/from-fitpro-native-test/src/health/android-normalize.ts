import type { NormalizedRun } from './types';

/** Pure, deterministic normalization; no native modules or network dependencies. */
export type AndroidExercise = Readonly<{
  startTime: string;
  endTime: string;
  exerciseType: number;
  title?: string;
  metadata?: { id?: string; dataOrigin?: string };
  exerciseRoute?: { type?: number; route?: ReadonlyArray<{ latitude: number; longitude: number }> };
}>;
export type AndroidDistance = Readonly<{
  startTime: string;
  endTime: string;
  distance: { inMeters: number };
  metadata?: { dataOrigin?: string };
}>;
export type AndroidHeartRate = Readonly<{
  startTime: string;
  endTime: string;
  samples: ReadonlyArray<{ time: string; beatsPerMinute: number }>;
  metadata?: { dataOrigin?: string };
}>;

const KM_TO_MILES = 1 / 1609.344;
export const RUNNING_TYPES = [56, 57] as const; // Health Connect RUNNING + RUNNING_TREADMILL

function timestamp(value: string): number {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}
function validInterval(start: string, end: string) {
  const from = timestamp(start);
  const to = timestamp(end);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

/**
 * Distance is a separate Health Connect record type. Prefer records from the
 * exercise's own writer. For a different writer, accept only ONE positive
 * distance record covering the complete workout (within 2 seconds) and only
 * when the adapter has established that no other exercise session overlaps.
 * This deliberately does not guess fractional contributions or merge sources.
 */
const CROSS_SOURCE_EDGE_TOLERANCE_MS = 2_000;
const SAME_SOURCE_EDGE_TOLERANCE_MS = 2_000;
// Toolbox may assign different seconds when the session and its distance are
// entered in separate forms. A consistent small clock shift is permitted ONLY
// for a unique, same-writer interval and a non-overlapping exercise session.
const SAME_SOURCE_SHIFT_TOLERANCE_MS = 15_000;
const SAME_SOURCE_SHIFT_DURATION_DRIFT_MS = 2_000;
const MIN_SHIFTED_SESSION_DURATION_MS = 60_000;

export type AndroidDistanceMatch = Readonly<{
  meters: number | null;
  kind: 'same_source' | 'same_source_minute' | 'cross_source_exact' | 'none';
  source?: string;
  reason?: string;
}>;

export function resolveAndroidDistance(
  session: AndroidExercise,
  distanceRecords: ReadonlyArray<AndroidDistance>,
  options: { allowCrossSource?: boolean; allowShiftedSameSource?: boolean; allowSameMinuteSource?: boolean } = {},
): AndroidDistanceMatch {
  const bounds = validInterval(session.startTime, session.endTime);
  if (!bounds) return { meters: null, kind: 'none', reason: 'invalid workout interval' };

  const origin = session.metadata?.dataOrigin;
  const candidates = distanceRecords.flatMap((record) => {
    const interval = validInterval(record.startTime, record.endTime);
    const meters = record.distance?.inMeters;
    if (!interval || !Number.isFinite(meters) || meters <= 0 || meters > 500 * 1609.344) return [];
    return [{ record, interval, meters }];
  });

  // Same-writer records may divide a run into distance intervals. Accept only
  // non-overlapping, fully contained intervals to prevent double counting.
  const same = origin ? candidates.filter((item) => item.record.metadata?.dataOrigin === origin
    && item.interval.from >= bounds.from && item.interval.to <= bounds.to)
    .sort((a, b) => a.interval.from - b.interval.from) : [];
  if (same.length) {
    if (same.some((item, i) => i > 0 && item.interval.from < same[i - 1].interval.to)) {
      return { meters: null, kind: 'none', reason: 'overlapping distance records from the workout source; refused to double count' };
    }
    const meters = same.reduce((sum, item) => sum + item.meters, 0);
    if (meters > 0 && meters <= 500 * 1609.344) return { meters, kind: 'same_source', source: origin };
    return { meters: null, kind: 'none', reason: 'invalid distance total from workout source' };
  }

  // If Toolbox rounded a session and its writer-owned distance slightly
  // differently, a single almost-identical record is still unambiguous.
  // Never accept a partial interval or sum multiple near-exact records here.
  const nearSame = origin ? candidates.filter((item) => item.record.metadata?.dataOrigin === origin
    && Math.abs(item.interval.from - bounds.from) <= SAME_SOURCE_EDGE_TOLERANCE_MS
    && Math.abs(item.interval.to - bounds.to) <= SAME_SOURCE_EDGE_TOLERANCE_MS) : [];
  if (nearSame.length > 1) return { meters: null, kind: 'none',
    reason: `${nearSame.length} near-exact records from workout source; refused an ambiguous match` };
  if (nearSame.length === 1) return { meters: nearSame[0].meters, kind: 'same_source', source: origin };

  // Health Connect Toolbox creates a separate session and distance. It may
  // silently preserve the seconds at which each form was opened. Match a
  // unique distance interval from the SAME writer if both start/end are shifted
  // consistently by up to 15 seconds, the duration is essentially identical,
  // and the adapter has confirmed no other exercise overlaps. The guard is
  // deliberately stricter than mere interval overlap.
  if (options.allowShiftedSameSource && origin
      && bounds.to - bounds.from >= MIN_SHIFTED_SESSION_DURATION_MS) {
    const shiftedSame = candidates.filter((item) => {
      if (item.record.metadata?.dataOrigin !== origin) return false;
      const startShift = item.interval.from - bounds.from;
      const endShift = item.interval.to - bounds.to;
      return Math.abs(startShift) <= SAME_SOURCE_SHIFT_TOLERANCE_MS
        && Math.abs(endShift) <= SAME_SOURCE_SHIFT_TOLERANCE_MS
        && Math.abs(startShift - endShift) <= SAME_SOURCE_SHIFT_DURATION_DRIFT_MS;
    });
    if (shiftedSame.length > 1) return { meters: null, kind: 'none',
      reason: `${shiftedSame.length} shifted same-source distance records; ambiguous association refused` };
    if (shiftedSame.length === 1) return { meters: shiftedSame[0].meters, kind: 'same_source', source: origin };
  }

  // DEV / TEST ONLY: Health Connect Toolbox can use different seconds in
  // its independently entered session and distance records. Accept exactly
  // ONE positive same-writer distance record whose start AND end fall in the
  // same calendar minutes as the exercise, ignoring seconds and milliseconds.
  // Never borrow a different writer's distance or guess among multiple records.
  // The adapter opts in only in __DEV__ and only if sessions do not overlap.
  if (options.allowSameMinuteSource && origin && bounds.to - bounds.from >= 60_000) {
    const minute = (milliseconds: number) => Math.floor(milliseconds / 60_000);
    const matches = candidates.filter((item) => item.record.metadata?.dataOrigin === origin
      && minute(item.interval.from) === minute(bounds.from)
      && minute(item.interval.to) === minute(bounds.to));
    if (matches.length > 1) return { meters: null, kind: 'none',
      reason: `${matches.length} same-minute distance records from workout source; ambiguous match refused` };
    if (matches.length === 1) return { meters: matches[0].meters, kind: 'same_source_minute', source: origin };
  }

  // A cross-writer association is test-friendly but must be exact and
  // unambiguous; we must never borrow walking distance or sum two devices.
  const exact = candidates.filter((item) => item.record.metadata?.dataOrigin
    && item.record.metadata.dataOrigin !== origin
    && Math.abs(item.interval.from - bounds.from) <= CROSS_SOURCE_EDGE_TOLERANCE_MS
    && Math.abs(item.interval.to - bounds.to) <= CROSS_SOURCE_EDGE_TOLERANCE_MS);
  if (exact.length) {
    if (!options.allowCrossSource) {
      return { meters: null, kind: 'none', reason: 'cross-source distance found, but another exercise session overlaps; association is ambiguous' };
    }
    if (exact.length !== 1) {
      return { meters: null, kind: 'none', reason: `${exact.length} exact-interval distance records from other sources; refusing an ambiguous match` };
    }
    return { meters: exact[0].meters, kind: 'cross_source_exact', source: exact[0].record.metadata?.dataOrigin };
  }

  return { meters: null, kind: 'none', reason: distanceRecords.length === 0
    ? 'Health Connect returned zero distance records for the workout interval; check Distance data and permissions'
    : `${distanceRecords.length} distance record(s) found without a safe match (developer-only same-minute matching attempted; ±2s exact; ±15s same-source shifted, if unique). ${describeDistanceCandidates(session, distanceRecords)}` };
}

/** Foreground display-only troubleshooting. Only app origin and relative time
 * deltas are shown; never logs or sends full Health Connect records. */
export function describeDistanceCandidates(
  session: AndroidExercise,
  records: ReadonlyArray<AndroidDistance>,
): string {
  const bounds = validInterval(session.startTime, session.endTime);
  if (!bounds) return 'Session timestamps invalid';
  const origin = session.metadata?.dataOrigin || 'unknown';
  const candidates = records.flatMap((record) => {
    const interval = validInterval(record.startTime, record.endTime);
    if (!interval) return [];
    const deltaStart = (interval.from - bounds.from) / 1000;
    const deltaEnd = (interval.to - bounds.to) / 1000;
    return [{ record, deltaStart, deltaEnd, score: Math.abs(deltaStart) + Math.abs(deltaEnd) }];
  }).sort((a, b) => a.score - b.score).slice(0, 2);
  if (!candidates.length) return `session source=${origin}; distance intervals invalid`;
  return `session source=${origin}; nearest: ` + candidates.map((item) => {
    const meters = item.record.distance?.inMeters;
    const distance = Number.isFinite(meters) ? `${Math.round(meters)}m` : 'invalid distance';
    return `source=${item.record.metadata?.dataOrigin || 'unknown'}, `
      + `start difference=${item.deltaStart.toFixed(1)}s, end difference=${item.deltaEnd.toFixed(1)}s, ${distance}`;
  }).join(' | ');
}

export function normalizeAndroidRun(
  session: AndroidExercise,
  distanceRecords: ReadonlyArray<AndroidDistance>,
  heartRateRecords: ReadonlyArray<AndroidHeartRate> = [],
  options: { allowCrossSource?: boolean; allowShiftedSameSource?: boolean; allowSameMinuteSource?: boolean } = {},
): { run: NormalizedRun | null; reasons: string[] } {
  const reasons: string[] = [];
  if (!RUNNING_TYPES.includes(session.exerciseType as 56 | 57)) return { run: null, reasons: ['not a running session'] };
  const bounds = validInterval(session.startTime, session.endTime);
  if (!bounds) reasons.push('invalid start/end time');
  const stableId = session.metadata?.id?.trim();
  if (!stableId) reasons.push('stable Health Connect record ID missing');
  const durationSec = bounds ? (bounds.to - bounds.from) / 1000 : NaN;
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 259200) reasons.push('invalid duration');
  const origin = session.metadata?.dataOrigin;
  const match = resolveAndroidDistance(session, distanceRecords, options);
  const miles = match.meters === null ? NaN : match.meters * KM_TO_MILES;
  if (!Number.isFinite(miles) || miles <= 0 || miles > 500) {
    reasons.push(match.reason ?? 'invalid distance total');
  }
  if (reasons.length || !stableId || !bounds) return { run: null, reasons };

  const run: NormalizedRun = {
    kind: 'run',
    source: 'health_connect',
    externalId: stableId,
    startedAt: new Date(bounds.from).toISOString(),
    routeName: session.title?.trim() || (session.exerciseType === 57 ? 'Health Connect treadmill run' : 'Health Connect run'),
    durationSec,
    distanceMi: miles,
  };
  // Only apply samples whose timestamp lies inside the exercise. A heart rate
  // sample is optional; no beats or inferred devices are manufactured.
  const bpm: number[] = [];
  for (const record of heartRateRecords) {
    if (origin && record.metadata?.dataOrigin !== origin) continue;
    for (const sample of record.samples || []) {
      const at = timestamp(sample.time);
      const rate = sample.beatsPerMinute;
      if (at >= bounds.from && at <= bounds.to && Number.isFinite(rate) && rate >= 20 && rate <= 300) bpm.push(rate);
    }
  }
  if (bpm.length) {
    run.avgHr = Math.round(bpm.reduce((sum, rate) => sum + rate, 0) / bpm.length);
    run.maxHr = Math.round(Math.max(...bpm));
  }
  // Only use routes that the operating system already made available.
  // No per-route consent dialog is requested during a background/automatic read.
  if (session.exerciseRoute?.type === 0 && session.exerciseRoute.route?.length) {
    run.points = sanitizeAndroidRoute(session.exerciseRoute.route);
  }
  return { run, reasons: [] };
}

/** Limit route point volume to FitPro's 5,000-point ingestion contract. */
export function sanitizeAndroidRoute(points: ReadonlyArray<{ latitude: number; longitude: number }>, limit = 5000): NonNullable<NormalizedRun['points']> {
  const good = points.filter((p) => Number.isFinite(p.latitude) && p.latitude >= -90 && p.latitude <= 90
    && Number.isFinite(p.longitude) && p.longitude >= -180 && p.longitude <= 180);
  if (!good.length) return [];
  const count = Math.min(good.length, limit);
  if (count === 1) return [{ lat: good[0].latitude, lng: good[0].longitude }];
  return Array.from({ length: count }, (_, index) => {
    const p = good[Math.round(index * (good.length - 1) / (count - 1))];
    return { lat: p.latitude, lng: p.longitude };
  });
}
