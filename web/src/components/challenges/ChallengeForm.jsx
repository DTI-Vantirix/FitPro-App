import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/api/client';
import { METRICS, METRIC_ORDER, monthOptions, monthWindow } from '@/lib/challenges';
import { cn } from '@/lib/utils';

export default function ChallengeForm({ open, onOpenChange, profile, onCreate }) {
  const months = monthOptions(3);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState('distance');
  const [target, setTarget] = useState(METRICS.distance.goalHint);
  const [month, setMonth] = useState(months[0].key);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const pickMetric = (id) => {
    setMetric(id);
    setTarget(METRICS[id].goalHint);
  };

  const create = async () => {
    const value = Number(target);
    if (!value || value <= 0) {
      setError('Set a goal above zero.');
      return;
    }
    setSaving(true);
    setError(null);
    const win = monthWindow(month);
    const created = await api.entities.Challenge.create({
      name: name.trim(),
      description: description.trim(),
      metric,
      target_value: value,
      month,
      start_date: win.start_date,
      end_date: win.end_date,
      creator_handle: profile?.handle || '',
    });
    setSaving(false);
    setName('');
    setDescription('');
    onCreate?.(created);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">New challenge group</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="eyebrow">Group name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="November 100"
              className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>

          <label className="block">
            <span className="eyebrow">What it's for</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="100 miles before the month is out"
              className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>

          <div>
            <p className="eyebrow mb-2">Competes on</p>
            <div className="flex flex-wrap gap-2">
              {METRIC_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickMetric(id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[11px] transition-colors',
                    metric === id
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {METRICS[id].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Only this number is ever shown to the group — routes, splits and run times stay private.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow">Monthly goal</span>
              <div className="mt-1.5 flex items-center gap-1 rounded-xl border border-border bg-secondary/60 px-3 py-2.5 focus-within:border-primary/60">
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  className="num min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {METRICS[metric].unit}
                </span>
              </div>
            </label>
            <label className="block">
              <span className="eyebrow">Month</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm outline-none focus:border-primary/60"
              >
                {months.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="button"
            onClick={create}
            disabled={saving || !name.trim() || !target}
            className="w-full rounded-full bg-primary py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            {saving ? 'Creating…' : 'Create challenge'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}