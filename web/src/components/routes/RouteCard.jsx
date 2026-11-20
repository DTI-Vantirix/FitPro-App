import { Link } from 'react-router-dom';
import { Play, Trash2 } from 'lucide-react';
import MapView from '@/components/MapView';
import { zoneRangeLabel } from '@/lib/zones';

export default function RouteCard({ route, zones = [], onZoneChange, onDelete }) {
  return (
    <article className="panel group overflow-hidden">
      <div className="relative">
        <MapView
          path={route.path?.length ? route.path : route.points || []}
          points={route.points || []}
          gymPoint={route.gym_point || null}
          fitKey={route.id}
          className="h-36 w-full"
          initialZoom={14}
        />
        <span className="absolute left-3 top-3 z-[400] rounded-full border border-white/10 bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white backdrop-blur">
          {Number(route.distance_mi || 0).toFixed(2)} mi
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-sm font-bold">{route.name}</h3>
            {route.gym_stop ? (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">Gym · {route.gym_stop}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onDelete(route)}
              aria-label={`Delete ${route.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <Link
              to={`/run?route=${route.id}`}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95"
            >
              <Play className="h-3 w-3" strokeWidth={2.5} /> Run
            </Link>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="eyebrow">Target zone</span>
          <select
            value={route.target_zone_id || ''}
            onChange={(e) => onZoneChange(route, e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/60"
          >
            <option value="">No zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name} · {zoneRangeLabel(zone)} /mi
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}