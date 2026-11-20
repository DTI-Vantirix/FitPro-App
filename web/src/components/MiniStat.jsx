import { cn } from '@/lib/utils';

export default function MiniStat({ icon: Icon, label, value, unit, caption, className, accent }) {
  return (
    <div
      className={cn(
        'panel flex flex-col justify-between gap-3 p-4 transition-colors hover:border-border/80 hover:bg-secondary/60 sm:p-5',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {Icon ? (
          <Icon className={cn('h-4 w-4', accent ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-2xl font-medium leading-none text-foreground sm:text-[26px]">{value}</span>
        {unit ? <span className="num text-[10px] uppercase tracking-widest text-muted-foreground">{unit}</span> : null}
      </div>
      {caption ? <p className="text-[11px] leading-tight text-muted-foreground">{caption}</p> : null}
    </div>
  );
}