import type { NormalizedRun } from './types';

/** Pure functions, shared by production HealthKit adapter and offline tests. */
export function toMiles(quantity: number, unit: string): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const factors: Record<string, number> = {
    m: 1 / 1609.344, meter: 1 / 1609.344, meters: 1 / 1609.344, metre: 1 / 1609.344, metres: 1 / 1609.344,
    km: 1000 / 1609.344, kilometer: 1000 / 1609.344, kilometers: 1000 / 1609.344,
    mi: 1, mile: 1, miles: 1,
    yd: 1 / 1760, yard: 1 / 1760, yards: 1 / 1760,
    ft: 1 / 5280, foot: 1 / 5280, feet: 1 / 5280,
  };
  const factor = factors[unit.trim().toLowerCase()];
  const miles = factor == null ? NaN : quantity * factor;
  return Number.isFinite(miles) && miles > 0 && miles <= 500 ? miles : null;
}

export function toSeconds(quantity: number, unit: string): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const factors: Record<string, number> = {
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
    min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  };
  const factor = factors[unit.trim().toLowerCase()];
  const seconds = factor == null ? NaN : quantity * factor;
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 259200 ? seconds : null;
}

/** Primary HKWorkout.totalDistance can be nil even when workout statistics carry distance. */
export type HealthQuantity = Readonly<{ quantity: number; unit: string }>;

export function resolveWorkoutDistance(
  totalDistance: HealthQuantity | null | undefined,
  distanceStatistic: HealthQuantity | null | undefined,
): number | null {
  const primary = totalDistance ? toMiles(totalDistance.quantity, totalDistance.unit) : null;
  return primary ?? (distanceStatistic ? toMiles(distanceStatistic.quantity, distanceStatistic.unit) : null);
}

/** Elapsed start/end is a last-resort duration; it can include workout pauses. */
export function resolveWorkoutDuration(
  duration: HealthQuantity | null | undefined,
  startDate: Date,
  endDate: Date,
): { seconds: number | null; fromElapsedTime: boolean } {
  const provided = duration ? toSeconds(duration.quantity, duration.unit) : null;
  if (provided != null) return { seconds: provided, fromElapsedTime: false };
  const elapsed = (endDate.getTime() - startDate.getTime()) / 1000;
  return { seconds: toSeconds(elapsed, 's'), fromElapsedTime: true };
}

export function beatsPerMinute(quantity: number | undefined, unit: string | undefined): number | undefined {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return undefined;
  if (!unit) return undefined;
  const normalized = unit.trim().toLowerCase();
  const bpm = normalized === 'count/min' || normalized === 'bpm' ? quantity
    : normalized === 'count/s' ? quantity * 60 : undefined;
  return bpm == null || !Number.isFinite(bpm) || bpm <= 0 ? undefined : Math.round(bpm);
}

export function sanitizeRoute(points: ReadonlyArray<{ latitude: number; longitude: number }>, limit = 5000): NonNullable<NormalizedRun['points']> {
  const clean = points.filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180);
  if (!clean.length) return [];
  const count = Math.min(clean.length, limit);
  if (count <= 1) return [{ lat: clean[0].latitude, lng: clean[0].longitude }];
  return Array.from({ length: count }, (_, index) => {
    const point = clean[Math.round(index * (clean.length - 1) / (count - 1))];
    return { lat: point.latitude, lng: point.longitude };
  });
}
