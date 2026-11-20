import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { boundsOf, toLatLngs } from '@/lib/geo';

const pinIcon = (label, tone) =>
  divIcon({
    className: 'map-pin-icon',
    html: `<div class="map-pin ${tone}">${label}</div>`,
    iconSize: [62, 22],
    iconAnchor: [31, 11],
  });

const START_ICON = pinIcon('START', 'start');
const GYM_ICON = pinIcon('GYM', 'gym');
const FINISH_ICON = pinIcon('FINISH', 'finish');

function Fit({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }
    const b = boundsOf(points);
    if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function Follow({ position, enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || !position) return;
    map.setView([position.lat, position.lng], map.getZoom(), { animate: true });
  }, [position?.lat, position?.lng, enabled, map]);
  return null;
}

function ClickCatcher({ onAddPoint }) {
  useMapEvents({
    click(e) {
      onAddPoint?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function MapView({
  points = [],
  path = [],
  gymPoint = null,
  startPoint = null,
  finishPoint = null,
  trail = [],
  position = null,
  editable = false,
  onAddPoint,
  className = 'h-64 w-full',
  initialCenter,
  initialZoom = 14,
  fitKey = 'static',
  follow = false,
}) {
  const waypointLine = useMemo(() => toLatLngs(points), [points]);
  const pathLine = useMemo(() => toLatLngs(path), [path]);
  const trailLine = useMemo(() => toLatLngs(trail), [trail]);
  const fitPoints = useMemo(() => [...points, ...path, ...trail], [points, path, trail]);

  const startPin = startPoint || points[0] || null;
  const finishPin = finishPoint || (points.length > 1 ? points[points.length - 1] : null);

  const center =
    initialCenter ||
    (points[0] ? [points[0].lat, points[0].lng] : path[0] ? [path[0].lat, path[0].lng] : [40.7128, -74.006]);
  const mapKey = `${center[0].toFixed(3)}-${center[1].toFixed(3)}`;
  const showWaypoints = editable || points.length <= 12;

  return (
    <div className={className}>
      <MapContainer
        key={mapKey}
        center={center}
        zoom={initialZoom}
        scrollWheelZoom={false}
        zoomControl={editable}
        attributionControl
        className="h-full w-full"
        style={{ cursor: editable ? 'crosshair' : 'grab' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap'
          maxZoom={19}
        />
        <Fit points={fitPoints} fitKey={fitKey} />
        <Follow position={position} enabled={follow} />
        {editable ? <ClickCatcher onAddPoint={onAddPoint} /> : null}

        {pathLine.length > 1 ? (
          <Polyline positions={pathLine} pathOptions={{ color: '#C9F84A', weight: 4, lineCap: 'round' }} />
        ) : waypointLine.length > 1 ? (
          <Polyline
            positions={waypointLine}
            pathOptions={{ color: '#8A9463', weight: 3, dashArray: '1 7', lineCap: 'round' }}
          />
        ) : null}

        {trailLine.length > 1 && (
          <Polyline positions={trailLine} pathOptions={{ color: '#C9F84A', weight: 5, lineCap: 'round' }} />
        )}

        {showWaypoints &&
          points.map((p, i) => {
            if (startPin && i === 0) return null;
            if (finishPin && i === points.length - 1) return null;
            return (
              <CircleMarker
                key={`wp-${i}`}
                center={[p.lat, p.lng]}
                radius={4}
                pathOptions={{ color: '#16170F', fillColor: '#E9FFA8', fillOpacity: 1, weight: 2 }}
              />
            );
          })}

        {startPin && <Marker position={[startPin.lat, startPin.lng]} icon={START_ICON} interactive={false} />}
        {gymPoint && <Marker position={[gymPoint.lat, gymPoint.lng]} icon={GYM_ICON} interactive={false} />}
        {finishPin && <Marker position={[finishPin.lat, finishPin.lng]} icon={FINISH_ICON} interactive={false} />}

        {position && (
          <CircleMarker
            center={[position.lat, position.lng]}
            radius={9}
            pathOptions={{ color: '#0C0C0A', weight: 3, fillColor: '#C9F84A', fillOpacity: 1 }}
          />
        )}
      </MapContainer>
    </div>
  );
}