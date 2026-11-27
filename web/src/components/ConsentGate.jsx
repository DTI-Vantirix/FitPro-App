import { useEffect, useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { api } from '@/api/client';
import { CONSENT_VERSION } from '@/lib/consent';

export default function ConsentGate() {
  const [state, setState] = useState('loading');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.auth
      .me()
      .then((user) => setState(user?.consent_version === CONSENT_VERSION ? 'ok' : 'needed'))
      .catch(() => setState('needed'));
  }, []);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.auth.updateMe({
        consent_version: CONSENT_VERSION,
        consent_accepted_at: new Date().toISOString(),
      });
      setState('ok');
    } catch (err) {
      setError(err?.message || 'Could not save your choice. Try again.');
    }
    setBusy(false);
  };

  if (state === 'ok') return <Outlet />;

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-md space-y-5 p-6">
        <div>
          <p className="eyebrow">Before your first run</p>
          <h1 className="mt-1 font-heading text-xl leading-tight">Your training data, in your hands</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            VantraRun records health and location data, so we ask once before using it. Nothing is shared or sold.
          </p>
        </div>

        <ul className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Location</span> — your GPS route, only while a run is
            tracking.
          </li>
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Heart rate</span> — readings from a strap you pair; the
            browser talks to it directly.
          </li>
          <li className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <span className="font-medium text-foreground">Training numbers</span> — age, height and weight, used only
            to build your pace zones.
          </li>
        </ul>

        <label className="flex cursor-pointer items-start gap-2.5 text-[11px] leading-relaxed text-foreground">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded accent-primary"
          />
          <span>
            I agree to VantraRun storing my health and location data as described in the{' '}
            <Link to="/privacy" className="text-primary hover:underline">
              privacy policy
            </Link>
            , and I understand I can delete it at any time.
          </span>
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="button"
          onClick={accept}
          disabled={!agreed || busy}
          className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Agree and continue'}
        </button>
      </div>
    </div>
  );
}