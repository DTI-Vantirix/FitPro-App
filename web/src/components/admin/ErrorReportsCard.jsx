import { useEffect, useState } from 'react';
import { Bug, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/api/client';

// Admin-only. Errors recorded by the phone app and by the API itself, kept in our own
// database (no outside monitoring service). Hidden for everyone else by the function's
// own permission check.
export default function ErrorReportsCard() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    const res = await api.functions.invoke('adminClientErrors', { action: 'list' });
    setData(res.data);
  };

  useEffect(() => {
    load().catch(() => setData(false));
  }, []);

  const run = async (work, failure) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err?.response?.data?.error || failure);
    }
    setBusy(false);
  };

  if (data === false) return null;
  const errors = data?.errors || [];

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Admin</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-base font-bold">
            <Bug className="h-4 w-4" /> Error reports
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Crashes from the phone app and unexpected errors on the server. Stored here only; nothing is sent to an
            outside service. The newest 2,000 are kept.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh error reports"
          disabled={busy}
          onClick={() => run(load, 'Could not load the reports.')}
          className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {data && errors.length === 0 && <p className="text-xs text-muted-foreground">No errors recorded.</p>}

      {errors.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground">
            Showing the newest {errors.length} of {data.total}.
          </p>
          <ul className="divide-y divide-border">
            {errors.map((item) => (
              <li key={item.id} className="py-2.5">
                <button type="button" className="w-full text-left" onClick={() => setOpen(open === item.id ? null : item.id)}>
                  <p className="break-words text-xs font-semibold">{item.message}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(item.created_date).toLocaleString()} · {item.platform}
                    {item.app_version ? ` · ${item.app_version}` : ''}
                    {item.user_email ? ` · ${item.user_email}` : ''}
                    {item.context ? ` · ${item.context}` : ''}
                  </p>
                </button>
                {open === item.id && item.stack && (
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-[10px] leading-relaxed">
                    {item.stack}
                  </pre>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              window.confirm('Delete every error report? This cannot be undone.') &&
              run(async () => {
                await api.functions.invoke('adminClientErrors', { action: 'clear' });
                await load();
              }, 'Could not clear the reports.')
            }
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear all reports
          </button>
        </>
      )}
    </section>
  );
}
