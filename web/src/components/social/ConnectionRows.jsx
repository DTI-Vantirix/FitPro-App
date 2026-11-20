import { Check, Clock, X } from 'lucide-react';
import { api } from '@/api/client';

// One list of connections: incoming requests, sent requests, or accepted friends.
export default function ConnectionRows({ connections, userId, kind, onChanged }) {
  const answer = async (connection, status) => {
    if (status === 'declined') {
      await api.entities.Connection.delete(connection.id);
    } else {
      const updated = await api.entities.Connection.update(connection.id, { status: 'accepted' });
      onChanged?.(updated);
      return;
    }
    onChanged?.(null);
  };

  if (!connections.length) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-xs text-muted-foreground">
        {kind === 'friends' && 'No friends yet — search a handle or send an invite link.'}
        {kind === 'incoming' && 'No requests waiting for you.'}
        {kind === 'outgoing' && 'No requests sent.'}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {connections.map((c) => {
        const outgoing = c.from_user_id === userId;
        const name = outgoing ? c.to_name : c.from_name;
        const handle = outgoing ? c.to_handle : c.from_handle;
        return (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2.5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-heading text-xs font-bold uppercase text-primary">
              {(name || handle || '?').slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-semibold">{name || handle}</p>
              <p className="num truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                @{handle}
              </p>
            </div>
            {kind === 'incoming' && (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => answer(c, 'accepted')}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:brightness-95"
                  aria-label={`Accept ${name}`}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => answer(c, 'declined')}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:text-destructive"
                  aria-label={`Decline ${name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {kind === 'outgoing' && (
              <span className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Clock className="h-3 w-3" /> Pending
              </span>
            )}
            {kind === 'friends' && (
              <span className="num shrink-0 text-[10px] uppercase tracking-[0.1em] text-primary">
                Friends
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}