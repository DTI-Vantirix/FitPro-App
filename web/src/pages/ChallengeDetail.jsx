import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, LogOut, Lock, Users } from 'lucide-react';
import { api } from '@/api/client';
import Leaderboard from '@/components/challenges/Leaderboard';
import { METRICS, daysLeft, formatValue, goalLabel, monthWindow } from '@/lib/challenges';
import { loadMyProfile } from '@/lib/social';

export default function ChallengeDetail() {
  const { id } = useParams();
  const [board, setBoard] = useState(null);
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    const res = await api.functions.invoke('challengeBoard', { challenge_id: id });
    setBoard(res.data);
  };

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then(async (user) => {
        if (!alive) return;
        setMe(user);
        const p = await loadMyProfile(user);
        if (alive) setProfile(p);
        await load();
      })
      .catch(() => {
        if (alive) setError('This challenge is not available.');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const myMembership = async () => {
    const page = await api.entities.ChallengeMember.filter(
      { challenge_id: id, user_id: me.id },
      { limit: 1 }
    );
    return (page.items || [])[0] || null;
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    const existing = await myMembership();
    if (!existing) {
      await api.entities.ChallengeMember.create({
        challenge_id: id,
        user_id: me.id,
        handle: profile?.handle || '',
        name: profile?.display_name || me.full_name || '',
      });
    }
    await load();
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    const existing = await myMembership();
    if (existing) await api.entities.ChallengeMember.delete(existing.id);
    await load();
    setBusy(false);
  };

  const challenge = board?.challenge;
  const metric = challenge ? METRICS[challenge.metric] || METRICS.distance : METRICS.distance;
  const myValue = board?.rows?.find((r) => r.user_id === me?.id)?.value || 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to="/challenges"
          aria-label="Back to challenges"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="eyebrow">Challenge group</p>
          <h1 className="truncate font-heading text-lg leading-tight">
            {challenge?.name || 'Loading…'}
          </h1>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {board === null && !error && <div className="panel h-48 animate-pulse" />}

      {challenge && (
        <>
          <section className="panel space-y-4 p-5">
            {challenge.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">{challenge.description}</p>
            )}

            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border">
              <div className="bg-card px-3 py-3">
                <p className="eyebrow text-[9px]">Goal</p>
                <p className="num mt-1 text-base leading-none">{goalLabel(challenge)}</p>
              </div>
              <div className="bg-card px-3 py-3">
                <p className="eyebrow text-[9px]">Members</p>
                <p className="num mt-1 text-base leading-none">{board.member_count}</p>
              </div>
              <div className="bg-card px-3 py-3">
                <p className="eyebrow text-[9px]">Days left</p>
                <p className="num mt-1 text-base leading-none">{daysLeft(challenge.end_date)}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">{metric.label} this month</p>
                <p className="num mt-1 text-2xl leading-none">{formatValue(challenge.metric, myValue)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {monthWindow(challenge.month).label}
                </p>
              </div>
              {board.joined ? (
                <button
                  type="button"
                  onClick={leave}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                >
                  <LogOut className="h-3.5 w-3.5" /> Leave
                </button>
              ) : (
                <button
                  type="button"
                  onClick={join}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" /> {busy ? 'Joining…' : 'Join'}
                </button>
              )}
            </div>
          </section>

          <section className="panel space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-1.5 font-heading text-base">
                <Users className="h-4 w-4 text-primary" /> Leaderboard
              </h2>
              <span className="vr-label text-[10px]">
                {metric.label}
              </span>
            </div>

            <Leaderboard
              rows={board.rows}
              metric={challenge.metric}
              target={Number(challenge.target_value) || 0}
              meId={me?.id}
            />

            <p className="flex items-start gap-1.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Only the {metric.label.toLowerCase()} total is shared here. Splits, routes and per-run timings stay
              in each athlete's own log.
            </p>
          </section>
        </>
      )}
    </div>
  );
}