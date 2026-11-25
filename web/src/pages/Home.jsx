import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Activity, ArrowUpRight, Footprints, MapPin, Timer, TrendingUp } from 'lucide-react';
import StatCard from '@/components/StatCard';
import MiniStat from '@/components/MiniStat';
import NextSession from '@/components/home/NextSession';
import RecentActivity from '@/components/home/RecentActivity';
import SavedRoutes from '@/components/home/SavedRoutes';
import { api } from '@/api/client';
import { formatDuration, formatPace } from '@/lib/format';

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Home() {
  const [runs, setRuns] = useState([]);
  const [routes, setRoutes] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.entities.Run.list({ sort: '-started_at', limit: 40 }),
      api.entities.Route.list({ sort: '-created_date', limit: 20 }),
    ])
      .then(([runPage, routePage]) => {
        if (!alive) return;
        setRuns(runPage.items || []);
        setRoutes(routePage.items || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const weekStart = startOfWeek(new Date());
    const lastStart = new Date(weekStart);
    lastStart.setDate(lastStart.getDate() - 7);
    const inWeek = (r) => new Date(r.started_at || r.created_date) >= weekStart;
    const thisWeek = runs.filter(inWeek);
    const lastWeek = runs.filter((r) => {
      const d = new Date(r.started_at || r.created_date);
      return d >= lastStart && d < weekStart;
    });
    const distance = thisWeek.reduce((n, r) => n + (Number(r.distance_mi) || 0), 0);
    const lastDistance = lastWeek.reduce((n, r) => n + (Number(r.distance_mi) || 0), 0);
    const time = thisWeek.reduce((n, r) => n + (Number(r.duration_sec) || 0), 0);
    return {
      distance,
      delta: lastDistance > 0 ? Math.round(((distance - lastDistance) / lastDistance) * 100) : distance > 0 ? 100 : 0,
      runs: thisWeek.length,
      avgPace: distance > 0.1 ? time / distance : 0,
      time,
      totalMinutes: Math.round(time / 60),
    };
  }, [runs]);

  const recent = useMemo(() => {
    const runItems = runs.slice(0, 6).map((r) => ({
      id: `run-${r.id}`,
      type: 'run',
      title: r.route_name || 'Run',
      date: r.started_at || r.created_date,
      meta: `${Number(r.distance_mi || 0).toFixed(2)} mi · ${formatPace(r.avg_pace_sec)} /mi`,
      value: formatDuration(r.duration_sec),
      unit: 'time',
    }));
    return runItems.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  }, [runs]);

  const session = useMemo(() => {
    const route = routes[0];
    if (!route) return null;
    const miles = Number(route.distance_mi || 0);
    return {
      title: route.name,
      total: `${miles.toFixed(1)} mi`,
      steps: [
        {
          icon: Footprints,
          title: 'Run the route',
          meta: `${miles.toFixed(1)} mi${route.target_zone_name ? ` · ${route.target_zone_name} zone` : ''}`,
        },
      ],
      cta: { label: 'Start run', to: `/run?route=${route.id}` },
    };
  }, [routes]);

  const routeCards = routes.slice(0, 4).map((r) => ({
    id: r.id,
    name: r.name,
    miles: Number(r.distance_mi || 0).toFixed(1),
    zone: r.target_zone_name || 'No zone',
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{format(new Date(), 'EEEE, d MMMM')}</p>
          <h1 className="mt-2 font-heading text-3xl font-extrabold leading-none sm:text-4xl">Your week</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/routes/new"
            className="hidden items-center gap-2 rounded-full border border-border px-4 py-2.5 font-heading text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary sm:flex"
          >
            Plan a route <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/run"
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.99]"
          >
            <Activity className="h-4 w-4" strokeWidth={2.2} /> Start a run
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <StatCard
          label="Distance this week"
          value={stats.distance}
          format={(n) => n.toFixed(1)}
          unit="mi"
          delta={stats.delta}
          deltaLabel="vs last week"
          caption={`${stats.runs} ${stats.runs === 1 ? 'run' : 'runs'}`}
        />
        <div className="grid grid-cols-2 gap-4">
          <MiniStat icon={Footprints} label="Runs" value={stats.runs} unit="sessions" caption="Since Monday" accent />
          <MiniStat icon={Timer} label="Avg pace" value={formatPace(stats.avgPace)} unit="/mi" caption="This week" />
          <div className="col-span-2">
            <MiniStat icon={TrendingUp} label="Moving time" value={`${stats.totalMinutes}`} unit="min" caption="This week" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        {session ? (
          <NextSession session={session} cta={session.cta} />
        ) : (
          <section className="panel flex flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            <h2 className="font-heading text-lg font-bold">Plan your first route</h2>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Draw a route once, set the zone, and every run starts from it.
            </p>
            <Link
              to="/routes/new"
              className="mt-1 rounded-full bg-primary px-4 py-2.5 font-heading text-sm font-semibold text-primary-foreground"
            >
              Draw a route
            </Link>
          </section>
        )}
        <RecentActivity items={recent} />
      </div>

      {routeCards.length > 0 && <SavedRoutes routes={routeCards} />}
    </div>
  );
}