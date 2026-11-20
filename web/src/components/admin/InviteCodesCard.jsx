import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';

// Admin-only. Hidden for everyone else by the function's own permission check.
export default function InviteCodesCard() {
  const [data, setData] = useState(null);
  const [count, setCount] = useState('5');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    const res = await api.functions.invoke('adminInviteCodes', { action: 'list' });
    setData(res.data);
  };

  useEffect(() => {
    load().catch(() => setData(false));
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.functions.invoke('adminInviteCodes', { action: 'generate', count, note });
      setNote('');
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not create codes.');
    }
    setBusy(false);
  };

  const revoke = async (id) => {
    setBusy(true);
    try {
      await api.functions.invoke('adminInviteCodes', { action: 'revoke', id });
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not revoke that code.');
    }
    setBusy(false);
  };

  const copy = async (code) => {
    await navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  if (data === false) return null;

  const codes = data?.codes || [];
  const available = codes.filter((c) => c.status === 'available');
  const spent = codes.filter((c) => c.status !== 'available');

  return (
    <section className="panel space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 font-heading text-base font-bold">
          <KeyRound className="h-4 w-4 text-primary" /> Invite codes
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Every code unlocks the app for exactly one athlete. Share one per tester — the app stays closed to
          everyone without a code.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border">
        {[
          { label: 'Unused', value: data ? available.length : '—' },
          { label: 'Redeemed', value: data ? data.stats?.used || 0 : '—' },
          { label: 'Athletes', value: data ? (data.grants || []).length : '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-card px-3 py-3">
            <p className="eyebrow text-[9px]">{stat.label}</p>
            <p className="num mt-1 text-lg leading-none">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          aria-label="How many codes"
          className="num w-16 rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-center text-sm outline-none focus:border-primary/60"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Batch label (optional)"
          className="min-w-0 flex-1 rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
        />
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Generate
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {available.length > 0 && (
        <ul className="space-y-1.5">
          {available.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2"
            >
              <span className="num flex-1 text-sm tracking-[0.08em]">{c.code}</span>
              {c.note && (
                <span className="truncate text-[10px] text-muted-foreground">{c.note}</span>
              )}
              <button
                type="button"
                onClick={() => copy(c.code)}
                aria-label={`Copy ${c.code}`}
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => revoke(c.id)}
                aria-label={`Revoke ${c.code}`}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {copied && <p className="text-[10px] text-primary">Copied {copied}</p>}

      {spent.length > 0 && (
        <details className="rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Redeemed and revoked ({spent.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {spent.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-[10px]">
                <span className="num text-muted-foreground">{c.code}</span>
                <span className="truncate text-muted-foreground">
                  {c.status === 'used' ? c.used_by_email || 'used' : 'revoked'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}