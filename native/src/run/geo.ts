/** Distance and route geometry — pure. */
export type LatLng = { lat: number; lng: number };

export const METERS_PER_MILE = 1609.344;
const EARTH_M = 6371008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function validLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += metersBetween(path[i - 1], path[i]);
  return total;
}

export type Projection = { offMeters: number; alongMeters: number };

/** Where `p` sits relative to a route line: how far off it, and how far along it.
 * A route can pass the same spot twice (out-and-back, laps). `hintAlong` is how far
 * along the runner was last time; among the places the line passes close to `p`,
 * the first one at or just behind that progress wins, so progress does not jump back
 * to the outbound leg.
 */
export function projectOnPath(path: LatLng[], p: LatLng, hintAlong?: number): Projection | null {
  if (path.length < 2 || !validLatLng(p)) return null;
  const cosLat = Math.cos(rad(p.lat));
  const x = (q: LatLng) => rad(q.lng - p.lng) * cosLat * EARTH_M;
  const y = (q: LatLng) => rad(q.lat - p.lat) * EARTH_M;
  const candidates: Projection[] = [];
  let walked = 0;
  for (let i = 1; i < path.length; i += 1) {
    const ax = x(path[i - 1]);
    const ay = y(path[i - 1]);
    const bx = x(path[i]);
    const by = y(path[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    // p is the origin of this local frame
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    candidates.push({ offMeters: Math.hypot(ax + t * dx, ay + t * dy), alongMeters: walked + t * len });
    walked += len;
  }
  let best = candidates[0];
  for (const c of candidates) if (c.offMeters < best.offMeters) best = c;
  if (hintAlong === undefined) return best;
  const close = Math.max(best.offMeters + 15, 25);
  let ahead: Projection | null = null;
  for (const c of candidates) {
    if (c.offMeters > close || c.alongMeters < hintAlong - 30) continue;
    if (!ahead || c.alongMeters < ahead.alongMeters) ahead = c;
  }
  return ahead ?? best;
}

/** Evenly thins a list to at most `max` items, always keeping the first and the last. */
export function thinPoints<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}
