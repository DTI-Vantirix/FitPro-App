import { Link } from 'react-router-dom';
import { Share2, Trash2 } from 'lucide-react';
import { formatShortDate } from '@/lib/format';

export default function WorkoutCard({ workout, onDelete }) {
  const exercises = workout.exercises || [];
  const sets = workout.set_count || exercises.reduce((n, e) => n + (e.sets?.length || 0), 0);
  const volume = Math.round(workout.total_volume || 0);

  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-sm font-bold leading-tight">{workout.name}</h3>
          <p className="num mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {formatShortDate(workout.performed_at || workout.created_date)} · {sets} sets
            {volume > 0 ? ` · ${volume.toLocaleString('en-US')} lb` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="num rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
            {workout.duration_min || 0} min
          </span>
          <Link
            to={`/feed?compose=workout&id=${workout.id}`}
            aria-label={`Share ${workout.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary"
          >
            <Share2 className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => onDelete(workout)}
            aria-label={`Delete ${workout.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {exercises.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {exercises.slice(0, 5).map((ex, i) => {
            const best = ex.sets?.[0];
            return (
              <li
                key={`${ex.name}-${i}`}
                className="num rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-muted-foreground"
              >
                {ex.name}
                {best ? ` · ${ex.sets.length}×${best.reps}` : ''}
              </li>
            );
          })}
          {exercises.length > 5 && (
            <li className="num rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-muted-foreground">
              +{exercises.length - 5} more
            </li>
          )}
        </ul>
      )}
    </article>
  );
}