import { formatPace } from '@/lib/format';

export default function SplitsList({ splits = [], limit }) {
  const rows = limit ? splits.slice(-limit).reverse() : [...splits].reverse();
  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">Your mile splits appear here as you pass each mile.</p>;
  }
  const fastest = Math.min(...splits.map((s) => s.pace_sec));
  return (
    <ul className="space-y-1.5">
      {rows.map((split) => (
        <li key={split.mile} className="flex items-center gap-3">
          <span className="num w-12 shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            mile {split.mile}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary/70"
              style={{ width: `${Math.min(100, (fastest / split.pace_sec) * 100)}%` }}
            />
          </span>
          <span className="num w-11 shrink-0 text-right text-xs text-foreground">{formatPace(split.pace_sec)}</span>
        </li>
      ))}
    </ul>
  );
}