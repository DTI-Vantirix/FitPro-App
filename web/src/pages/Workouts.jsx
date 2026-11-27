import { useEffect, useState } from 'react';
import { Dumbbell, Plus } from 'lucide-react';
import { api } from '@/api/client';
import WorkoutCard from '@/components/workout/WorkoutCard';
import WorkoutComposer from '@/components/workout/WorkoutComposer';

export default function Workouts() {
  const [workouts, setWorkouts] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.entities.Workout.list({ sort: '-performed_at', limit: 60 })
      .then((page) => setWorkouts(page.items || []))
      .catch(() => setWorkouts([]));
  }, []);

  const remove = async (workout) => {
    setWorkouts((list) => (list || []).filter((w) => w.id !== workout.id));
    await api.entities.Workout.delete(workout.id);
  };

  const totalSets = (workouts || []).reduce((n, w) => n + (w.set_count || 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Gym sessions</p>
          <h1 className="mt-2 font-heading text-3xl leading-none">Gym log</h1>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Log workout
        </button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Sessions', value: workouts?.length ?? '—' },
          { label: 'Sets', value: totalSets || '—' },
          { label: 'Volume lb', value: workouts ? Math.round(workouts.reduce((n, w) => n + (w.total_volume || 0), 0)).toLocaleString('en-US') : '—' },
        ].map((s) => (
          <div key={s.label} className="panel px-4 py-3">
            <p className="eyebrow text-[9px]">{s.label}</p>
            <p className="num mt-1 text-lg leading-none">{s.value}</p>
          </div>
        ))}
      </div>

      {workouts === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="panel h-24 animate-pulse" />)}
        </div>
      ) : workouts.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Dumbbell className="h-5 w-5" />
          </span>
          <h2 className="font-heading text-lg">No sessions logged</h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Add the lifts you did at the gym — sets, reps and weight — so your training history builds itself.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 rounded-full border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            Log your first session
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {workouts.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} onDelete={remove} />
          ))}
        </div>
      )}

      <WorkoutComposer
        open={open}
        onOpenChange={setOpen}
        onSaved={(created) => setWorkouts((list) => [created, ...(list || [])])}
      />
    </div>
  );
}