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
        'group grain relative flex min-h-[192px] flex-col justify-between overflow-hidden rounded-3xl p-5 sm:p-6',
        'transition-[transform,box-shadow] duration-500 [transition-timing-function:cubic-bezier(0.34,1.2,0.64,1)]',
        'hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(0,0,0,0.45)]',
        className
      )}
      style={{
        background:
          'linear-gradient(to bottom, #F3FFBC 2%, #D9E9A4 26%, #96A96E 38%, #17180F 86%)',
      }}
    >
      <div className="relative z-[2] flex items-start justify-between gap-4">
        <p className="text-[15px] leading-tight tracking-tight text-[#22240F]">{label}</p>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className={cn(
              'flex items-center gap-1 rounded-lg bg-[#22240F] px-3 py-1 transition-all duration-700',
              'hover:scale-105',
              revealed ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
            )}
          >
            <TrendingUp
              className={cn('h-3.5 w-3.5', positive ? 'text-[#E9FFA8]' : 'rotate-180 text-[#FFB4A0]')}
              strokeWidth={2}
            />
            <span className="num text-[15px] font-medium text-[#E9FFA8]">
              {Math.abs(delta ?? 0)}%
            </span>
          </div>
          <span
            className={cn(
              'num text-[10px] uppercase tracking-[0.14em] text-[#2A2C14]/70 transition-all delay-100 duration-700',
              revealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
            )}
          >
            {deltaLabel}
          </span>
        </div>
      </div>

      <div className="relative z-[2] flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="num text-[clamp(3rem,9vw,4.5rem)] font-normal leading-[0.85] text-[#E9FFA8] transition-colors duration-500 group-hover:text-white">
            {format(display)}
          </span>
          {unit ? (
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#E9FFA8]/70">
              {unit}
            </span>
          ) : null}
        </div>
        {caption ? (
          <span
            className={cn(
              'pb-1 text-[11px] leading-tight tracking-tight text-[#E9FFA8]/70 transition-all duration-700',
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