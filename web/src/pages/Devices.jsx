import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/api/client';
import HeartRateCard from '@/components/run/HeartRateCard';
import DeviceSupportList from '@/components/devices/DeviceSupportList';
import useHeartRate from '@/hooks/useHeartRate';
import { loadProfile } from '@/lib/profile';
import { sortZones } from '@/lib/zones';

export default function Devices() {
  const heart = useHeartRate();
  const [profile, setProfile] = useState(null);
  const [zones, setZones] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([loadProfile(), api.entities.PaceZone.list({ sort: 'fast_sec', limit: 20 })])
      .then(([userProfile, zonePage]) => {
        if (!alive) return;
        setProfile(userProfile);
        setZones(sortZones(zonePage.items || []));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to="/settings"
          aria-label="Back to settings"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="eyebrow">Sensors</p>
          <h1 className="font-heading text-lg font-bold leading-tight">Devices</h1>
        </div>
      </div>

      <section className="panel space-y-3 p-5">
        <div>
          <h2 className="font-heading text-base font-bold">Live heart rate</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Pair a Bluetooth heart-rate monitor and every run records your average and max heart rate alongside pace.
          </p>
        </div>
        <HeartRateCard heart={heart} hrMax={profile?.hr_max || 0} zones={zones} />
        {!profile?.hr_max && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Add your age in Settings so a reading tells you which zone you are in.
          </p>
        )}
      </section>

      <section className="panel space-y-3 p-5">
        <div>
          <h2 className="font-heading text-base font-bold">Your watch, automatically</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            While you run, tracking uses the phone’s own GPS — nothing to pair. Finished sessions from your watch
            will arrive on their own once the watch connections below are live. There is nothing to export or
            import.
          </p>
        </div>
        <ul className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Garmin</span> — a Garmin Connect connection, so recent
            activities land in FitPro without you doing anything.
          </li>
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Apple Watch</span> — Apple Health (HealthKit), read by the
            iOS app.
          </li>
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Samsung · Wear OS · Pixel Watch</span> — Health Connect,
            read by the Android app.
          </li>
        </ul>
      </section>

      <section className="panel space-y-4 p-5">
        <div>
          <h2 className="font-heading text-base font-bold">What connects today</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Strap and watch heart rate uses the standard Bluetooth profile, so it works without any account or
            approval. Watches deliver their own recordings through their maker’s platform, which each gate differently.
          </p>
        </div>
        <DeviceSupportList />
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Pairing runs in the browser: Chrome, Edge or Samsung Internet — on Android or a computer. Safari and the
        iPhone browser cannot talk to Bluetooth devices, so on iPhone this needs the native app build.
      </p>
    </div>
  );
}