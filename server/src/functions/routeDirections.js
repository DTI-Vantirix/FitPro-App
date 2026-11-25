import { HttpError } from '../lib/http.js';
import { isUuid } from '../lib/serialize.js';
import { decodePolyline } from './snapRoute.js';

// Turn-by-turn directions for one of the caller's saved routes. The app fetches
// them when a route is opened to run and keeps them for the run, so a connection
// is needed at the start, not along the way. When the router can't be reached the
// answer is { available: false } and the route is still shown on the map.

// Valhalla maneuver types 4-6 are "destination".
const isDestination = (type) => type >= 4 && type <= 6;

const UNAVAILABLE = { available: false, maneuvers: [] };

function legPoints(leg) {
  if (Array.isArray(leg?.shape)) return leg.shape.map((c) => [Number(c[0]), Number(c[1])]);
  if (typeof leg?.shape === 'string' && leg.shape) return decodePolyline(leg.shape, 6);
  return [];
}

// Flattens a Valhalla trip into one list of maneuvers for the whole route.
// A route with waypoints comes back as several legs, each ending in its own
// "arrival": only the last one is kept, so passing a waypoint is not announced
// as arriving. `at_mi` is how far along the route the maneuver begins.
export function toManeuvers(trip) {
  const legs = Array.isArray(trip?.legs) ? trip.legs : [];
  const out = [];
  let miles = 0;
  legs.forEach((leg, legIndex) => {
    const points = legPoints(leg);
    const lastLeg = legIndex === legs.length - 1;
    for (const m of Array.isArray(leg?.maneuvers) ? leg.maneuvers : []) {
      const length = Number.isFinite(Number(m?.length)) ? Number(m.length) : 0;
      const at = miles;
      miles += length;
      const type = Number(m?.type);
      const point = points[m?.begin_shape_index];
      const instruction = m?.instruction ? String(m.instruction) : '';
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !instruction) continue;
      if (isDestination(type) && !lastLeg) continue;
      out.push({
        index: out.length,
        instruction,
        verbal: m.verbal_pre_transition_instruction ? String(m.verbal_pre_transition_instruction) : instruction,
        type: Number.isFinite(type) ? type : 0,
        lat: Number(point[0].toFixed(6)),
        lng: Number(point[1].toFixed(6)),
        at_mi: Number(at.toFixed(3)),
      });
    }
  });
  return out;
}

export default async function routeDirections({ db, user, body, config }) {
  const routeId = body?.route_id;
  const [route] = isUuid(routeId)
    ? await db.query('select points from routes where id = $1 and created_by_id = $2', [routeId, user.id])
    : [];
  if (!route) throw new HttpError(404, 'Route not found.');

  if (!config.routerUrl || config.routerUrl === 'off') return UNAVAILABLE;

  const locations = (Array.isArray(route.points) ? route.points : [])
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (locations.length < 2) return UNAVAILABLE;

  const payload = { locations, costing: 'pedestrian', units: 'miles' };
  const url = `${config.routerUrl}?json=${encodeURIComponent(JSON.stringify(payload))}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'User-Agent': 'FitPro route directions' },
    });
    if (!res.ok) throw new Error(`router responded ${res.status}`);
    const maneuvers = toManeuvers((await res.json())?.trip);
    return maneuvers.length ? { available: true, maneuvers } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}
