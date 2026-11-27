import { hrLabel, zoneColor, zoneRangeLabel } from '@/lib/zones';

export default function ZoneTable({ zones = [], renderActions }) {
  return (
    <ul className="space-y-2">
      {zones.map((zone) => (
        <li key={zone.id || zone.name} className="panel flex items-stretch gap-3 p-4">
          <span
            className="w-1.5 shrink-0 rounded-full"
            style={{ background: zoneColor(zone) }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-heading text-sm leading-tight">
                {zone.name}
                {zone.intensity ? (
                  <span className="ml-2 vr-label text-[10px] font-normal">
                    {zone.intensity}
                  </span>
                ) : null}
              </p>
              <p className="num text-sm text-primary">
                {zoneRangeLabel(zone)}
                <span className="ml-1 text-[10px] text-muted-foreground">/mi</span>
              </p>
            </div>
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {[hrLabel(zone), zone.purpose].filter(Boolean).join(' · ')}
            </p>
            {zone.feel ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{zone.feel}</p>
            ) : null}
          </div>
          {renderActions ? <div className="flex shrink-0 items-start gap-1">{renderActions(zone)}</div> : null}
        </li>
      ))}
    </ul>
  );
}