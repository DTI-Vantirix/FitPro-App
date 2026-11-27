import { useState } from 'react';
import { api } from '@/api/client';

// The invite code field and its button, as the "Invite only" gate has always shown
// them. Used there and at the bottom of the paywall. `onAllowed` runs once a code
// has opened the account.
export default function InviteCodeForm({ onAllowed, initialError = null }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('inviteAccess', { action: 'redeem', code });
      if (res.data?.allowed) {
        onAllowed();
        return;
      }
      setError(res.data?.error || 'That code did not work.');
    } catch (err) {
      setError(err?.response?.data?.error || 'That code did not work.');
    }
    setBusy(false);
  };

  return (
    <>
      <label className="mt-5 block">
        <span className="eyebrow">Invite code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="FP-XXXX-XXXX"
          autoCapitalize="characters"
          className="num mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-3 text-center text-base tracking-[0.12em] placeholder:text-muted-foreground/50 focus:border-primary"
        />
      </label>

      {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={redeem}
        disabled={busy || code.trim().length < 6}
        className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
      >
        {busy ? 'Checking…' : 'Unlock VantraRun'}
      </button>
    </>
  );
}
