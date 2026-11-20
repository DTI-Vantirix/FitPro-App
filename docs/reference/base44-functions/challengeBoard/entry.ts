import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// Builds a challenge leaderboard. Members' raw training records stay private:
// only the one metric the challenge competes on is aggregated and returned.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth
      .me()
      .catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const challengeId = typeof body?.challenge_id === 'string' ? body.challenge_id : '';
    if (!challengeId) return Response.json({ error: 'challenge_id is required' }, { status: 400 });

    const challenge = await base44.asServiceRole.entities.Challenge.get(challengeId).catch((e) =>
      e.status === 404 ? null : Promise.reject(e)
    );
    if (!challenge) return Response.json({ error: 'Challenge not found' }, { status: 404 });

    const memberPage = await base44.asServiceRole.entities.ChallengeMember.filter(
      { challenge_id: challengeId },
      { limit: 60 }
    );
    const members = memberPage.items || [];
    const memberIds = members.map((m) => m.user_id).filter(Boolean);

    const totals = {};
    memberIds.forEach((id) => {
      totals[id] = 0;
    });

    if (memberIds.length) {
      const range = { $gte: challenge.start_date, $lt: challenge.end_date };
      if (challenge.metric === 'workouts') {
        const page = await base44.asServiceRole.entities.Workout.filter(
          { created_by_id: { $in: memberIds }, performed_at: range },
          { limit: 1000 }
        );
        (page.items || []).forEach((w) => {
          if (totals[w.created_by_id] === undefined) return;
          totals[w.created_by_id] += 1;
        });
      } else {
        const page = await base44.asServiceRole.entities.Run.filter(
          { created_by_id: { $in: memberIds }, started_at: range },
          { limit: 1000 }
        );
        (page.items || []).forEach((run) => {
          if (totals[run.created_by_id] === undefined) return;
          totals[run.created_by_id] +=
            challenge.metric === 'distance' ? Number(run.distance_mi) || 0 : 1;
        });
      }
    }

    // Only a name, a handle and the single metric value leave this function.
    const rows = members
      .map((m) => ({
        user_id: m.user_id,
        name: m.name || m.handle || 'Athlete',
        handle: m.handle || '',
        value: Number((totals[m.user_id] || 0).toFixed(2)),
      }))
      .sort((a, b) => b.value - a.value);

    return Response.json({
      challenge,
      rows,
      member_count: members.length,
      joined: members.some((m) => m.user_id === user.id),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}