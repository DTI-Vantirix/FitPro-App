import { Link } from 'react-router-dom';
import { ArrowRight, Check, Users } from 'lucide-react';
import { METRICS, daysLeft, goalLabel, monthWindow } from '@/lib/challenges';

export default function ChallengeCard({ challenge, joined }) {
  const metric = METRICS[challenge.metric] || METRICS.distance;
  return (
    <Link
      to={`/challenges/${challenge.id}`}
      className="panel block space-y-3 p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-base font-bold leading-tight">{challenge.name}</h3>
          <p className="num mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {monthWindow(challenge.month).label} · {metric.label}
          </p>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {challenge.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{challenge.description}</p>
      )}

      <div className="flex items-center gap-2">
        <span className="num rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
          goal {goalLabel(challenge)}
        </span>
        <span className="num rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
          {daysLeft(challenge.end_date)}d left
        </span>
        {joined ? (
          <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-primary">
            <Check className="h-3 w-3" /> Joined
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <Users className="h-3 w-3" /> Open
          </span>
        )}
      </div>
    </Link>
  );
}