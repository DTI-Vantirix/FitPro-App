const EARTH_MI = 3958.7613;

export function haversineMiles(a, b) {
  if (!a || !b) return 0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
}

export function pathMiles(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMiles(points[i - 1], points[i]);
  return total;
}

/** Thins a dense tracked path down to waypoints at least `minMiles` apart. */
export function simplifyPath(points = [], minMiles = 0.1) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (haversineMiles(last, points[i]) >= minMiles) {
      out.push(points[i]);
      last = points[i];
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function toLatLngs(points = []) {
  return points.map((p) => [p.lat, p.lng]);
}

export function boundsOf(points = []) {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

export function centerOf(points = []) {
  if (!points.length) return null;
  const b = boundsOf(points);
  return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
}

export function findZone(zones = [], paceSecPerMile) {
  if (!paceSecPerMile) return null;
  return zones.find((z) => paceSecPerMile >= z.fast_sec && paceSecPerMile <= z.slow_sec) || null;
}

export function zoneStatus(zone, paceSecPerMile) {
  if (!zone || !paceSecPerMile) return { key: 'unknown', label: 'Set your pace', deltaSec: 0 };
  const mid = (zone.fast_sec + zone.slow_sec) / 2;
  const tol = Math.max(4, (zone.slow_sec - zone.fast_sec) * 0.12);
  if (paceSecPerMile >= zone.fast_sec && paceSecPerMile <= zone.slow_sec) {
    return { key: 'on', label: 'On pace', deltaSec: Math.round(paceSecPerMile - mid) };
  }
  if (paceSecPerMile < zone.fast_sec) {
    return { key: 'fast', label: 'Too fast', deltaSec: Math.round(paceSecPerMile - mid) };
  }
  if (paceSecPerMile > zone.slow_sec + tol * 3) {
    return { key: 'slow', label: 'Too slow', deltaSec: Math.round(paceSecPerMile - mid) };
  }
  return { key: 'slow', label: 'Too slow', deltaSec: Math.round(paceSecPerMile - mid) };
}