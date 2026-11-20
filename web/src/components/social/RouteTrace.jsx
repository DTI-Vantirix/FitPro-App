// Lightweight SVG of a recorded route, used inside feed cards.
export default function RouteTrace({ points, className = '' }) {
  const pts = (points || []).filter(
    (p) => typeof p?.lat === 'number' && typeof p?.lng === 'number'
  );
  if (pts.length < 2) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  pts.forEach((p) => {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  });

  const spanLat = Math.max(maxLat - minLat, 1e-5);
  const spanLng = Math.max(maxLng - minLng, 1e-5);
  const scale = Math.min(100 / spanLng, 100 / spanLat);
  const offX = (100 - spanLng * scale) / 2;
  const offY = (100 - spanLat * scale) / 2;

  const coords = pts.map((p) => [
    offX + (p.lng - minLng) * scale,
    offY + (maxLat - p.lat) * scale,
  ]);
  const poly = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
      <polyline
        points={poly}
        stroke="#C9F84A"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={coords[0][0]} cy={coords[0][1]} r="2.6" fill="#C9F84A" />
    </svg>
  );
}