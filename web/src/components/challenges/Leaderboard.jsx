import { Trophy } from 'lucide-react';
import { formatValue } from '@/lib/challenges';
import { cn } from '@/lib/utils';

// Ranked rows showing one number per athlete and nothing else.
export default function Leaderboard({ rows, metric, target, meId }) {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-xs text-muted-foreground">
        Nobody has joined yet — be the first and set the pace.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => {
        const pct = target > 0 ? Math.min(100, Math.round((row.value / target) * 100)) : 0;
        const mine = row.user_id === meId;
        return (
          <div
            key={row.user_id}
            className={cn(
              'rounded-xl border px-3 py-2.5',
              mine ? 'border-primary/40 bg-primary/5' : 'border-border bg-secondary/30'
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'tabular-nums w-4 shrink-0 text-center text-xs',
                  i === 0 ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase',
                  i === 0 ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary'
                )}
              >
                {(row.name || row.handle || '?').slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-heading text-sm">
                  {row.name}
                  {mine && <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-primary">you</span>}
                </p>
                <p className="vr-label truncate text-[10px]">
                  @{row.handle}
                </p>
              </div>
              <span className="num shrink-0 text-sm">{formatValue(metric, row.value)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {rows[0]?.value > 0 && (
        <p className="flex items-center gap-1.5 px-1 pt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <Trophy className="h-3 w-3 text-primary" /> {rows[0].name} leads
        </p>
      )}
    </div>
  );
}