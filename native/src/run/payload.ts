/** What a finished run amounts to, and the body sent to ingestActivity — pure.
 * The payload holds only fields documented in docs/native-contract.md for
 * `source: "fitpro"`. Server-computed values (average pace) are never sent.
 */
import { METERS_PER_MILE, thinPoints, type LatLng } from './geo';
import type { RunMode, RunState } from './engine';
import type { Split } from './tracker';
import { hrBounds } from './zones';

export const MAX_UPLOAD_POINTS = 5000;
/** Below this a run is kept on the device but not sent: the server requires a distance above zero. */
export const MIN_UPLOAD_MILES = 0.01;

export type RunSummary = {
  externalId: string;
  startedAt: string;
  mode: RunMode;
  routeId: string | null;
  routeName: string;
  distanceMi: number;
  durationSec: number;
  avgPaceSec: number | null;
  splits: Split[];
  hr: { min: number; max: number; avg: number } | null;
  hrDevice: string | null;
  /** Share of the time with a reading that was inside the zone; null when there was no reading. */
  paceInZonePct: number | null;
  hrInZonePct: number | null;
  zone: { name: string; fast_sec: number; slow_sec: number; hrMin: number | null; hrMax: number | null };
  points: LatLng[];
};

const pct = (inside: number, known: number) => (known > 0 ? Math.max(0, Math.min(100, Math.round((100 * inside) / known))) : null);

export function summarize(state: RunState): RunSummary {
  const { config, track, hr } = state;
  const distanceMi = Number((track.meters / METERS_PER_MILE).toFixed(3));
  const durationSec = Math.round(state.movingMs / 1000);
  const bounds = hrBounds(config.zone, config.hrMax);
  const points = thinPoints(track.points, MAX_UPLOAD_POINTS)
    .map((point) => ({ lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) }));
  return {
    externalId: config.externalId,
    startedAt: new Date(state.startedAt).toISOString(),
    mode: config.mode,
    routeId: config.route?.id ?? null,
    routeName: config.route?.name?.trim() || 'Free run',
    distanceMi,
    durationSec,
    avgPaceSec: distanceMi >= MIN_UPLOAD_MILES && durationSec > 0 ? Math.round(durationSec / distanceMi) : null,
    splits: track.splits.map((s) => ({ mile: s.mile, pace_sec: s.pace_sec })),
    hr: hr.count > 0 && hr.min != null && hr.max != null
      ? { min: hr.min, max: hr.max, avg: Math.round(hr.sum / hr.count) }
      : null,
    hrDevice: hr.count > 0 ? hr.device : null,
    paceInZonePct: pct(state.zoneSec.paceIn, state.zoneSec.paceKnown),
    hrInZonePct: pct(state.zoneSec.hrIn, state.zoneSec.hrKnown),
    zone: {
      name: config.zone.name,
      fast_sec: Math.round(config.zone.fast_sec),
      slow_sec: Math.round(config.zone.slow_sec),
      hrMin: bounds?.min ?? null,
      hrMax: bounds?.max ?? null,
    },
    points,
  };
}

const bpmOk = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n >= 20 && n <= 260;

/** The ingestActivity body, or null when the run is too short for the server to accept. */
export function buildRunPayload(summary: RunSummary): Record<string, unknown> | null {
  if (!(summary.distanceMi >= MIN_UPLOAD_MILES) || summary.distanceMi > 500) return null;
  if (!(summary.durationSec > 0) || summary.durationSec > 259200) return null;
  const { zone, hr } = summary;
  const targets = zone.fast_sec > 0 && zone.slow_sec >= zone.fast_sec;
  return {
    kind: 'run',
    source: 'fitpro',
    external_id: summary.externalId,
    distance_mi: summary.distanceMi,
    duration_sec: summary.durationSec,
    started_at: summary.startedAt,
    route_name: summary.routeName.slice(0, 120),
    ...(summary.points.length ? { points: summary.points.slice(0, MAX_UPLOAD_POINTS) } : {}),
    ...(summary.splits.length ? { splits: summary.splits.slice(0, 200) } : {}),
    ...(hr && bpmOk(hr.avg) ? { avg_hr: hr.avg } : {}),
    ...(hr && bpmOk(hr.max) ? { max_hr: hr.max } : {}),
    ...(hr && bpmOk(hr.min) ? { min_hr: hr.min } : {}),
    ...(hr && summary.hrDevice ? { hr_device: summary.hrDevice.slice(0, 80) } : {}),
    ...(summary.routeId ? { route_id: summary.routeId } : {}),
    ...(zone.name ? { target_zone_name: zone.name.slice(0, 80) } : {}),
    ...(targets ? { target_fast_sec: zone.fast_sec, target_slow_sec: zone.slow_sec } : {}),
    ...(summary.paceInZonePct != null ? { in_zone_pct: summary.paceInZonePct } : {}),
    ...(hr && summary.hrInZonePct != null ? { hr_in_zone_pct: summary.hrInZonePct } : {}),
    ...(bpmOk(zone.hrMin) && bpmOk(zone.hrMax) ? { hr_target_min: zone.hrMin, hr_target_max: zone.hrMax } : {}),
  };
}
