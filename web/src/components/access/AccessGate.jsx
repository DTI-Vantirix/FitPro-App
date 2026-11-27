import { useCallback, useEffect, useState } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { NO_ACCESS_EVENT, api } from '@/api/client';
import InviteCodeForm from '@/components/access/InviteCodeForm';
import Paywall from '@/components/access/Paywall';

// Stands between a signed-in person and the app. With access, the app. Without:
// the "Invite only" card while nothing is for sale, or the paywall when the server
// says it is selling subscriptions. The server enforces the same rule on every call;
// this only decides what to show.

// The gate as it has been since sign-up needed an invite code.
function InviteOnlyCard({ email, error, onAllowed }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="panel w-full max-w-sm p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-heading text-2xl leading-tight">Invite only</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          VantraRun is open to a small group of testers. Enter the single-use code you were given to unlock the app.
        </p>

        <InviteCodeForm onAllowed={onAllowed} initialError={error} />

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

export default function AccessGate() {
  const [state, setState] = useState('checking');
  const [subscriptions, setSubscriptions] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [params, setParams] = useSearchParams();

  // true or false as the server answers; null when it could not be asked.
  const check = useCallback(async () => {
    try {
      const res = await api.functions.invoke('inviteAccess', { action: 'status' });
      setSubscriptions(Boolean(res.data?.subscriptions));
      return Boolean(res.data?.allowed);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then((u) => {
        if (alive) setEmail(u?.email || '');
      })
      .catch(() => {});
    check().then((allowed) => {
      if (!alive) return;
      if (allowed === null) setError('Could not check your access. Try again in a moment.');
      setState(allowed ? 'allowed' : 'blocked');
    });
    return () => {
      alive = false;
    };
  }, [check]);

  // Access can end while the app is open (a refund, a pass taken back, a period that ran
  // out). The server then refuses the next call; the client says so with this event, and
  // the gate asks again and shows the way back in instead of a screen of failed requests.
  useEffect(() => {
    if (state !== 'allowed') return undefined;
    let alive = true;
    const onRefused = async () => {
      const allowed = await check();
      if (alive && allowed === false) {
        setError(null);
        setState('blocked');
      }
    };
    window.addEventListener(NO_ACCESS_EVENT, onRefused);
    return () => {
      alive = false;
      window.removeEventListener(NO_ACCESS_EVENT, onRefused);
    };
  }, [state, check]);

  // Back from checkout with the account already open: nothing to confirm, tidy the address.
  useEffect(() => {
    if (state !== 'allowed' || !params.has('checkout')) return;
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  }, [state, params, setParams]);

  const allow = useCallback(() => setState('allowed'), []);

  if (state === 'allowed') return <Outlet />;

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  const inviteOnly = <InviteOnlyCard email={email} error={error} onAllowed={allow} />;
  return subscriptions ? <Paywall email={email} onAllowed={allow} fallback={inviteOnly} /> : inviteOnly;
}
