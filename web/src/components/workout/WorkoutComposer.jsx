import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, X } from 'lucide-react';
import { EXERCISES, muscleFor } from '@/lib/exercises';
import { api } from '@/api/client';

const inputClass =
  'w-full rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-sm focus:border-primary num';

export default function WorkoutComposer({ open, onOpenChange, onSaved }) {
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('45');
  const [exercises, setExercises] = useState([]);
  const [pick, setPick] = useState(EXERCISES[0].name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDuration('45');
    setExercises([]);
    setError(null);
  }, [open]);

  const addExercise = () => {
    if (!pick) return;
    setExercises((list) => [...list, { name: pick, muscle: muscleFor(pick), sets: [{ reps: 8, weight: 0 }] }]);
  };

  const updateSet = (exIndex, setIndex, field, value) => {
    setExercises((list) =>
      list.map((ex, i) =>
        i !== exIndex
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, [field]: Number(value) || 0 } : s)),
            }
      )
    );
  };

  const addSet = (exIndex) => {
    setExercises((list) =>
      list.map((ex, i) => {
        if (i !== exIndex) return ex;
        const last = ex.sets[ex.sets.length - 1] || { reps: 8, weight: 0 };
        return { ...ex, sets: [...ex.sets, { ...last }] };
      })
    );
  };

  const removeSet = (exIndex, setIndex) => {
    setExercises((list) =>
      list.map((ex, i) =>
        i !== exIndex ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== setIndex) }
      )
    );
  };

  const save = async () => {
    if (!name.trim() || !exercises.length) {
      setError('Give the session a name and add at least one exercise.');
      return;
    }
    setSaving(true);
    const totalVolume = exercises.reduce(
      (sum, ex) => sum + ex.sets.reduce((s, set) => s + (set.reps || 0) * (set.weight || 0), 0),
      0
    );
    const setCount = exercises.reduce((n, ex) => n + ex.sets.length, 0);
    const created = await api.entities.Workout.create({
      name: name.trim(),
      performed_at: new Date().toISOString(),
      duration_min: Number(duration) || 0,
      exercises,
      total_volume: totalVolume,
      set_count: setCount,
    });
    setSaving(false);
    onSaved(created);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Log a gym session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <label className="block">
              <span className="eyebrow">Session name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Push A — chest & shoulders"
                className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="eyebrow">Minutes</span>
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                inputMode="numeric"
                className="num mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm focus:border-primary"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="w-full rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm focus:border-primary"
            >
              {EXERCISES.map((ex) => (
                <option key={ex.name} value={ex.name} className="bg-card">
                  {ex.name} · {ex.muscle}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addExercise}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3.5 font-heading text-xs text-primary-foreground transition hover:brightness-95"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>

          <div className="space-y-3">
            {exercises.map((ex, exIndex) => (
              <div key={`${ex.name}-${exIndex}`} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold leading-tight">{ex.name}</p>
                    <p className="vr-label text-[9px]">{ex.muscle}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExercises((list) => list.filter((_, i) => i !== exIndex))}
                    aria-label={`Remove ${ex.name}`}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <div className="grid grid-cols-[1fr_1fr_24px] gap-2 px-0.5">
                    <span className="eyebrow text-[9px]">Reps</span>
                    <span className="eyebrow text-[9px]">Weight (lb)</span>
                  </div>
                  {ex.sets.map((set, setIndex) => (
                    <div key={setIndex} className="grid grid-cols-[1fr_1fr_24px] items-center gap-2">
                      <input
                        value={set.reps}
                        onChange={(e) => updateSet(exIndex, setIndex, 'reps', e.target.value)}
                        inputMode="numeric"
                        className={inputClass}
                      />
                      <input
                        value={set.weight}
                        onChange={(e) => updateSet(exIndex, setIndex, 'weight', e.target.value)}
                        inputMode="decimal"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeSet(exIndex, setIndex)}
                        aria-label="Remove set"
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addSet(exIndex)}
                  className="mt-2 text-[11px] font-medium text-primary transition-opacity hover:opacity-80"
                >
                  + Add set
                </button>
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save session'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}