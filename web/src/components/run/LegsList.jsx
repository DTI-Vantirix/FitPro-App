import { formatDuration, formatPace } from '@/lib/format';

function paceOf(distance, duration) {
  return distance > 0.01 && duration > 0 ? Math.round(duration / distance) : 0;
}

export default function LegsList({ legs = [], active = null }) {
  if (!legs.length && !active) return null;

  return (
    <ul className="space-y-2">
      {legs.map((leg) => (
        <li key={leg.index} className="flex items-center gap-3">
          <span className="tabular-nums flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground">
            {leg.index}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-tight">
              {leg.from} <span className="text-muted-foreground">→</span> {leg.to}
            </p>
            <p className="vr-label mt-0.5 text-[10px]">
              {Number(leg.distance_mi || 0).toFixed(2)} mi · {formatDuration(leg.duration_sec || 0)}
            </p>
          </div>
          <span className="tabular-nums shrink-0 text-xs text-foreground">
            {leg.avg_pace_sec ? `${formatPace(leg.avg_pace_sec)} /mi` : '—'}
          </span>
        </li>
      ))}

      {active && (
        <li className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-tight text-primary">
              {active.from} <span className="text-muted-foreground">→</span> {active.to}
            </p>
            <p className="vr-label mt-0.5 text-[10px]">
              {Number(active.distance_mi || 0).toFixed(2)} mi · {formatDuration(active.duration_sec || 0)}
            </p>
          </div>
          <span className="tabular-nums shrink-0 text-xs text-muted-foreground">
            {paceOf(active.distance_mi, active.duration_sec)
              ? `${formatPace(paceOf(active.distance_mi, active.duration_sec))} /mi`
              : '—'}
          </span>
        </li>
      )}
    </ul>
  );
}