import { formatPace } from '@/lib/format';
import { zoneRangeLabel } from '@/lib/zones';
import { cn } from '@/lib/utils';

const TONE = {
  on: 'border-primary bg-card text-primary',
  fast: 'border-foreground/50 bg-card text-foreground',
  slow: 'border-foreground/50 bg-card text-foreground',
  unknown: 'border-border bg-secondary text-muted-foreground',
};

export default function PaceReadout({ pace, zone, status }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Current pace</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-[clamp(3.2rem,14vw,4.6rem)] leading-[0.85] text-foreground">
            {formatPace(pace)}
          </span>
          <span className="vr-label text-[11px]">/mi</span>
        </div>
      </div>
      <div className={cn('rounded-2xl border px-3.5 py-2.5 text-right transition-colors', TONE[status.key] || TONE.unknown)}>
        <p className="font-heading text-sm leading-none">{status.label}</p>
        <p className="vr-label mt-1.5 text-[10px] opacity-80">
          {zone ? `${zone.name} · ${zoneRangeLabel(zone)}` : 'Pick a zone'}
        </p>
      </div>
    </div>
  );
}