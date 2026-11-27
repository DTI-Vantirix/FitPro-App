import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Footprints, Timer, TrendingUp } from 'lucide-react';
import { api } from '@/api/client';
import MiniStat from '@/components/MiniStat';
import { PaceTrendChart, WeeklyDistanceChart } from '@/components/analytics/Charts';
import { formatDuration, formatPace, formatShortDate } from '@/lib/format';

function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Analytics() {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    let alive = true;
    api.entities.Run.list({ sort: '-started_at', limit: 200 })
      .then((runPage) => {
        if (!alive) return;
        setRuns(runPage.items || []);
      })
      .catch(() => {
        if (!alive) return;
        setRuns([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loading = runs === null;
  const runList = runs || [];

  const weekly = useMemo(() => {
    const buckets = [];
    for (let i = 7; i >= 0; i -= 1) {
      const start = startOfWeek(new Date());
      start.setDate(start.getDate() - i * 7);
      buckets.push({ start, miles: 0 });
    }
    runList.forEach((run) => {
      const when = new Date(run.started_at || run.created_date);
      const key = startOfWeek(when).getTime();
      const bucket = buckets.find((b) => b.start.getTime() === key);
      if (bucket) bucket.miles += Number(run.distance_mi) || 0;
    });
    return buckets.map((b) => ({ label: formatShortDate(b.start), miles: Number(b.miles.toFixed(2)) }));
  }, [runList]);

  const paceTrend = useMemo(
    () =>
      runList
        .filter((r) => r.avg_pace_sec)
        .slice(0, 14)
        .reverse()
        .map((r) => ({ label: formatShortDate(r.started_at || r.created_date), pace: Math.round(r.avg_pace_sec) })),
    [runList]
  );

  const totals = useMemo(() => {
    const miles = runList.reduce((n, r) => n + (Number(r.distance_mi) || 0), 0);
    const time = runList.reduce((n, r) => n + (Number(r.duration_sec) || 0), 0);
    const zoneCounts = runList.reduce((acc, r) => {
      const key = r.target_zone_name || 'Unzoned';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return {
      miles,
      time,
      avgPace: miles > 0.1 ? time / miles : 0,
      zones: Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]),
    };
  }, [runList]);

  const best = useMemo(() => {
    const longest = [...runList].sort((a, b) => (b.distance_mi || 0) - (a.distance_mi || 0))[0];
    const fastest = [...runList].filter((r) => r.avg_pace_sec).sort((a, b) => a.avg_pace_sec - b.avg_pace_sec)[0];
    return { longest, fastest };
  }, [runList]);

  if (loading) {
    return <div className="panel h-64 animate-pulse" />;
  }

  if (!runList.length) {
    return (
      <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <TrendingUp className="h-5 w-5" />
        </span>
        <h1 className="font-heading text-lg">No training data yet</h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Log a run and your distance and pace trends build up here.
        </p>
        <Link
          to="/run"
          className="mt-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Start a run
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">All time</p>
          <h1 className="mt-2 font-heading text-3xl leading-none">Analytics</h1>
        </div>
        <Link
          to="/zones"
          className="rounded-full border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          Pace zones
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MiniStat icon={Footprints} label="Total distance" value={totals.miles.toFixed(1)} unit="mi" caption={`${runList.length} runs`} accent />
        <MiniStat icon={Timer} label="Avg pace" value={formatPace(totals.avgPace)} unit="/mi" caption="Across all runs" />
        <MiniStat icon={TrendingUp} label="Moving time" value={formatDuration(totals.time)} unit="hrs" caption="Running only" />
      </div>

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base">Weekly distance</h2>
          <span className="vr-label text-[10px]">last 8 weeks</span>
        </div>
        <div className="mt-4">
          <WeeklyDistanceChart data={weekly} />
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base">Pace trend</h2>
          <span className="vr-label text-[10px]">
            {paceTrend.length} runs
          </span>
        </div>
        <div className="mt-4">
          {paceTrend.length > 1 ? (
            <PaceTrendChart data={paceTrend} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Two runs unlock your pace trend.</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-heading text-base">Zone discipline</h2>
          {totals.zones.length ? (
            <ul className="mt-3 space-y-2">
              {totals.zones.map(([zone, count]) => (
                <li key={zone} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{zone}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${(count / runList.length) * 100}%` }}
                    />
                  </span>
                  <span className="tabular-nums w-8 shrink-0 text-right text-[11px] text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Run in a target zone to see this.</p>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-heading text-base">Best efforts</h2>
          <ul className="mt-3 divide-y divide-border">
            {[
              { label: 'Longest run', value: best.longest ? `${Number(best.longest.distance_mi).toFixed(2)} mi` : '—', sub: best.longest?.route_name || '' },
              { label: 'Fastest avg pace', value: best.fastest ? `${formatPace(best.fastest.avg_pace_sec)} /mi` : '—', sub: best.fastest?.route_name || '' },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{row.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{row.sub}</p>
                </div>
                <p className="num shrink-0 text-sm">{row.value}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}