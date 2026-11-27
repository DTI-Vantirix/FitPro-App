import { Bluetooth, HeartPulse, Unplug } from 'lucide-react';
import { zoneColor } from '@/lib/zones';
import { cn } from '@/lib/utils';

export default function HeartRateCard({ heart, hrMax = 0, zones = [] }) {
  const { supported, status, bpm, deviceName, error, stats, connect, disconnect } = heart;
  const pct = hrMax && bpm ? (bpm / hrMax) * 100 : 0;
  const zone = pct ? zones.find((z) => pct >= (z.hr_min_pct ?? 0) && pct < (z.hr_max_pct ?? 200)) : null;

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <HeartPulse
            className={cn('h-4 w-4 shrink-0', status === 'connected' ? 'text-primary' : 'text-muted-foreground')}
            strokeWidth={2}
          />
          <div className="min-w-0">
            <p className="eyebrow">Heart rate</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {status === 'connected'
                ? deviceName
                : status === 'connecting'
                  ? 'Pairing…'
                  : 'No monitor connected'}
            </p>
          </div>
        </div>

        {status === 'connected' ? (
          <button
            type="button"
            onClick={disconnect}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Unplug className="h-3 w-3" /> Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={!supported || status === 'connecting'}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
          >
            <Bluetooth className="h-3 w-3" />
            {status === 'connecting' ? 'Pairing…' : 'Connect'}
          </button>
        )}
      </div>

      {status === 'connected' && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="num text-4xl leading-none">
            {bpm || '––'}
            <span className="ml-1.5 tabular-nums text-xs font-normal text-muted-foreground">bpm</span>
          </p>
          <div className="text-right">
            {zone && (
              <p className="text-xs font-semibold" style={{ color: zoneColor(zone) }}>
                {zone.name}
              </p>
            )}
            {pct ? (
              <p className="vr-label mt-0.5 text-[10px]">
                {Math.round(pct)}% of max
              </p>
            ) : null}
          </div>
        </div>
      )}

      {status === 'connected' && stats.avg ? (
        <p className="vr-label mt-2 text-[10px]">
          avg {stats.avg} · max {stats.max}
        </p>
      ) : null}

      {!supported && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          This browser cannot reach Bluetooth monitors. Open VantraRun in Chrome on Android or on a desktop to pair a
          strap. On an iPhone, Bluetooth pairing needs a native app build.
        </p>
      )}

      {error && <p className="mt-2 text-[11px] leading-relaxed text-destructive">{error}</p>}

      {supported && status === 'idle' && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Pair a chest strap (Polar H10, Garmin HRM, Wahoo TICKR) or a watch with Broadcast Heart Rate switched on.
        </p>
      )}
    </div>
  );
}