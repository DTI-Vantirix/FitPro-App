import { zoneRangeLabel } from '@/lib/zones';
import { cn } from '@/lib/utils';

export default function ZonePicker({ zones = [], value, onChange, label = 'Target zone' }) {
  if (!zones.length) return null;
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {zones.map((zone) => {
          const active = zone.id === value;
          return (
            <button
              key={zone.id}
              type="button"
              onClick={() => onChange(zone.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: zone.color || '#C9F84A' }} />
              <span>{zone.name}</span>
              <span className="num text-[10px] opacity-60">{zoneRangeLabel(zone)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}