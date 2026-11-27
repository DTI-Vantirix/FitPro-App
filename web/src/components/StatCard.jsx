import { useEffect, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Spotlight metric card — counts up on load, then reveals the trend chip
 * and its context line in sequence.
 */
export default function StatCard({
  label,
  value,
  format = (n) => Math.round(n).toLocaleString('en-US'),
  unit,
  delta,
  deltaLabel = 'vs last week',
  caption,
  className,
}) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const raf = useRef(null);

  useEffect(() => {
    setRevealed(false);
    const start = performance.now();
    const duration = 1100;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setDisplay(target * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setRevealed(true);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  const positive = (delta ?? 0) >= 0;

  return (
    <section
      className={cn(
        'relative flex min-h-[192px] flex-col justify-between overflow-hidden rounded-3xl border border-border bg-card p-5 sm:p-6',
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="vr-label">{label}</p>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className={cn(
              'flex items-center gap-1 rounded-full bg-background px-3 py-1 transition-all duration-700',
              positive ? 'text-primary' : 'text-foreground',
              revealed ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
            )}
          >
            <TrendingUp className={cn('h-3.5 w-3.5', !positive && 'rotate-180')} strokeWidth={2} />
            <span className="num text-[15px]">
              {positive ? '+' : '−'}
              {Math.abs(delta ?? 0)}%
            </span>
          </div>
          <span
            className={cn(
              'vr-label text-[10px] transition-all delay-100 duration-700',
              revealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
            )}
          >
            {deltaLabel}
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="vr-display text-[clamp(3.5rem,10vw,5.5rem)] tabular-nums text-foreground">
            {format(display)}
          </span>
          {unit ? <span className="vr-label text-xs">{unit}</span> : null}
        </div>
        {caption ? (
          <span
            className={cn(
              'pb-1 text-[11px] leading-tight text-muted-foreground transition-all duration-700',
              revealed ? 'opacity-100' : 'opacity-0'
            )}
          >
            {caption}
          </span>
        ) : null}
      </div>
    </section>
  );
}
