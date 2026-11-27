import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { api } from '@/api/client';
import InviteCodeForm from '@/components/access/InviteCodeForm';
import DeleteAccountDialog from '@/components/privacy/DeleteAccountDialog';
import { ANNUAL_SAVING, PLANS, REFUND_DAYS, SUPPORT_EMAIL, TRIAL_DAYS, planById } from '@/lib/plans';

// What a signed-in person without access sees when the server is selling: the two
// plans, the terms, and the way to Stripe's checkout. Paying happens on Stripe's own
// page; this screen never sees a card. `fallback` is the "Invite only" card, shown
// instead when the server is not selling. `onAllowed` opens the app.
//
// Coming back from checkout (?checkout=success) the page asks the server to confirm
// with Stripe until the account is open, so a late webhook never leaves a payer outside.
const CONFIRM_EVERY_MS = 2000;
const CONFIRM_FOR_MS = 30000;

const small = 'text-[11px] leading-relaxed text-muted-foreground';
const primaryButton =
  'mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40';

function Shell({ email, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="panel w-full max-w-md p-6">
        {children}
        <div className="mt-5 border-t border-border pt-4">
          <p className="truncate text-[10px] text-muted-foreground">{email}</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => api.auth.logout()}
              className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
            <DeleteAccountDialog>
              <button
                type="button"
                className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-destructive"
              >
                Delete account
              </button>
            </DeleteAccountDialog>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Paywall({ email, onAllowed, fallback }) {
  const [params, setParams] = useSearchParams();
  const returned = params.get('checkout');
  const [status, setStatus] = useState(null);
  const [plan, setPlan] = useState('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showCode, setShowCode] = useState(false);
  // 'waiting' while the payment is being confirmed, 'late' when it has taken too long.
  const [confirming, setConfirming] = useState(returned === 'success' ? 'waiting' : null);

  // Takes ?checkout=... out of the address once it has been acted on.
  const forgetReturn = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    if (!next.has('checkout')) return;
    next.delete('checkout');
    setParams(next, { replace: true });
  }, [setParams]);

  const open = useCallback(() => {
    forgetReturn();
    onAllowed();
  }, [forgetReturn, onAllowed]);

  useEffect(() => {
    let alive = true;
    api.functions
      .invoke('subscription', { action: 'status' })
      .then((res) => alive && setStatus((current) => current || res.data))
      .catch(() => alive && setStatus((current) => current || { selling: false }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (confirming !== 'waiting') return undefined;
    let alive = true;
    let timer;
    const started = Date.now();
    const ask = async () => {
      try {
        const res = await api.functions.invoke('subscription', { action: 'refresh' });
        if (!alive) return;
        if (res.data?.allowed) {
          open();
          return;
        }
        setStatus(res.data);
      } catch {
        // not confirmed yet; ask again
      }
      if (!alive) return;
      if (Date.now() - started >= CONFIRM_FOR_MS) setConfirming('late');
      else timer = setTimeout(ask, CONFIRM_EVERY_MS);
    };
    ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [confirming, open]);

  // Asks the server to check with Stripe once. Opens the app if the account is in.
  const refresh = async () => {
    const res = await api.functions.invoke('subscription', { action: 'refresh' });
    if (res.data?.allowed) {
      open();
      return true;
    }
    setStatus(res.data);
    return false;
  };

  const checkAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(err?.message || 'Could not check. Try again in a moment.');
    }
    setBusy(false);
  };

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('subscription', { action: 'checkout', plan });
      window.location.assign(res.data.url);
      return; // the page is leaving for Stripe
    } catch (err) {
      // "You already have ...": the account may be open already (paid in another tab).
      if (err?.status === 409 && (await refresh().catch(() => false))) return;
      setError(err?.message || 'Could not open checkout. Try again in a moment.');
    }
    setBusy(false);
  };

  const updateCard = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('subscription', { action: 'portal' });
      window.location.assign(res.data.url);
      return;
    } catch (err) {
      setError(err?.message || 'Could not open the payment page. Try again in a moment.');
    }
    setBusy(false);
  };

  if (confirming === 'waiting') {
    return (
      <Shell email={email}>
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary" />
          <h1 className="font-heading text-xl leading-tight">Confirming your subscription…</h1>
        </div>
      </Shell>
    );
  }

  if (confirming === 'late') {
    return (
      <Shell email={email}>
        <h1 className="font-heading text-2xl leading-tight">Still confirming</h1>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          We could not confirm your payment yet. If you finished checkout, wait a minute and press Check again. You
          will not be charged twice.
        </p>
        {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}
        <button type="button" onClick={checkAgain} disabled={busy} className={primaryButton}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </Shell>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  if (!status.selling && status.subscription?.status !== 'grace') return fallback;

  const inviteCode = (
    <div className="mt-5 border-t border-border pt-4">
      {showCode ? (
        <InviteCodeForm onAllowed={open} />
      ) : (
        <button
          type="button"
          onClick={() => setShowCode(true)}
          className="w-full text-center text-xs font-medium text-primary hover:underline"
        >
          I have an invite code
        </button>
      )}
    </div>
  );

  // A payment failed and the allowance has run out: the way back in is a working card.
  if (status.subscription?.status === 'grace') {
    return (
      <Shell email={email}>
        <h1 className="font-heading text-2xl leading-tight">Your last payment did not go through</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Update your card to get back in. You have not been charged.
        </p>
        {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}
        <button type="button" onClick={updateCard} disabled={busy} className={primaryButton}>
          {busy ? 'Opening…' : 'Update payment details'}
        </button>
        {inviteCode}
      </Shell>
    );
  }

  const trial = Boolean(status.trial_available);
  const chosen = planById(plan);

  return (
    <Shell email={email}>
      <h1 className="font-heading text-2xl leading-tight">
        {trial ? `Start with ${TRIAL_DAYS} days free` : 'Subscribe to VantraRun'}
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        VantraRun coaches each run against your own five zones, with routes, history and challenges.
      </p>

      {returned === 'cancelled' && (
        <p className="vr-notice mt-4 px-3.5 py-2.5 text-xs">Checkout was cancelled. Nothing was charged.</p>
      )}

      <fieldset className="mt-5 space-y-2">
        <legend className="sr-only">Plan</legend>
        {PLANS.map((option) => {
          const selected = option.id === plan;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                selected ? 'border-primary bg-primary/10' : 'border-border bg-secondary/60'
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="plan"
                  value={option.id}
                  checked={selected}
                  onChange={() => setPlan(option.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block text-sm font-semibold">{option.name}</span>
                  <span className="num block text-xs text-muted-foreground">
                    {option.price} a {option.per}
                  </span>
                </span>
              </span>
              {option.id === 'annual' && (
                <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold text-primary">
                  Save {ANNUAL_SAVING} a year
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      <div className="mt-5 space-y-2">
        <p className="text-sm font-semibold text-foreground">
          {trial
            ? `${TRIAL_DAYS} days free, then ${chosen.price} a ${chosen.per}.`
            : `${chosen.price} a ${chosen.per}, charged today.`}
        </p>
        <p className={small}>
          Renews automatically until you cancel. Cancel any time in Settings, under Subscription; you keep access to
          the end of the period you paid for.
        </p>
        {trial && (
          <p className={small}>
            Cancel before the trial ends and you pay nothing. We email you two days before it ends.
          </p>
        )}
        <p className={small}>
          Monthly payments are not refundable. An annual payment is refunded in full if you ask within {REFUND_DAYS}{' '}
          days of the charge: email {SUPPORT_EMAIL}.
        </p>
      </div>

      {error && <p className="mt-2.5 text-xs text-destructive">{error}</p>}

      <button type="button" onClick={subscribe} disabled={busy} className={primaryButton}>
        {busy ? 'Opening checkout…' : 'Subscribe'}
      </button>

      <p className={`mt-3 ${small}`}>
        By subscribing you agree to the{' '}
        <Link to="/terms" className="text-primary hover:underline">
          Terms of use
        </Link>{' '}
        and the{' '}
        <Link to="/privacy" className="text-primary hover:underline">
          Privacy policy
        </Link>
        . Payment is taken by Stripe; VantraRun never sees your card number.
      </p>

      {inviteCode}
    </Shell>
  );
}
