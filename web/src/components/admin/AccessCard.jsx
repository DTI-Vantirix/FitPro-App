import { useEffect, useRef, useState } from 'react';
import { Search, UserCheck, UserPlus } from 'lucide-react';
import { api } from '@/api/client';

// Admin-only. Who can use VantraRun and why, with free passes given and taken back by
// email. Hidden for everyone else by the function's own permission check.

const PLAN_NAMES = { monthly: 'monthly', annual: 'annual' };

// Why a person has access, in plain words.
function reasonLabel(person) {
  if (!person?.allowed) return 'No access';
  if (person.reason === 'admin') return 'Admin';
  if (person.reason === 'invite') return 'Invite code';
  if (person.reason === 'granted') return 'Granted by you';
  if (person.reason === 'trial') {
    const plan = PLAN_NAMES[person.plan];
    return plan ? `Trial (${plan})` : 'Trial';
  }
  if (person.reason === 'subscription') {
    const plan = PLAN_NAMES[person.plan];
    return plan ? `Subscribed (${plan})` : 'Subscribed';
  }
  return 'Has access';
}

const PAID_SOURCES = ['stripe', 'apple'];
const isPaid = (entitlement) => PAID_SOURCES.includes(entitlement.source);
// A paid period that has just ended still counts for this long (GRACE_DAYS in server/src/access.js).
const ALLOWANCE_MS = 3 * 24 * 60 * 60 * 1000;
const endOf = (entitlement) => new Date(entitlement.expires_at).getTime();
const isLivePaid = (entitlement) =>
  isPaid(entitlement) &&
  ['trial', 'active', 'grace'].includes(entitlement.status) &&
  endOf(entitlement) + ALLOWANCE_MS >= Date.now();
const day = (value) => new Date(value).toLocaleDateString();

// Where a paid subscription stands, in plain words.
function paidLine(entitlement) {
  const { status } = entitlement;
  if (status === 'revoked') return `${entitlement.note === 'Refunded' ? 'Refunded' : 'Ended'} ${day(entitlement.expires_at)}`;
  if (status === 'expired') return `Ended ${day(entitlement.expires_at)}`;
  if (status === 'grace') return `Payment failed, access until ${day(endOf(entitlement) + ALLOWANCE_MS)}`;
  if (entitlement.cancel_at_period_end) return `Ends ${day(entitlement.expires_at)}`;
  return `${status === 'trial' ? 'Trial ends' : 'Renews'} ${day(entitlement.expires_at)}`;
}

const PASS_NAMES = { invite: 'invite code access', admin: 'free access' };
const isRemovedPass = (entitlement) => PASS_NAMES[entitlement.source] && entitlement.status === 'revoked' && entitlement.revoked_by;
const isLiveFreePass = (entitlement) => PASS_NAMES[entitlement.source] && entitlement.status === 'active';
const messageOf = (err, fallback) => err?.response?.data?.error || fallback;

export default function AccessCard() {
  const [people, setPeople] = useState(null);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const latest = useRef(0);

  const load = async (term) => {
    const request = ++latest.current;
    const res = await api.functions.invoke('adminAccess', { action: 'list', search: term });
    // a slower, older search must not replace a newer one
    if (request === latest.current) setPeople(res.data?.people || []);
  };

  // First load decides whether the card shows at all; later searches wait for a pause in typing.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      load('').catch(() => setPeople(false));
      return undefined;
    }
    const timer = setTimeout(() => {
      load(search).catch((err) => setError(messageOf(err, 'Could not load the list.')));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const run = async (work, failure) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(messageOf(err, failure));
    }
    setBusy(false);
  };

  const grant = (event) => {
    event.preventDefault();
    const to = email.trim();
    if (!to) return;
    run(async () => {
      await api.functions.invoke('adminAccess', { action: 'grant', email: to, note });
      setEmail('');
      setNote('');
      setNotice(`${to} now has free access.`);
      await load(search);
    }, 'Could not grant access.');
  };

  const remove = (entitlement) =>
    run(async () => {
      await api.functions.invoke('adminAccess', { action: 'revoke', entitlement_id: entitlement.id });
      setConfirming(null);
      await load(search);
    }, 'Could not remove that access.');

  if (people === false) return null;
  const rows = people || [];

  return (
    <section className="panel space-y-4 p-5">
      <div>
        <p className="eyebrow">Admin</p>
        <h2 className="mt-1 flex items-center gap-1.5 font-heading text-base">
          <UserCheck className="h-4 w-4 text-primary" /> Who has access
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Everyone with an account, newest first, and why they can or cannot use VantraRun. A free pass can be
          given by email and taken back here. Paid subscriptions are cancelled with the payment provider.
        </p>
      </div>

      <form onSubmit={grant} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email to give free access"
            placeholder="Email of an existing account"
            className="min-w-0 flex-1 rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:border-primary"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note (optional)"
            placeholder="Note (optional)"
            maxLength={200}
            className="min-w-0 flex-1 rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            <UserPlus className="h-3.5 w-3.5" /> Grant free access
          </button>
        </div>
      </form>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="text-xs text-primary">{notice}</p>}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search by email"
          placeholder="Search by email"
          className="w-full rounded-xl border border-border bg-secondary/60 py-2.5 pl-9 pr-3.5 text-sm placeholder:text-muted-foreground/70 focus:border-primary"
        />
      </div>

      {people === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{search.trim() ? 'No account matches that search.' : 'No accounts yet.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Person</th>
                <th scope="col" className="px-3 py-2 font-medium">Access</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Free passes</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => {
                const passes = person.entitlements.filter(isLiveFreePass);
                const notes = passes.map((p) => p.note).filter(Boolean);
                const paid = person.entitlements.filter(isPaid);
                const removed = person.entitlements.filter(isRemovedPass);
                return (
                  <tr key={person.user_id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <span className="block break-all">{person.email}</span>
                      {person.full_name && <span className="block text-[10px] text-muted-foreground">{person.full_name}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={person.allowed ? '' : 'text-muted-foreground'}>{reasonLabel(person)}</span>
                      {paid.filter(isLivePaid).length >= 2 && (
                        <span className="block text-[10px] font-semibold text-destructive">Two subscriptions: refund one in Stripe</span>
                      )}
                      {paid.map((entitlement) => (
                        <span key={entitlement.id} className="block text-[10px] text-muted-foreground">
                          {paidLine(entitlement)}
                          {entitlement.external_id && <span className="num block break-all text-[9px]">{entitlement.external_id}</span>}
                        </span>
                      ))}
                      {removed.map((entitlement) => (
                        <span key={entitlement.id} className="block text-[10px] text-muted-foreground">
                          Free access removed by {entitlement.revoked_by} on {day(entitlement.revoked_at)}
                        </span>
                      ))}
                      {notes.length > 0 && <span className="block text-[10px] text-muted-foreground">{notes.join(' · ')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {passes.map((pass) =>
                        confirming === pass.id ? (
                          <span key={pass.id} className="flex flex-wrap items-center justify-end gap-2">
                            <span className="text-[10px] text-muted-foreground">Remove {PASS_NAMES[pass.source]}?</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => remove(pass)}
                              className="rounded-full border border-destructive/60 px-2.5 py-1 text-[10px] font-semibold text-destructive disabled:opacity-40"
                            >
                              Yes, remove
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirming(null)}
                              className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground disabled:opacity-40"
                            >
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            key={pass.id}
                            type="button"
                            disabled={busy}
                            aria-label={`Remove ${PASS_NAMES[pass.source]} from ${person.email}`}
                            onClick={() => setConfirming(pass.id)}
                            className="ml-2 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= 200 && (
        <p className="text-[10px] text-muted-foreground">Showing the newest 200 accounts. Search by email to find anyone else.</p>
      )}
    </section>
  );
}
