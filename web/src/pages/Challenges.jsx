import { useEffect, useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import { api } from '@/api/client';
import ChallengeCard from '@/components/challenges/ChallengeCard';
import ChallengeForm from '@/components/challenges/ChallengeForm';
import { HIDDEN_METRICS } from '@/lib/challenges';
import { loadMyProfile } from '@/lib/social';

export default function Challenges() {
  const [challenges, setChallenges] = useState(null);
  const [mine, setMine] = useState([]);
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then(async (user) => {
        if (!alive) return;
        setMe(user);
        const p = await loadMyProfile(user);
        if (alive) setProfile(p);
        const [page, memberPage] = await Promise.all([
          api.entities.Challenge.list({ sort: '-created_date', limit: 30 }),
          api.entities.ChallengeMember.filter({ user_id: user.id }, { limit: 100 }),
        ]);
        if (!alive) return;
        setChallenges((page.items || []).filter((c) => !HIDDEN_METRICS.includes(c.metric)));
        setMine(memberPage.items || []);
      })
      .catch(() => {
        if (alive) setChallenges([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const joinedIds = new Set(mine.map((m) => m.challenge_id));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Group goals</p>
          <h1 className="mt-1 font-heading text-3xl leading-none">Challenges</h1>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95"
        >
          <Plus className="h-3.5 w-3.5" /> New challenge
        </button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Compete on one number a month. The group sees your miles or run count — never your routes, splits or
        run times.
      </p>

      {challenges === null && <div className="panel h-32 animate-pulse" />}

      {challenges?.length === 0 && (
        <div className="panel p-6 text-center">
          <Trophy className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-3 font-heading text-base">No challenge groups yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Start one for the month — a 100 mile goal or 20 runs — and anyone who joins
            climbs the same board.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {(challenges || []).map((challenge) => (
          <ChallengeCard
            key={challenge.id}
            challenge={challenge}
            joined={joinedIds.has(challenge.id)}
          />
        ))}
      </div>

      <ChallengeForm
        open={open}
        onOpenChange={setOpen}
        profile={profile}
        onCreate={(created) => {
          setChallenges((list) => [created, ...(list || [])]);
        }}
      />
    </div>
  );
}