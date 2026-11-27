import { Link } from 'react-router-dom';
import { Route as RouteIcon, ArrowUpRight } from 'lucide-react';

export default function SavedRoutes({ routes = [] }) {
  return (
    <section>
      <div className="flex items-end justify-between">
        <h2 className="font-heading text-base">Saved routes</h2>
        <Link
          to="/routes"
          className="vr-label text-[10px] transition-colors hover:text-primary"
        >
          Manage
        </Link>
      </div>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
        {routes.map((route) => (
          <Link
            key={route.id}
            to={`/run?route=${route.id}`}
            className="panel group flex min-w-[190px] flex-1 flex-col justify-between gap-6 p-4 transition-colors hover:border-primary/40 hover:bg-secondary/50"
          >
            <div className="flex items-start justify-between">
              <RouteIcon className="h-4 w-4 text-primary" strokeWidth={1.9} />
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">{route.name}</p>
              <p className="vr-label mt-1 text-[10px]">
                {route.miles} mi · {route.zone}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}