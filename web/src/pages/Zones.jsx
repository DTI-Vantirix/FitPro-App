import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import ZoneEditor from '@/components/zones/ZoneEditor';
import ZoneTable from '@/components/zones/ZoneTable';
import { sortZones } from '@/lib/zones';
import { applyZones, loadProfile } from '@/lib/profile';

export default function Zones() {
  const [zones, setZones] = useState(null);
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.entities.PaceZone.list({ sort: 'fast_sec', limit: 20 })
      .then((page) => setZones(sortZones(page.items || [])))
      .catch((err) => {
        setError(err.message);
        setZones([]);
      });
    loadProfile().then(setProfile).catch(() => {});
  }, []);

  const rebuild = async () => {
    if (!profile?.threshold_sec) return;
    setBusy(true);
    setError(null);
    try {
      const list = await applyZones(profile.threshold_sec);
      setZones(sortZones(list));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const saveZone = async (values) => {
    setBusy(true);
    if (editing?.id) {
      const updated = await api.entities.PaceZone.update(editing.id, {
        ...values,
        sort_order: editing.sort_order || 0,
      });
      setZones((list) => sortZones((list || []).map((z) => (z.id === editing.id ? { ...z, ...updated } : z))));
    } else {
      const created = await api.entities.PaceZone.create({
        ...values,
        sort_order: (zones?.length || 0) + 1,
      });
      setZones((list) => sortZones([...(list || []), created]));
    }
    setBusy(false);
    setOpen(false);
    setEditing(null);
  };

  const remove = async (zone) => {
    setZones((list) => (list || []).filter((z) => z.id !== zone.id));
    await api.entities.PaceZone.delete(zone.id);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Live pace feedback</p>
          <h1 className="mt-2 font-heading text-3xl font-extrabold leading-none">Pace zones</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {zones?.length > 0 && profile?.threshold_sec ? (
            <button
              type="button"
              onClick={rebuild}
              disabled={busy}
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2.5 font-heading text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" /> {busy ? 'Updating…' : 'Rebuild'}
            </button>
          ) : null}
          <Link
            to="/settings"
            className="rounded-full border border-border px-4 py-2.5 font-heading text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            Profile
          </Link>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {zones?.length > 0 && zones.every((zone) => zone.zone_number == null) && (
        <Link
          to="/settings"
          className="block rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground"
        >
          <span className="font-heading text-sm font-bold text-primary">These zones use the old setup</span>
          <span className="mt-1 block">
            Add your age, height and weight in Settings to rebuild them as Zone 1–5 with heart-rate bands and pace
            ranges from your own threshold.
          </span>
        </Link>
      )}

      {zones === null ? (
        <div className="panel h-40 animate-pulse" />
      ) : zones.length === 0 ? (
        <div className="panel p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Check className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-heading text-lg font-bold">
            {profile ? 'Build your five zones' : 'Your zones come from your body, not a guess'}
          </h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
            {profile
              ? 'Your profile is set. VantraRun turns it into five pace zones, each with its heart-rate band and talk test.'
              : 'Add your age, height and weight and VantraRun estimates your max heart rate, VO2max and threshold pace — then builds the five zones around it.'}
          </p>
          {profile ? (
            <button
              type="button"
              onClick={rebuild}
              disabled={busy}
              className="mt-4 rounded-full bg-primary px-5 py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
            >
              {busy ? 'Building…' : 'Create my zones'}
            </button>
          ) : (
            <Link
              to="/settings"
              className="mt-4 inline-block rounded-full bg-primary px-5 py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95"
            >
              Set my profile
            </Link>
          )}
        </div>
      ) : (
        <ZoneTable
          zones={zones}
          renderActions={(zone) => (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(zone);
                  setOpen(true);
                }}
                aria-label={`Edit ${zone.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(zone)}
                aria-label={`Delete ${zone.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        />
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Pick a target zone before each run — VantraRun tells you the moment you drift faster or slower than that band.
        Change the zone per route any time from the route card.
      </p>

      <ZoneEditor
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        zone={editing}
        onSave={saveZone}
      />
    </div>
  );
}