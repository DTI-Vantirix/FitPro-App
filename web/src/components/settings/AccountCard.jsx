import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, KeyRound, LogOut, Mail } from 'lucide-react';
import { api } from '@/api/client';

const field =
  'mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60';

export default function AccountCard() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then((me) => alive && setUser(me))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const filled = form.current && form.next && form.confirm;
  const mismatch = Boolean(form.confirm) && form.next !== form.confirm;
  const tooShort = Boolean(form.next) && form.next.length < 8;
  const same = Boolean(form.current) && form.current === form.next;
  const valid = filled && !mismatch && !tooShort && !same;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || !user) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.auth.changePassword({
        userId: user.id,
        currentPassword: form.current,
        newPassword: form.next,
      });
      setForm({ current: '', next: '', confirm: '' });
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Could not change your password.');
    }
    setBusy(false);
  };

  return (
    <section className="panel space-y-4 p-5">
      <div>
        <h2 className="font-heading text-base font-bold">Login &amp; password</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The email you sign in with, and the password for it.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 px-3.5 py-3">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Login email</p>
          <p className="mt-0.5 truncate text-sm">{user?.email || '—'}</p>
        </div>
        <button
          type="button"
          onClick={() => api.auth.logout('/login')}
          className="flex shrink-0 items-center gap-1.5 self-center rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Your email is your login and can’t be edited here — a different address is a different account. To move to
        another address, sign up or get invited with it and start fresh there.
      </p>

      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="eyebrow">Current password</span>
          <input
            type="password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
            autoComplete="current-password"
            className={field}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow">New password</span>
            <input
              type="password"
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
              autoComplete="new-password"
              className={field}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Confirm new password</span>
            <input
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              autoComplete="new-password"
              className={field}
            />
          </label>
        </div>

        {tooShort && <p className="text-[11px] text-muted-foreground">Use at least 8 characters.</p>}
        {same && <p className="text-[11px] text-muted-foreground">The new password matches your current one.</p>}
        {mismatch && <p className="text-[11px] text-destructive">The two new passwords don’t match.</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy || !valid || !user}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          <KeyRound className="h-4 w-4" />
          {busy ? 'Updating…' : 'Change password'}
        </button>

        {done && (
          <p className="flex items-center gap-2 text-xs text-primary">
            <Check className="h-3.5 w-3.5" /> Password changed. Use it the next time you sign in.
          </p>
        )}
      </form>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Don’t know your current password, or signed up with Google or Apple and never set one?{' '}
        <Link to="/forgot-password" className="text-primary hover:underline">
          Set a password by email
        </Link>
        .
      </p>
    </section>
  );
}