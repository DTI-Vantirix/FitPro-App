import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { api } from '@/api/client';

export default function AccessGate() {
  const [state, setState] = useState('checking');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then((u) => {
        if (alive) setEmail(u?.email || '');
      })
      .catch(() => {});
    api.functions
      .invoke('inviteAccess', { action: 'status' })
      .then((res) => {
        if (alive) setState(res.data?.allowed ? 'allowed' : 'blocked');
      })
      .catch(() => {
        if (alive) {
          setState('blocked');
          setError('Could not check your access. Try again in a moment.');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('inviteAccess', { action: 'redeem', code });
      if (res.data?.allowed) {
        setState('allowed');
      } else {
        setError(res.data?.error || 'That code did not work.');
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'That code did not work.');
    }
    setBusy(false);
  };

  if (state === 'allowed') return <Outlet />;

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="panel w-full max-w-sm p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-heading text-2xl font-extrabold leading-tight">Invite only</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          FitPro is open to a small group of testers. Enter the single-use code you were given to unlock the app.
        </p>

        <label className="mt-5 block">
          <span className="eyebrow">Invite code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="FP-XXXX-XXXX"
            autoCapitalize="characters"
            className="num mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-3 text-center text-base tracking-[0.12em] outline-none placeholder:text-muted-foreground/50 focus:border-primary/60"
          />
        </label>

        {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}

        <button
          type="button"
          onClick={redeem}
          disabled={busy || code.trim().length < 6}
          className="mt-4 w-full rounded-full bg-primary py-3.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Unlock FitPro'}
        </button>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="truncate text-[10px] text-muted-foreground">{email}</p>
          <button
            type="button"
            onClick={() => api.auth.logout()}
            className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}