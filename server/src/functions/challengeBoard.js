import { HttpError } from '../lib/http.js';
import { isUuid, serialize } from '../lib/serialize.js';

// Builds a challenge leaderboard. Members' raw training records stay private:
// only the one metric the challenge competes on is aggregated and returned.
export default async function challengeBoard({ db, user, body }) {
  const challengeId = typeof body?.challenge_id === 'string' ? body.challenge_id : '';
  if (!challengeId) throw new HttpError(400, 'challenge_id is required');

  const [challenge] = isUuid(challengeId)
    ? await db.query('select * from challenges where id = $1', [challengeId])
    : [];
  if (!challenge) throw new HttpError(404, 'Challenge not found');

  const members = await db.query(
    'select * from challenge_members where challenge_id = $1 order by created_date limit 60',
    [challengeId]
  );

  const totals = {};
  members.forEach((m) => {
    totals[m.user_id] = 0;
  });

  if (members.length) {
    const ids = members.map((m) => m.user_id);
    const from = challenge.start_date || null;
    const to = challenge.end_date || null;
    let sql;
    if (challenge.metric === 'workouts') {
      sql = `select created_by_id as user_id, count(*)::float8 as value from workouts
              where created_by_id = any($1)
                and ($2::timestamptz is null or performed_at >= $2::timestamptz)
                and ($3::timestamptz is null or performed_at < $3::timestamptz)
              group by created_by_id`;
    } else {
      const measure = challenge.metric === 'distance' ? 'coalesce(sum(distance_mi), 0)' : 'count(*)::float8';
      sql = `select created_by_id as user_id, ${measure} as value from runs
              where created_by_id = any($1)
                and ($2::timestamptz is null or started_at >= $2::timestamptz)
                and ($3::timestamptz is null or started_at < $3::timestamptz)
              group by created_by_id`;
    }
    for (const row of await db.query(sql, [ids, from, to])) totals[row.user_id] = Number(row.value) || 0;
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

  return {
    challenge: serialize(challenge),
    rows,
    member_count: members.length,
    joined: members.some((m) => m.user_id === user.id),
  };
}
