/** A route being drawn: its waypoints, its distance and the record that gets saved — pure.
 * Mirrors the website's builder (web/src/pages/RouteBuilder.jsx); the two must stay in step.
 */
import { METERS_PER_MILE, pathLengthMeters, validLatLng, type LatLng } from './geo';

/** A tapped point. `offroad` describes the leg arriving at it: a straight line, not roads. */
export type Waypoint = LatLng & { offroad?: true };
/** What the server's road-following returned for the current waypoints. */
export type SnapResult = { snapped: boolean; path: LatLng[]; distanceMi: number | null };
export type RouteRecord = {
  name: string;
  distance_mi: number;
  points: Waypoint[];
  path: LatLng[];
  target_zone_id: string;
  target_zone_name: string;
};
export type PointRole = 'start' | 'finish' | 'between';
export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** The server's snapRoute refuses more. */
export const MAX_WAYPOINTS = 40;

export function atLimit(points: Waypoint[]): boolean {
  return points.length >= MAX_WAYPOINTS;
}

/** The start has no leg arriving at it, so it is never off-road. */
export function addPoint(points: Waypoint[], at: LatLng, offroad: boolean): Waypoint[] {
  if (!validLatLng(at) || atLimit(points)) return points;
  return [...points, { lat: at.lat, lng: at.lng, ...(offroad && points.length > 0 ? { offroad: true as const } : {}) }];
}

/** A dragged point keeps how it joins the route. */
export function movePoint(points: Waypoint[], index: number, at: LatLng): Waypoint[] {
  if (!validLatLng(at) || !Number.isInteger(index) || index < 0 || index >= points.length) return points;
  return points.map((p, i) => (i === index ? { lat: at.lat, lng: at.lng, ...(p.offroad && i > 0 ? { offroad: true as const } : {}) } : p));
}

export function undoPoint(points: Waypoint[]): Waypoint[] {
  return points.slice(0, -1);
}

export function hasOffroad(points: Waypoint[]): boolean {
  return points.some((p) => p.offroad === true);
}

export function pointRole(index: number, count: number): PointRole {
  if (index === 0) return 'start';
  return index === count - 1 ? 'finish' : 'between';
}

const miles = (path: LatLng[]) => pathLengthMeters(path) / METERS_PER_MILE;

/** The snapped line's distance when there is one; until then, straight between the points. */
export function draftDistanceMi(points: Waypoint[], snap: SnapResult | null): number {
  if (snap && snap.path.length >= 2) return snap.distanceMi != null && snap.distanceMi >= 0 ? snap.distanceMi : miles(snap.path);
  return miles(points);
}

export function canSave(name: string, points: Waypoint[]): boolean {
  return name.trim().length > 0 && points.length >= 2;
}

/** The Route record, field for field what the website's builder saves. */
export function routeRecord(input: { name: string; points: Waypoint[]; snap: SnapResult | null; zone: { id?: string; name: string } | null }): RouteRecord {
  const { points, snap } = input;
  return {
    name: input.name.trim(),
    distance_mi: Number(draftDistanceMi(points, snap).toFixed(2)),
    points: points.map((p) => ({ lat: p.lat, lng: p.lng, ...(p.offroad ? { offroad: true as const } : {}) })),
    path: (snap && snap.path.length >= 2 ? snap.path : points).map((p) => ({ lat: p.lat, lng: p.lng })),
    target_zone_id: input.zone?.id ?? '',
    target_zone_name: input.zone?.name ?? '',
  };
}

/** Road-following answers can arrive out of order; only the newest request's answer counts. */
export function latestOnly() {
  let current = 0;
  return {
    begin(): number { current += 1; return current; },
    cancel(): void { current += 1; },
    isCurrent(id: number): boolean { return id === current; },
  };
}

/** A map window that shows the whole line with a margin, for the small preview on a route card. */
export function previewRegion(path: LatLng[]): MapRegion | null {
  const usable = path.filter(validLatLng);
  if (!usable.length) return null;
  let minLat = usable[0].lat;
  let maxLat = usable[0].lat;
  let minLng = usable[0].lng;
  let maxLng = usable[0].lng;
  for (const p of usable) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.004),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.004),
  };
}
