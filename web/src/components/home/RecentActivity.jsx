import { Link } from 'react-router-dom';
import { ArrowRight, Dumbbell, Footprints } from 'lucide-react';
import { relativeDay } from '@/lib/format';

export default function RecentActivity({ items = [] }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base">Recent activity</h2>
        <Link
          to="/analytics"
          className="flex items-center gap-1 vr-label text-[10px] transition-colors hover:text-primary"
        >
          All <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No sessions logged yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {items.map((item) => {
            const isRun = item.type === 'run';
            const Icon = isRun ? Footprints : Dumbbell;
            return (
              <li key={item.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <Icon className="h-4 w-4 text-primary" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
                  <p className="mt-0.5 truncate vr-label text-[10px]">
                    {relativeDay(item.date)} · {item.meta}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-sm text-foreground">{item.value}</p>
                  <p className="vr-label text-[10px]">{item.unit}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}