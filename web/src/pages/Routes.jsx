import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Route as RouteIcon } from 'lucide-react';
import { api } from '@/api/client';
import RouteCard from '@/components/routes/RouteCard';
import { sortZones } from '@/lib/zones';

export default function Routes() {
  const [routes, setRoutes] = useState(null);
  const [zones, setZones] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.entities.Route.list({ sort: '-created_date', limit: 60 })
      .then((page) => alive && setRoutes(page.items || []))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setRoutes((r) => r || []));
    api.entities.PaceZone.list({ sort: 'fast_sec', limit: 20 })
      .then((page) => alive && setZones(sortZones(page.items || [])))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (route) => {
    setRoutes((list) => (list || []).filter((r) => r.id !== route.id));
    await api.entities.Route.delete(route.id);
  };

  const changeZone = async (route, zoneId) => {
    const zone = zones.find((z) => z.id === zoneId);
    setRoutes((list) =>
      (list || []).map((r) =>
        r.id === route.id
          ? { ...r, target_zone_id: zoneId, target_zone_name: zone?.name || '' }
          : r
      )
    );
    await api.entities.Route.update(route.id, {
      target_zone_id: zoneId,
      target_zone_name: zone?.name || '',
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Mapped on the map</p>
          <h1 className="mt-2 font-heading text-3xl font-extrabold leading-none">Routes</h1>
        </div>
        <Link
          to="/routes/new"
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Draw a route
        </Link>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {routes === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="panel h-56 animate-pulse" />)}
        </div>
      ) : routes.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <RouteIcon className="h-5 w-5" />
          </span>
          <h2 className="font-heading text-lg font-bold">No routes yet</h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Tap your start point and trace the way — to the gym and back home, along the river, wherever you run. The
            line follows the roads for you.
          </p>
          <Link
            to="/routes/new"
            className="mt-2 rounded-full border border-border px-4 py-2.5 font-heading text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            Draw your first route
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              zones={zones}
              onZoneChange={changeZone}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}