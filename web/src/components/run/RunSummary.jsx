import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Share2 } from 'lucide-react';
import { api } from '@/api/client';
import SplitsList from '@/components/run/SplitsList';
import LegsList from '@/components/run/LegsList';
import MapView from '@/components/MapView';
import { formatDuration, formatPace } from '@/lib/format';
import { simplifyPath } from '@/lib/geo';

export default function RunSummary({ run }) {
  const [routeName, setRouteName] = useState('');
  const [savingRoute, setSavingRoute] = useState(false);
  const [savedRoute, setSavedRoute] = useState(null);

  const saveAsRoute = async () => {
    setSavingRoute(true);
    const points = run.points || [];
    const created = await api.entities.Route.create({
      name: routeName.trim() || 'My free run',
      distance_mi: Number(run.distance_mi) || 0,
      points: simplifyPath(points, 0.1),
      path: points,
    });
    setSavedRoute(created);
    setSavingRoute(false);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center gap-2 text-primary">
        <Check className="h-5 w-5" strokeWidth={2.5} />
        <p className="eyebrow !text-primary">Run saved</p>
      </div>
      <h1 className="font-heading text-3xl font-extrabold">{run.route_name}</h1>

      {run.points?.length > 1 && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <MapView
            trail={run.points}
            startPoint={run.points[0]}
            finishPoint={run.points[run.points.length - 1]}
            gymPoint={run.gym_point || null}
            fitKey={run.id || 'run'}
            className="h-52 w-full"
          />
        </div>
      )}

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border">
        {[
          { label: 'Distance', value: `${Number(run.distance_mi).toFixed(2)} mi` },
          { label: 'Moving time', value: formatDuration(run.duration_sec) },
          { label: 'Avg pace', value: `${formatPace(run.avg_pace_sec)} /mi` },
          { label: 'In target zone', value: `${run.in_zone_pct || 0}%` },
          ...(run.avg_hr
            ? [
                { label: 'Avg HR', value: `${run.avg_hr} bpm` },
                { label: 'Max HR', value: `${run.max_hr || run.avg_hr} bpm` },
              ]
            : []),
        ].map((stat) => (
          <div key={stat.label} className="bg-card p-4">
            <p className="eyebrow">{stat.label}</p>
            <p className="num mt-1.5 text-xl">{stat.value}</p>
          </div>
        ))}
      </div>
      {run.legs?.length > 0 && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="eyebrow">Legs</p>
            {run.gym_name ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{run.gym_name}</p>
            ) : null}
          </div>
          <LegsList legs={run.legs} />
        </div>
      )}

      <div className="panel p-5">
        <p className="eyebrow mb-3">Splits</p>
        <SplitsList splits={run.splits || []} />
      </div>

      {!run.route_id && (
        <div className="panel p-5">
          <p className="eyebrow">Save as a route</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Keep this path so you can run it again and switch zones whenever you like.
          </p>
          {savedRoute ? (
            <Link
              to="/routes"
              className="mt-3 flex items-center justify-center gap-2 rounded-full border border-primary/40 py-3 font-heading text-sm font-medium text-primary"
            >
              <Check className="h-4 w-4" /> Saved — see your routes
            </Link>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder="Evening loop"
                className="min-w-0 flex-1 rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
              <button
                type="button"
                onClick={saveAsRoute}
                disabled={savingRoute}
                className="shrink-0 rounded-full bg-primary px-4 py-2.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
              >
                {savingRoute ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}

      <Link
        to={`/feed?compose=run&id=${run.id}`}
        className="flex items-center justify-center gap-2 rounded-full border border-primary/40 py-3 font-heading text-sm font-medium text-primary transition hover:bg-primary/10"
      >
        <Share2 className="h-4 w-4" /> Share this run
      </Link>

      <div className="flex gap-2">
        <Link
          to="/analytics"
          className="flex-1 rounded-full border border-border py-3 text-center font-heading text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          See analytics
        </Link>
        <Link
          to="/"
          className="flex-1 rounded-full bg-primary py-3 text-center font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95"
        >
          Done
        </Link>
      </div>
    </div>
  );
}