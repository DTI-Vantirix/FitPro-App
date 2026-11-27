import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Crosshair, RotateCcw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import MapView from '@/components/MapView';
import ZonePicker from '@/components/run/ZonePicker';
import { pathMiles } from '@/lib/geo';
import { locationProblem } from '@/lib/location';
import { sortZones } from '@/lib/zones';

export default function RouteBuilder() {
  const navigate = useNavigate();
  const [points, setPoints] = useState([]);
  const [path, setPath] = useState([]);
  const [snapping, setSnapping] = useState(false);
  const [snapFailed, setSnapFailed] = useState(false);
  const [name, setName] = useState('');
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState('');
  const [center, setCenter] = useState([40.7128, -74.006]);
  const [here, setHere] = useState(null);
  const [geoError, setGeoError] = useState(null);
  // How the next point joins the route: along roads and paths, or straight
  // across ground the map has no path for.
  const [offroad, setOffroad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const distance = useMemo(() => (path.length > 1 ? pathMiles(path) : pathMiles(points)), [path, points]);

  useEffect(() => {
    api.entities.PaceZone.list({ sort: 'fast_sec', limit: 20 }).then((page) => {
      const list = sortZones(page.items || []);
      setZones(list);
      if (list.length) setZoneId((list.find((z) => Number(z.zone_number) === 2) || list[0]).id);
    });
    if (!navigator.geolocation || !window.isSecureContext) {
      setGeoError(locationProblem(null));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(p);
        setCenter([p.lat, p.lng]);
        setGeoError(null);
      },
      (err) => setGeoError(locationProblem(err)),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }, []);

  const snap = async (waypoints) => {
    if (waypoints.length < 2) {
      setPath([]);
      setSnapFailed(false);
      return;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    setSnapping(true);
    try {
      const res = await api.functions.invoke('snapRoute', { points: waypoints });
      if (id !== requestId.current) return;
      const next = res?.data?.path || [];
      setPath(next.length > 1 ? next : []);
      setSnapFailed(!res?.data?.snapped);
    } catch {
      if (id !== requestId.current) return;
      setPath([]);
      setSnapFailed(true);
    } finally {
      if (id === requestId.current) setSnapping(false);
    }
  };

  const addPoint = (p) => {
    const point = { lat: p.lat, lng: p.lng };
    if (offroad && points.length) point.offroad = true;
    const next = [...points, point];
    setPoints(next);
    snap(next);
  };

  const undo = () => {
    const next = points.slice(0, -1);
    setPoints(next);
    snap(next);
  };

  const clearPoints = () => {
    setPoints([]);
    setPath([]);
    setSnapFailed(false);
    requestId.current += 1;
    setSnapping(false);
  };

  const save = async () => {
    if (!name.trim() || points.length < 2) return;
    setSaving(true);
    setError(null);
    const zone = zones.find((z) => z.id === zoneId);
    try {
      await api.entities.Route.create({
        name: name.trim(),
        distance_mi: Number(distance.toFixed(2)),
        points,
        path: path.length > 1 ? path : points,
        target_zone_id: zone?.id || '',
        target_zone_name: zone?.name || '',
      });
      navigate('/routes');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to="/routes"
          aria-label="Back to routes"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="eyebrow">
            {offroad ? 'Off-road: points join in a straight line' : 'Tap the map — the line follows the roads'}
          </p>
          <h1 className="font-heading text-lg leading-tight">Draw a route</h1>
        </div>
      </div>

      {geoError && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs leading-relaxed text-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {geoError}
        </p>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-border">
        <MapView
          points={points}
          position={here}
          path={path}
          editable
          onAddPoint={addPoint}
          initialCenter={center}
          initialZoom={15}
          // Never refit while drawing: the map stays at the zoom and place you chose.
          fitKey="builder"
          className="h-[44vh] min-h-[260px] w-full"
        />
        <div className="absolute bottom-3 left-3 z-[500] flex rounded-full border border-border bg-background p-1">
          {[
            { value: false, label: 'Follow roads' },
            { value: true, label: 'Off-road' },
          ].map((mode) => (
            <button
              key={mode.label}
              type="button"
              aria-pressed={offroad === mode.value}
              onClick={() => setOffroad(mode.value)}
              className={cn(
                'min-h-9 rounded-full px-3.5 text-xs font-semibold transition-colors',
                offroad === mode.value ? 'bg-primary text-primary-foreground' : 'text-steel hover:text-foreground'
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {/* On the map itself, so a wrong tap can be taken back without scrolling. */}
        <div className="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!points.length}
            aria-label="Undo last point"
            className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-foreground disabled:text-steel"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.75} /> Undo
          </button>
          <button
            type="button"
            onClick={clearPoints}
            disabled={!points.length}
            aria-label="Clear all points"
            className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-foreground disabled:text-steel"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Clear
          </button>
        </div>
      </div>

      <div className="panel space-y-4 p-5">
        <div className="grid gap-3">
          <label className="block">
            <span className="eyebrow">Route name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ironworks loop"
              className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm transition-colors placeholder:text-muted-foreground/70 focus:border-primary"
            />
          </label>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3">
          <div>
            <p className="eyebrow">Distance</p>
            <p className="num mt-1 text-2xl leading-none">
              {distance.toFixed(2)}
              <span className="ml-1 text-xs text-muted-foreground">mi</span>
            </p>
          </div>
          <p className="vr-label text-[11px]">
            {snapping ? 'Following roads…' : `${points.length} ${points.length === 1 ? 'point' : 'points'}`}
          </p>
        </div>

        {points.some((p) => p.offroad) && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Off-road legs are drawn straight between your points, so add a point at each bend. Spoken directions tell
            you to head for the next marker there.
          </p>
        )}

        {snapFailed && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Road data is unavailable right now, so the line joins your points directly. Your route still saves fine.
          </p>
        )}

        <ZonePicker zones={zones} value={zoneId} onChange={setZoneId} label="Default zone for this route" />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => here && addPoint(here)}
            disabled={!here}
            className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Crosshair className="h-3.5 w-3.5" /> Add my location
          </button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={saving || !name.trim() || points.length < 2}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save route'}
        </button>
        {points.length < 2 && (
          <p className="text-center text-[11px] text-muted-foreground">Add at least two waypoints to save.</p>
        )}
      </div>
    </div>
  );
}