import { useEffect, useState } from 'react';
import { Check, Globe, Lock } from 'lucide-react';
import { api } from '@/api/client';
import { cleanHandle, findProfileByHandle, loadMyProfile } from '@/lib/social';
import { cn } from '@/lib/utils';

export default function SocialProfileCard() {
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

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
        setHandle(p.handle || '');
        setDisplayName(p.display_name || '');
        setBio(p.bio || '');
        setVisibility(p.visibility || 'private');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!profile || !me) return;
    const nextHandle = cleanHandle(handle);
    if (!nextHandle) {
      setError('Pick a handle — letters, numbers, dots and underscores.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const taken = await findProfileByHandle(nextHandle);
    if (taken && taken.id !== profile.id) {
      setError('That handle is already taken.');
      setSaving(false);
      return;
    }
    const updated = await api.entities.SocialProfile.update(profile.id, {
      handle: nextHandle,
      display_name: displayName.trim() || nextHandle,
      bio: bio.trim(),
      visibility,
    });
    setProfile({ ...profile, ...updated });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h2 className="font-heading text-base font-bold">Social profile</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          How friends find you and who sees what you post. Nothing is ever posted automatically — every run you
          share is one you pick.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">Handle</span>
          <div className="mt-1.5 flex items-center gap-1 rounded-xl border border-border bg-secondary/60 px-3 py-2.5 focus-within:border-primary/60">
            <span className="num text-sm text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(cleanHandle(e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </label>
        <label className="block">
          <span className="eyebrow">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus:border-primary/60"
          />
        </label>
      </div>

      <label className="block">
        <span className="eyebrow">One line about you</span>
        <input
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Chasing a sub-20 5k"
          className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
        />
      </label>

      <div>
        <p className="eyebrow mb-2">Account</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            {
              id: 'public',
              label: 'Public',
              detail: 'Anyone can follow you and see your public posts',
              icon: Globe,
            },
            {
              id: 'private',
              label: 'Private',
              detail: 'Every request needs your approval, posts stay with friends',
              icon: Lock,
            },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setVisibility(option.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                visibility === option.id
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border hover:border-border/80'
              )}
            >
              <span
                className={cn(
                  'flex items-center gap-1.5 font-heading text-xs font-semibold',
                  visibility === option.id ? 'text-primary' : 'text-foreground'
                )}
              >
                <option.icon className="h-3.5 w-3.5" /> {option.label}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                {option.detail}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving || !profile}
        className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 font-heading text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
      >
        {saved ? <Check className="h-3.5 w-3.5" /> : null}
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save social profile'}
      </button>
    </section>
  );
}