import { HttpError } from '../lib/http.js';

// Snaps tapped waypoints to walkable roads with a Valhalla router. Falls back to
// straight lines when the router is slow or down, so route building never breaks.

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

function straightPath(points) {
  const path = points.map((p) => ({ lat: p.lat, lng: p.lon }));
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversineMiles(path[i - 1], path[i]);
  return { snapped: false, path, distance_mi: Number(total.toFixed(3)) };
}

export default async function snapRoute({ body, config }) {
  const raw = Array.isArray(body?.points) ? body.points : [];
  if (raw.length < 2) throw new HttpError(400, 'At least two waypoints are required');
  if (raw.length > 40) throw new HttpError(400, 'Too many waypoints (max 40)');

  const points = raw.map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lng) }));
  const valid = points.every(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
  );
  if (!valid) throw new HttpError(400, 'Invalid coordinates');

  if (!config.routerUrl || config.routerUrl === 'off') return straightPath(points);

  const payload = { locations: points, costing: 'pedestrian', units: 'miles', directions_type: 'none' };
  const url = routerRequestUrl(config, payload);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'User-Agent': 'FitPro route builder' },
    });
    if (!res.ok) throw new Error(`router responded ${res.status}`);
    const data = await res.json();
    const path = [];
    for (const leg of data?.trip?.legs || []) {
      let pts = [];
      if (Array.isArray(leg?.shape)) pts = leg.shape.map((c) => ({ lat: Number(c[0]), lng: Number(c[1]) }));
      else if (typeof leg?.shape === 'string' && leg.shape) {
        pts = decodePolyline(leg.shape, 6).map(([lat, lng]) => ({ lat, lng }));
      }
      for (const p of pts) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const last = path[path.length - 1];
        if (last && Math.abs(last.lat - p.lat) < 1e-9 && Math.abs(last.lng - p.lng) < 1e-9) continue;
        path.push({ lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) });
      }
    }
    if (path.length < 2) throw new Error('router returned no geometry');
    let total = 0;
    for (let i = 1; i < path.length; i += 1) total += haversineMiles(path[i - 1], path[i]);
    return { snapped: true, path, distance_mi: Number(total.toFixed(3)) };
  } catch {
    return straightPath(points);
  }
}
