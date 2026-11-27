import { cn } from '@/lib/utils';

const TONES = {
  live: 'border-primary/30 bg-primary/10 text-primary',
  setup: 'border-border bg-card text-foreground',
  later: 'border-border bg-secondary text-muted-foreground',
};

const DEVICES = [
  {
    name: 'Polar H9 / H10',
    tone: 'live',
    tag: 'Live now',
    note: 'Broadcasts the standard Bluetooth heart-rate service. Pair it here and the reading streams through the run.',
  },
  {
    name: 'Garmin HRM-Dual / HRM-Pro',
    tone: 'live',
    tag: 'Live now',
    note: 'Same Bluetooth heart-rate service. Turn the strap on and pair it — no Garmin account needed.',
  },
  {
    name: 'Wahoo TICKR · COROS · Coospo',
    tone: 'live',
    tag: 'Live now',
    note: 'Any strap advertising the standard heart-rate service streams live.',
  },
  {
    name: 'Garmin watches (Forerunner, Fēnix, Epix, Venu)',
    tone: 'setup',
    tag: 'Live via Broadcast HR',
    note: 'Switch on Settings → Sensors & Accessories → Broadcast Heart Rate on the watch, then pair it here. Full activity and health sync is a separate connection: Garmin’s Connect Developer Program (a personal API key for your own data, pull only, or a business key), which we can add next.',
  },
  {
    name: 'Apple Watch',
    tone: 'later',
    tag: 'Native app only',
    note: 'Apple Health data can only be read by an iOS app through HealthKit — there is no web or cloud API, and no live stream. The iPhone build of VantraRun is the route in.',
  },
  {
    name: 'Samsung Galaxy Watch · Wear OS',
    tone: 'later',
    tag: 'Native app only',
    note: 'Read through Health Connect from an Android app. Same native-build requirement.',
  },
  {
    name: 'WHOOP · Oura',
    tone: 'later',
    tag: 'Vendor API',
    note: 'Cloud access is granted per partner after review, and it delivers completed sessions, not live heart rate.',
  },
];

export default function DeviceSupportList() {
  return (
    <ul className="divide-y divide-border">
      {DEVICES.map((device) => (
        <li key={device.name} className="py-4 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <p className="font-heading text-sm leading-tight">{device.name}</p>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1 vr-label text-[9px]',
                TONES[device.tone]
              )}
            >
              {device.tag}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{device.note}</p>
        </li>
      ))}
    </ul>
  );
}