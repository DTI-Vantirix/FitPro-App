import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Copy, Share2, UserPlus } from 'lucide-react';
import { api } from '@/api/client';
import FriendSearch from '@/components/social/FriendSearch';
import ConnectionRows from '@/components/social/ConnectionRows';
import {
  findProfileByHandle,
  inviteLink,
  loadConnections,
  loadMyProfile,
  sendRequest,
  splitConnections,
} from '@/lib/social';

export default function Friends() {
  const [params] = useSearchParams();
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [connections, setConnections] = useState([]);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');

  const refresh = async (userId) => {
    setConnections(await loadConnections(userId));
  };

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then(async (user) => {
        if (!alive) return;
        setMe(user);
        const p = await loadMyProfile(user);
        if (!alive) return;
        setProfile(p);
        await refresh(user.id);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // An invite link arrives as /friends?add=handle
  useEffect(() => {
    const handle = params.get('add');
    if (!handle || !me || !profile || handle === profile.handle) return;
    let alive = true;
    (async () => {
      const target = await findProfileByHandle(handle);
      if (!alive || !target || target.created_by_id === me.id) return;
      await sendRequest({ me, myProfile: profile, target });
      await refresh(me.id);
      if (alive) setNote(`You're connected with @${target.handle}.`);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [params, me, profile]);

  const { friends, incoming, outgoing } = splitConnections(connections, me?.id);
  const link = profile ? inviteLink(profile.handle) : '';

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareInvite = async (app) => {
    if (!link) return;
    const text = 'Run with me on VantraRun';
    if (!app && navigator.share) {
      try {
        await navigator.share({ title: 'VantraRun', text, url: link });
        return;
      } catch {
        return;
      }
    }
    if (app === 'facebook') {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
        '_blank',
        'noopener'
      );
      return;
    }
    if (app === 'x') {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
        '_blank',
        'noopener'
      );
      return;
    }
    setNote('Copy the link and paste it into Instagram — Instagram has no web share.');
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <p className="eyebrow">Your circle</p>
        <h1 className="mt-1 font-heading text-3xl font-extrabold leading-none">Friends</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Find athletes by handle inside VantraRun. Facebook and Instagram don’t hand over a friend list, so the
          invite link is how you bring people over from there.
        </p>
      </div>

      {note && (
        <p className="rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-xs text-primary">
          {note}
        </p>
      )}

      {profile && (
        <section className="panel space-y-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 font-heading text-sm font-bold uppercase text-primary">
              {(profile.display_name || profile.handle).slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-sm font-bold">
                {profile.display_name || profile.handle}
              </p>
              <p className="num truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                @{profile.handle} · {profile.visibility} account
              </p>
            </div>
            <Link to="/settings" className="shrink-0 text-xs text-primary hover:underline">
              Edit
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
            <p className="eyebrow">Invite link</p>
            <p className="num mt-1 truncate text-[11px] text-muted-foreground">{link}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={() => shareInvite()}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-heading text-[11px] font-semibold text-primary-foreground transition hover:brightness-95"
            >
              <Share2 className="h-3 w-3" /> Share
            </button>
            <button
              type="button"
              onClick={() => shareInvite('facebook')}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Facebook
            </button>
            <button
              type="button"
              onClick={() => shareInvite('instagram')}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Instagram
            </button>
            <button
              type="button"
              onClick={() => shareInvite('x')}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              X
            </button>
          </div>
        </section>
      )}

      {me && profile && (
        <FriendSearch
          me={me}
          myProfile={profile}
          connections={connections}
          onChanged={() => refresh(me.id)}
        />
      )}

      {incoming.length > 0 && (
        <section className="panel space-y-3 p-5">
          <h2 className="flex items-center gap-1.5 font-heading text-base font-bold">
            <UserPlus className="h-4 w-4 text-primary" /> Requests
          </h2>
          <ConnectionRows
            connections={incoming}
            userId={me?.id}
            kind="incoming"
            onChanged={() => me && refresh(me.id)}
          />
        </section>
      )}

      <section className="panel space-y-3 p-5">
        <h2 className="font-heading text-base font-bold">Your friends ({friends.length})</h2>
        <ConnectionRows
          connections={friends}
          userId={me?.id}
          kind="friends"
          onChanged={() => me && refresh(me.id)}
        />
      </section>

      {outgoing.length > 0 && (
        <section className="panel space-y-3 p-5">
          <h2 className="font-heading text-base font-bold">Sent requests</h2>
          <ConnectionRows
            connections={outgoing}
            userId={me?.id}
            kind="outgoing"
            onChanged={() => me && refresh(me.id)}
          />
        </section>
      )}
    </div>
  );
}