import { useEffect, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { api } from '@/api/client';
import { sendRequest } from '@/lib/social';

export default function FriendSearch({ me, myProfile, connections, onChanged }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api.entities.SocialProfile.list({ limit: 100 })
      .then((page) => setPeople(page.items || []))
      .catch(() => setPeople([]));
  }, []);

  const needle = query.trim().toLowerCase();
  const results = needle
    ? people.filter(
        (p) =>
          p.created_by_id !== me.id &&
          ((p.handle || '').toLowerCase().includes(needle.replace(/^@/, '')) ||
            (p.display_name || '').toLowerCase().includes(needle))
      )
    : [];

  const connectionFor = (profile) =>
    connections.find(
      (c) =>
        (c.from_user_id === me.id && c.to_user_id === profile.created_by_id) ||
        (c.to_user_id === me.id && c.from_user_id === profile.created_by_id)
    );

  const connect = async (profile) => {
    setBusyId(profile.id);
    const created = await sendRequest({ me, myProfile, target: profile });
    setBusyId(null);
    onChanged?.(created);
  };

  return (
    <div className="panel p-5">
      <label className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 focus-within:border-primary/50">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by @handle or name"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground/70"
        />
      </label>

      {needle && (
        <div className="mt-3 space-y-1.5">
          {results.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Nobody matches “{query.trim()}”. Invite them with your invite link instead.
            </p>
          )}
          {results.map((profile) => {
            const link = connectionFor(profile);
            return (
              <div
                key={profile.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold uppercase text-primary">
                  {(profile.display_name || profile.handle || '?').slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm">
                    {profile.display_name || profile.handle}
                  </p>
                  <p className="vr-label truncate text-[10px]">
                    @{profile.handle} · {profile.visibility}
                  </p>
                </div>
                {link ? (
                  <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    {link.status === 'accepted' ? 'Friends' : 'Requested'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => connect(profile)}
                    disabled={busyId === profile.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
                  >
                    <UserPlus className="h-3 w-3" />
                    {busyId === profile.id ? '…' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}