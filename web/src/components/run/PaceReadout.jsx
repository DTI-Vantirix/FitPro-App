import { formatPace } from '@/lib/format';
import { zoneRangeLabel } from '@/lib/zones';
import { cn } from '@/lib/utils';

const TONE = {
  on: 'border-primary/45 bg-primary/10 text-primary',
  fast: 'border-[#FF6A3D]/45 bg-[#FF6A3D]/10 text-[#FF9B78]',
  slow: 'border-[#FFC24B]/45 bg-[#FFC24B]/10 text-[#FFD27D]',
  unknown: 'border-border bg-secondary text-muted-foreground',
};

export default function PaceReadout({ pace, zone, status }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">Current pace</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-[clamp(3.2rem,14vw,4.6rem)] font-medium leading-[0.85] text-foreground">
            {formatPace(pace)}
          </span>
          <span className="num text-[11px] uppercase tracking-[0.18em] text-muted-foreground">/mi</span>
        </div>
      </div>
      <div className={cn('rounded-2xl border px-3.5 py-2.5 text-right transition-colors', TONE[status.key] || TONE.unknown)}>
        <p className="font-heading text-sm font-semibold leading-none">{status.label}</p>
        <p className="num mt-1.5 text-[10px] uppercase tracking-[0.12em] opacity-80">
          {zone ? `${zone.name} · ${zoneRangeLabel(zone)}` : 'Pick a zone'}
        </p>
      </div>
    </div>
  );
}