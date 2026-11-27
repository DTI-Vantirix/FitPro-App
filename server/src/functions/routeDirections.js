import { HttpError } from '../lib/http.js';
import { isUuid } from '../lib/serialize.js';
import { fetchTrip, haversineMiles, legShape, readWaypoints, routeSections } from './snapRoute.js';

// Turn-by-turn directions for one of the caller's saved routes. The app fetches
// them when a route is opened to run and keeps them for the run, so a connection
// is needed at the start, not along the way. When the router can't be reached the
// answer is { available: false } and the route is still shown on the map.

// Valhalla maneuver types 4-6 are "destination".
const isDestination = (type) => type >= 4 && type <= 6;

const UNAVAILABLE = { available: false, maneuvers: [] };

export const OFFROAD_INSTRUCTION = 'Leave the road and head straight for the next marker.';
const ARRIVED = 'You have arrived at your destination.';

// The whole route as one trip. Road sections come from the router; each off-road
// section is one made-up leg with a single maneuver (type 0) telling the runner to
// head for the next marker, since there are no turns to give. Returns null when a
// road section cannot be routed: half a set of directions is worse than none.
export async function buildTrip(points, config) {
  const sections = routeSections(points);
  const legs = [];
  for (const [index, section] of sections.entries()) {
    if (section.offroad) {
      let miles = 0;
      for (let i = 1; i < section.points.length; i += 1) {
        miles += haversineMiles(section.points[i - 1], section.points[i]);
      }
      const maneuvers = [{ type: 0, instruction: OFFROAD_INSTRUCTION, length: miles, begin_shape_index: 0 }];
      if (index === sections.length - 1) {
        maneuvers.push({ type: 4, instruction: ARRIVED, length: 0, begin_shape_index: section.points.length - 1 });
      }
      legs.push({ shape: section.points.map((p) => [p.lat, p.lng]), maneuvers });
      continue;
    }
    try {
      legs.push(...(await fetchTrip(config, section.points, {}, 'VantraRun route directions')).legs);
    } catch {
      return null;
    }
  }
  return { legs };
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
    const points = legShape(leg);
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

  const points = readWaypoints(route.points).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
  if (points.length < 2) return UNAVAILABLE;

  const maneuvers = toManeuvers(await buildTrip(points, config));
  return maneuvers.length ? { available: true, maneuvers } : UNAVAILABLE;
}
