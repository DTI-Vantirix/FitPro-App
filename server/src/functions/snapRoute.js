import { HttpError } from '../lib/http.js';

// Snaps tapped waypoints to walkable roads and paths with a Valhalla router. Falls
// back to straight lines when the router is slow or down, so route building never
// breaks. A waypoint marked "offroad" is reached in a straight line on purpose:
// that is how a route crosses a field, a beach or a trail the map does not know.

export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// The request to a Valhalla router. A hosted provider's key rides along as api_key.
export function routerRequestUrl(config, payload) {
  const joiner = config.routerUrl.includes('?') ? '&' : '?';
  const key = config.routerApiKey ? `&api_key=${encodeURIComponent(config.routerApiKey)}` : '';
  return `${config.routerUrl}${joiner}json=${encodeURIComponent(JSON.stringify(payload))}${key}`;
}

export function haversineMiles(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.sqrt(h));
}

const validPoint = (p) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

// Cleans stored or posted waypoints into { lat, lng, offroad }.
export function readWaypoints(raw) {
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    lat: Number(p?.lat),
    lng: Number(p?.lng),
    offroad: p?.offroad === true,
  }));
}

// Splits a route into runs of waypoints that are all joined the same way. Each
// section starts on the last waypoint of the one before. "offroad" on a waypoint
// describes the leg arriving at it, so it means nothing on the first one.
export function routeSections(points) {
  const sections = [];
  for (let i = 1; i < points.length; i += 1) {
    const offroad = points[i].offroad === true;
    const last = sections[sections.length - 1];
    if (last && last.offroad === offroad) last.points.push(points[i]);
    else sections.push({ offroad, points: [points[i - 1], points[i]] });
  }
  return sections;
}

export function legShape(leg) {
  if (Array.isArray(leg?.shape)) return leg.shape.map((c) => [Number(c[0]), Number(c[1])]);
  if (typeof leg?.shape === 'string' && leg.shape) return decodePolyline(leg.shape, 6);
  return [];
}

// One request to the router for a run of waypoints. Throws when it cannot answer.
export async function fetchTrip(config, points, options, userAgent) {
  const payload = {
    locations: points.map((p) => ({ lat: p.lat, lon: p.lng })),
    costing: 'pedestrian',
    units: 'miles',
    ...options,
  };
  const res = await fetch(routerRequestUrl(config, payload), {
    signal: AbortSignal.timeout(9000),
    headers: { 'User-Agent': userAgent },
  });
  if (!res.ok) throw new Error('router responded ' + res.status);
  const trip = (await res.json())?.trip;
  if (!Array.isArray(trip?.legs) || !trip.legs.length) throw new Error('router returned no legs');
  return trip;
}

export default async function snapRoute({ body, config }) {
  const raw = Array.isArray(body?.points) ? body.points : [];
  if (raw.length < 2) throw new HttpError(400, 'At least two waypoints are required');
  if (raw.length > 40) throw new HttpError(400, 'Too many waypoints (max 40)');

  const points = readWaypoints(raw);
  if (!points.every(validPoint)) throw new HttpError(400, 'Invalid coordinates');

  const routerOn = Boolean(config.routerUrl) && config.routerUrl !== 'off';
  const path = [];
  const add = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const p = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    const last = path[path.length - 1];
    if (last && last.lat === p.lat && last.lng === p.lng) return;
    path.push(p);
  };

  // "snapped" is false only when a section that should follow roads could not.
  let snapped = true;
  for (const section of routeSections(points)) {
    let routed = null;
    if (!section.offroad) {
      if (routerOn) {
        try {
          const trip = await fetchTrip(config, section.points, { directions_type: 'none' }, 'VantraRun route builder');
          const shape = trip.legs.flatMap(legShape);
          if (shape.length >= 2) routed = shape;
        } catch {
          routed = null;
        }
      }
      if (!routed) snapped = false;
    }
    if (routed) for (const [lat, lng] of routed) add(lat, lng);
    else for (const p of section.points) add(p.lat, p.lng);
  }

  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineMiles(path[i - 1], path[i]);
  return { snapped, path, distance_mi: Number(total.toFixed(3)) };
}
