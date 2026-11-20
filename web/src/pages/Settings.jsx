import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import ZoneTable from '@/components/zones/ZoneTable';
import DataControls from '@/components/privacy/DataControls';
import InviteCodesCard from '@/components/admin/InviteCodesCard';
import SocialProfileCard from '@/components/social/SocialProfileCard';
import AccountCard from '@/components/settings/AccountCard';
import { estimateZones, zoneTemplate } from '@/lib/zones';
import { applyZones, loadProfile, saveProfile } from '@/lib/profile';
import { formatPace, parsePace } from '@/lib/format';

const field =
  'mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60';

export default function Settings() {
  const [form, setForm] = useState({ age: '35', sex: 'male', height_in: '70', weight_lb: '170' });
  const [override, setOverride] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    loadProfile()
      .then((profile) => {
        if (!alive || !profile) return;
        setForm({
          age: String(profile.age ?? 35),
          sex: profile.sex || 'male',
          height_in: String(profile.height_in ?? 70),
          weight_lb: String(profile.weight_lb ?? 170),
        });
        if (
          profile.threshold_sec &&
          profile.auto_threshold_sec &&
          Math.abs(profile.threshold_sec - profile.auto_threshold_sec) > 3
        ) {
          setOverride(formatPace(profile.threshold_sec));
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const estimate = useMemo(() => estimateZones(form), [form]);
  const manualSec = parsePace(override);
  const thresholdSec = manualSec || estimate.threshold_sec;
  const zones = useMemo(
    () => zoneTemplate(thresholdSec).map((zone) => ({ ...zone, id: `preview-${zone.zone_number}` })),
    [thresholdSec]
  );

  const valid =
    Number(form.age) >= 12 &&
    Number(form.age) <= 90 &&
    Number(form.height_in) >= 40 &&
    Number(form.height_in) <= 90 &&
    Number(form.weight_lb) >= 60 &&
    Number(form.weight_lb) <= 500;

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await saveProfile({
        age: Number(form.age),
        sex: form.sex,
        height_in: Number(form.height_in),
        weight_lb: Number(form.weight_lb),
        hr_max: estimate.hr_max,
        vo2max: estimate.vo2max,
        threshold_sec: thresholdSec,
        auto_threshold_sec: estimate.threshold_sec,
      });
      await applyZones(thresholdSec);
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to="/zones"
          aria-label="Back to pace zones"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="eyebrow">Training profile</p>
          <h1 className="font-heading text-lg font-bold leading-tight">Settings</h1>
        </div>
      </div>

      {loading ? (
        <div className="panel h-48 animate-pulse" />
      ) : (
        <>
          <section className="panel space-y-4 p-5">
            <div>
              <h2 className="font-heading text-base font-bold">Your numbers</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Age, height and weight give FitPro your max heart rate and threshold pace, which set the five zones.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow">Age</span>
                <input
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  inputMode="numeric"
                  className={`num ${field}`}
                />
              </label>
              <label className="block">
                <span className="eyebrow">Sex</span>
                <select
                  value={form.sex}
                  onChange={(e) => setForm({ ...form, sex: e.target.value })}
                  className={field}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label className="block">
                <span className="eyebrow">Height (in)</span>
                <input
                  value={form.height_in}
                  onChange={(e) => setForm({ ...form, height_in: e.target.value })}
                  inputMode="numeric"
                  className={`num ${field}`}
                />
              </label>
              <label className="block">
                <span className="eyebrow">Weight (lb)</span>
                <input
                  value={form.weight_lb}
                  onChange={(e) => setForm({ ...form, weight_lb: e.target.value })}
                  inputMode="numeric"
                  className={`num ${field}`}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border">
              {[
                { label: 'Max HR', value: `${estimate.hr_max}`, unit: 'bpm' },
                { label: 'VO₂ max', value: `${estimate.vo2max}`, unit: 'ml/kg' },
                { label: 'Threshold', value: formatPace(thresholdSec), unit: '/mi' },
              ].map((stat) => (
                <div key={stat.label} className="bg-card px-3 py-3">
                  <p className="eyebrow text-[9px]">{stat.label}</p>
                  <p className="num mt-1 text-lg leading-none">{stat.value}</p>
                  <p className="num mt-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{stat.unit}</p>
                </div>
              ))}
            </div>

            <label className="block">
              <span className="eyebrow">Threshold pace override (optional)</span>
              <input
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder={formatPace(estimate.threshold_sec)}
                inputMode="numeric"
                className={`num ${field}`}
              />
              <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">
                The pace you could hold for about an hour. Leave it empty to use the estimate.
              </span>
            </label>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              type="button"
              onClick={save}
              disabled={busy || !valid}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save and update my zones'}
            </button>

            {done && (
              <p className="flex items-center gap-2 text-xs text-primary">
                <Check className="h-3.5 w-3.5" /> Saved. Your five pace zones are up to date.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-heading text-base font-bold">Your five zones</h2>
              <Link to="/zones" className="text-xs text-primary hover:underline">
                Manage zones
              </Link>
            </div>
            <ZoneTable zones={zones} />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Heart-rate bands follow the standard five-zone model as a percent of max HR. Pace bands are built from
              threshold pace, so a Zone 2 run lands where your breathing still allows a full conversation. Max HR is
              estimated with the Tanaka formula (208 − 0.7 × age) and VO₂ max with a moderate activity level assumed —
              your own threshold pace wins when you enter one.
            </p>
          </section>

          <Link
            to="/devices"
            className="panel flex items-center justify-between gap-3 p-5 transition-colors hover:border-primary/40"
          >
            <div>
              <p className="font-heading text-sm font-bold">Devices</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pair a heart-rate strap for live bpm, and see what each watch needs.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          <AccountCard />

          <SocialProfileCard />

          <InviteCodesCard />

          <DataControls />
        </>
      )}
    </div>
  );
}