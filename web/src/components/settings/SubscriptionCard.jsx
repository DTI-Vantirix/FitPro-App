import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, CreditCard } from 'lucide-react';
import { api } from '@/api/client';
import { REFUND_DAYS, SUPPORT_EMAIL, longDate, planById } from '@/lib/plans';

// The website subscription of the signed-in person: what it is, when it renews or
// ends, and the way to Stripe's pages for the card, invoices and cancelling.
// Shown only to someone who has one; an admin, an invite code or a free pass sees
// nothing here. Cancelling is two taps: "Cancel subscription", then Stripe's confirmation.
const outline =
  'rounded-full border border-border px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/60 disabled:opacity-50';

export default function SubscriptionCard() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    let alive = true;
    const invoke = (action) => api.functions.invoke('subscription', { action }).then((res) => res.data);
    // Back from Stripe's pages: ask the server to check with Stripe before showing anything.
    const back = new URLSearchParams(window.location.search).get('billing') === 'updated';
    (back ? invoke('refresh').catch(() => invoke('status')) : invoke('status'))
      .then((data) => alive && setStatus(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!status || !params.has('billing')) return;
    const next = new URLSearchParams(params);
    next.delete('billing');
    setParams(next, { replace: true });
  }, [status, params, setParams]);

  const subscription = status?.subscription;
  if (!subscription) return null;

  const plan = planById(subscription.plan);
  const date = longDate(subscription.expires_at);
  const ending = subscription.cancel_at_period_end;
  const trial = subscription.status === 'trial';
  const grace = subscription.status === 'grace';

  const toPortal = async (flow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('subscription', { action: 'portal', ...(flow ? { flow } : {}) });
      window.location.assign(res.data.url);
      return; // leaving for Stripe
    } catch (err) {
      setError(err?.message || 'Could not open the subscription page. Try again in a moment.');
    }
    setBusy(false);
  };

  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.functions.invoke('subscription', { action: 'resume' });
      setStatus(res.data);
      setResumed(true);
    } catch (err) {
      setError(err?.message || 'Could not resume your subscription. Try again in a moment.');
    }
    setBusy(false);
  };

  let line;
  if (grace) line = 'Your last payment did not go through. Update your card to keep access.';
  else if (ending) line = `Ends on ${date}.${trial ? ' You will not be charged.' : ''}`;
  else if (trial) line = plan ? `Free trial. Ends on ${date}, then ${plan.price} a ${plan.per}.` : `Free trial. Ends on ${date}.`;
  else line = `Renews on ${date}.`;

  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h2 className="font-heading text-base">Subscription</h2>
        <p className="mt-1 text-sm text-foreground">
          {plan ? `${plan.name} plan, ${plan.price} a ${plan.per}` : 'VantraRun subscription'}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{line}</p>
      </div>

      {resumed && !ending && (
        <p className="flex items-center gap-2 text-xs text-primary">
          <Check className="h-3.5 w-3.5" /> Your subscription continues.
        </p>
      )}

      {status.duplicate && (
        <p className="vr-notice px-3.5 py-2.5 text-xs">
          You have two subscriptions. Email {SUPPORT_EMAIL} and we will refund one.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {grace && (
          <button
            type="button"
            onClick={() => toPortal()}
            disabled={busy}
            className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            Update payment details
          </button>
        )}
        {ending && !grace && (
          <button
            type="button"
            onClick={resume}
            disabled={busy}
            className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            Resume
          </button>
        )}
        <button type="button" onClick={() => toPortal()} disabled={busy} className={`flex items-center gap-1.5 ${outline}`}>
          <CreditCard className="h-3.5 w-3.5" /> Manage subscription
        </button>
        {!ending && (
          <button
            type="button"
            onClick={() => toPortal('cancel')}
            disabled={busy}
            className="px-1.5 py-2 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
          >
            Cancel subscription
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Monthly payments are not refundable. Annual: full refund within {REFUND_DAYS} days of the charge, on request to{' '}
        {SUPPORT_EMAIL}.{' '}
        <Link to="/terms" className="text-primary hover:underline">
          Terms of use
        </Link>
      </p>
    </section>
  );
}
