/** Turns raw GPS fixes into a track: distance, mile splits and live pace — pure.
 * GPS is noisy: a phone standing still reports positions a few metres apart, and a
 * phone leaving a tunnel can report one far away. Neither may count as running.
 */
import { METERS_PER_MILE, metersBetween, validLatLng } from './geo';

/** `speed` is the phone's own estimate in metres per second, when it gives one. */
export type Fix = { lat: number; lng: number; t: number; accuracy: number | null; speed?: number | null };
/** An accepted fix. `m` is metres run up to it; `seg` marks the first point after a pause. */
export type TrackPoint = { lat: number; lng: number; t: number; m: number; seg?: true };
export type Split = { mile: number; pace_sec: number };
export type Track = {
  points: TrackPoint[];
  meters: number;
  /** Last accepted fix; null at the start and straight after a pause. */
  last: { lat: number; lng: number; t: number } | null;
  splits: Split[];
  splitStartMovingSec: number;
};

export const MAX_ACCURACY_M = 35;
export const MAX_SPEED_MPS = 12;
export const MIN_STEP_M = 3;
/** A step must also be at least as long as the fix's reported accuracy (up to this cap):
 * inside that radius a new position is as likely to be noise as movement. */
export const MAX_STEP_GATE_M = 20;
/** Below this the phone itself is saying it is not moving. */
export const STATIONARY_MPS = 0.3;
export const PACE_WINDOW_MS = 30000;
const PACE_MIN_SPAN_MS = 10000;
const PACE_MIN_METERS = 15;
const PACE_STALE_MS = 8000;

export function emptyTrack(): Track {
  return { points: [], meters: 0, last: null, splits: [], splitStartMovingSec: 0 };
}

/** Called when the run is paused: the next fix starts a new segment and adds no distance. */
export function breakTrack(track: Track): Track {
  return { ...track, last: null };
}

/** `movingSec` is the run's unpaused duration at this fix, used to time mile splits. */
export function addFix(track: Track, fix: Fix, movingSec: number): Track {
  if (!validLatLng(fix) || !Number.isFinite(fix.t)) return track;
  if (fix.accuracy != null && (!Number.isFinite(fix.accuracy) || fix.accuracy > MAX_ACCURACY_M)) return track;
  const here = { lat: fix.lat, lng: fix.lng, t: fix.t };
  if (!track.last) {
    const point: TrackPoint = { ...here, m: track.meters, ...(track.points.length ? { seg: true as const } : {}) };
    return { ...track, last: here, points: [...track.points, point] };
  }
  const dt = (fix.t - track.last.t) / 1000;
  if (dt <= 0) return track;
  const step = metersBetween(track.last, here);
  if (step / dt > MAX_SPEED_MPS) return track;
  if (fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0 && fix.speed < STATIONARY_MPS) return track;
  // Distance is measured from the last accepted fix, so nothing is lost by waiting for a clear step.
  if (step < Math.max(MIN_STEP_M, Math.min(MAX_STEP_GATE_M, fix.accuracy ?? 0))) return track;

  const meters = track.meters + step;
  const splits = [...track.splits];
  let splitStart = track.splitStartMovingSec;
  while (meters >= (splits.length + 1) * METERS_PER_MILE) {
    splits.push({ mile: splits.length + 1, pace_sec: Math.max(1, Math.round(movingSec - splitStart)) });
    splitStart = movingSec;
  }
  return {
    points: [...track.points, { ...here, m: meters }],
    meters,
    last: here,
    splits,
    splitStartMovingSec: splitStart,
  };
}

/** Pace in seconds per mile over the last 30 s of the current segment, or null when
 * there is not enough recent movement to say (just started, just resumed, standing still).
 */
export function rollingPaceSec(points: TrackPoint[], nowMs: number): number | null {
  if (points.length < 2) return null;
  const newest = points[points.length - 1];
  if (nowMs - newest.t > PACE_STALE_MS) return null;
  let first = points.length - 1;
  while (first > 0 && !points[first].seg && points[first - 1].t >= nowMs - PACE_WINDOW_MS) first -= 1;
  const oldest = points[first];
  const span = newest.t - oldest.t;
  const meters = newest.m - oldest.m;
  if (span < PACE_MIN_SPAN_MS || meters < PACE_MIN_METERS) return null;
  return span / 1000 / (meters / METERS_PER_MILE);
}
