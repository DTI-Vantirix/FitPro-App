import { HttpError } from '../lib/http.js';
import { isUuid } from '../lib/serialize.js';
import { hasAccess } from './inviteAccess.js';

// The single write path for synced health data (Apple Health, Health Connect,
// Garmin, manual). Contract: docs/native-contract.md. Ported unchanged from the
// Base44 function; the only difference is the upsert, which is now one atomic
// statement backed by a unique index on (user, source, external_id).

const MAX_POINTS = 5000;
const MAX_SPLITS = 200;
const MAX_DISTANCE_MI = 500;
const MAX_DURATION_SEC = 60 * 60 * 24 * 3;
const MAX_EXERCISES = 60;
const MAX_SETS = 40;
const MAX_REPS = 1000;
const MAX_WEIGHT = 2000;
const MAX_WORKOUT_MIN = 720;

const num = (value) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const cleanPoints = (input) => {
  if (!Array.isArray(input)) return [];
  const points = [];
  for (const raw of input) {
    const lat = num(raw?.lat);
    const lng = num(raw?.lng);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    points.push({ lat: round(lat, 6), lng: round(lng, 6) });
    if (points.length >= MAX_POINTS) break;
  }
  return points;
};

export const cleanSplits = (input) => {
  if (!Array.isArray(input)) return [];
  const splits = [];
  for (const raw of input) {
    const mile = num(raw?.mile);
    const pace = num(raw?.pace_sec);
    if (mile === null || pace === null || mile <= 0 || pace <= 0) continue;
    splits.push({ mile: Math.round(mile), pace_sec: Math.round(pace) });
    if (splits.length >= MAX_SPLITS) break;
  }
  return splits;
};

export const cleanExercises = (input) => {
  if (!Array.isArray(input)) return { exercises: [], setCount: 0, volume: 0 };
  const exercises = [];
  let setCount = 0;
  let volume = 0;
  for (const raw of input) {
    const name = raw?.name ? String(raw.name).trim().slice(0, 80) : '';
    if (!name) continue;
    const sets = [];
    if (Array.isArray(raw?.sets)) {
      for (const set of raw.sets) {
        const reps = num(set?.reps);
        const weight = num(set?.weight);
        if (reps === null || weight === null) continue;
        if (reps <= 0 || reps > MAX_REPS || weight < 0 || weight > MAX_WEIGHT) continue;
        sets.push({ reps: Math.round(reps), weight: round(weight, 1) });
        if (sets.length >= MAX_SETS) break;
      }
    }
    if (!sets.length) continue;
    const muscle = raw?.muscle ? String(raw.muscle).trim().slice(0, 40) : '';
    exercises.push({ name, ...(muscle ? { muscle } : {}), sets });
    setCount += sets.length;
    volume += sets.reduce((sum, set) => sum + set.reps * set.weight, 0);
    if (exercises.length >= MAX_EXERCISES) break;
  }
  return { exercises, setCount, volume: round(volume, 1) };
};

const readExternalId = (body, label) => {
  const externalId = body.external_id ? String(body.external_id).trim().slice(0, 200) : '';
  if (!externalId) {
    throw new HttpError(
      400,
      `${label}.external_id is required — it is how a re-sync updates the ${label} instead of duplicating it`
    );
  }
  return externalId;
};

const readSource = (body) => (body.source ? String(body.source).trim().slice(0, 40) : 'manual') || 'manual';

const JSON_FIELDS = new Set(['points', 'splits', 'exercises']);

// Insert, or update the user's existing record with the same (source, external_id).
// Fields not in `payload` are left alone on update, as before.
async function upsert(db, table, user, payload) {
  const row = { ...payload, created_by_id: user.id, created_by: user.email };
  const fields = Object.keys(row);
  const params = fields.map((f) => (JSON_FIELDS.has(f) ? JSON.stringify(row[f]) : row[f]));
  const slots = fields.map((f, i) => (JSON_FIELDS.has(f) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const updates = Object.keys(payload)
    .filter((f) => f !== 'source' && f !== 'external_id')
    .map((f) => `${f} = excluded.${f}`);
  const [result] = await db.query(
    `insert into ${table} (${fields.join(', ')}) values (${slots.join(', ')})
     on conflict (created_by_id, source, external_id) where external_id is not null
     do update set ${updates.join(', ')}, updated_date = now()
     returning id, (xmax = 0) as inserted`,
    params
  );
  return { id: result.id, action: result.inserted ? 'created' : 'updated' };
}

const FITPRO = 'fitpro';
const MIN_BPM = 20;
const MAX_BPM = 260;

const inRange = (value, min, max) => {
  const n = num(value);
  return n !== null && n >= min && n <= max ? Math.round(n) : null;
};

// The optional fields a FitPro-recorded run carries: its route, the zone the
// runner aimed for and the heart-rate stats. The phone queues runs while offline
// and retries them, so nothing here may fail the upload: a value that doesn't
// make sense is left out.
async function readRunExtras(db, user, body) {
  const extras = {};

  if (isUuid(body.route_id)) {
    const [route] = await db.query('select id from routes where id = $1 and created_by_id = $2', [
      body.route_id,
      user.id,
    ]);
    if (route) extras.route_id = route.id;
  }

  if (body.target_zone_name) extras.target_zone_name = String(body.target_zone_name).trim().slice(0, 80);
  const fast = num(body.target_fast_sec);
  const slow = num(body.target_slow_sec);
  if (fast !== null && slow !== null && fast > 0 && slow > 0 && fast <= slow) {
    extras.target_fast_sec = Math.round(fast);
    extras.target_slow_sec = Math.round(slow);
  }

  const fields = [
    ['in_zone_pct', 0, 100],
    ['hr_in_zone_pct', 0, 100],
    ['min_hr', MIN_BPM, MAX_BPM],
    ['hr_target_min', MIN_BPM, MAX_BPM],
    ['hr_target_max', MIN_BPM, MAX_BPM],
  ];
  for (const [field, min, max] of fields) {
    const value = inRange(body[field], min, max);
    if (value !== null) extras[field] = value;
  }
  return extras;
}

// Runs FitPro recorded itself: in the app (`fitpro`) or on the website (`live`).
const RECORDED_BY_FITPRO = [FITPRO, 'live'];

// A runner who also records on their watch would get the run twice: once from
// FitPro, once imported from the health app. An incoming import is the same run
// when the time the two share is at least half of the shorter one. A record
// that was already imported keeps updating; only a new duplicate is skipped.
async function overlappingFitproRun(db, user, source, externalId, run) {
  const [match] = await db.query(
    `select r.id
       from runs r
      where r.created_by_id = $1
        and r.source = any($2::text[])
        and r.started_at is not null
        and not exists (
          select 1 from runs e where e.created_by_id = $1 and e.source = $3 and e.external_id = $4
        )
        and extract(epoch from
              least(r.started_at + make_interval(secs => r.duration_sec),
                    $5::timestamptz + make_interval(secs => $6::float8))
              - greatest(r.started_at, $5::timestamptz))
            >= 0.5 * least(r.duration_sec, $6::float8)
      order by r.started_at desc
      limit 1`,
    [user.id, RECORDED_BY_FITPRO, source, externalId, run.started_at, run.duration_sec]
  );
  return match?.id || null;
}

async function ingestRun(db, user, body) {
  const externalId = readExternalId(body, 'run');
  const distance = num(body.distance_mi);
  const duration = num(body.duration_sec);
  if (distance === null || duration === null) {
    throw new HttpError(400, 'distance_mi and duration_sec are required numbers');
  }
  if (distance <= 0 || distance > MAX_DISTANCE_MI) {
    throw new HttpError(400, `distance_mi must be between 0 and ${MAX_DISTANCE_MI}`);
  }
  if (duration <= 0 || duration > MAX_DURATION_SEC) throw new HttpError(400, 'duration_sec is out of range');

  const startedAt = body.started_at ? new Date(body.started_at) : new Date();
  if (Number.isNaN(startedAt.getTime())) throw new HttpError(400, 'started_at must be a valid date');

  const source = readSource(body);
  const points = cleanPoints(body.points);
  const splits = cleanSplits(body.splits);
  const avgHr = num(body.avg_hr);
  const maxHr = num(body.max_hr);
  const avgPaceSec = Math.round(duration / distance);

  const payload = {
    route_name: body.route_name
      ? String(body.route_name).trim().slice(0, 120)
      : source === FITPRO ? 'Free run' : 'Imported run',
    distance_mi: round(distance, 2),
    duration_sec: Math.round(duration),
    avg_pace_sec: avgPaceSec,
    started_at: startedAt.toISOString(),
    source,
    external_id: externalId,
    points,
    splits,
  };
  if (avgHr !== null) payload.avg_hr = Math.round(avgHr);
  if (maxHr !== null) payload.max_hr = Math.round(maxHr);
  if (body.hr_device) payload.hr_device = String(body.hr_device).slice(0, 80);
  if (body.notes) payload.notes = String(body.notes).slice(0, 2000);
  Object.assign(payload, await readRunExtras(db, user, body));

  if (!RECORDED_BY_FITPRO.includes(source)) {
    const original = await overlappingFitproRun(db, user, source, externalId, payload);
    if (original) {
      return { ok: true, kind: 'run', action: 'skipped', reason: 'overlaps_fitpro_run', run_id: original, source };
    }
  }

  const { id, action } = await upsert(db, 'runs', user, payload);
  return {
    ok: true,
    kind: 'run',
    action,
    run_id: id,
    source,
    distance_mi: payload.distance_mi,
    duration_sec: payload.duration_sec,
    avg_pace_sec: avgPaceSec,
    points: points.length,
  };
}

async function ingestWorkout(db, user, body) {
  const externalId = readExternalId(body, 'workout');
  const { exercises, setCount, volume } = cleanExercises(body.exercises);
  if (!exercises.length) {
    throw new HttpError(400, 'exercises must hold at least one exercise with a name and one set of reps and weight');
  }

  const when = body.performed_at || body.started_at;
  const performedAt = when ? new Date(when) : new Date();
  if (Number.isNaN(performedAt.getTime())) throw new HttpError(400, 'performed_at must be a valid date');

  const duration = num(body.duration_min);
  if (duration !== null && (duration <= 0 || duration > MAX_WORKOUT_MIN)) {
    throw new HttpError(400, 'duration_min is out of range');
  }

  const source = readSource(body);
  const payload = {
    name: body.name ? String(body.name).trim().slice(0, 120) : 'Imported workout',
    performed_at: performedAt.toISOString(),
    total_volume: volume,
    set_count: setCount,
    exercises,
    source,
    external_id: externalId,
  };
  if (duration !== null) payload.duration_min = round(duration, 1);
  if (body.notes) payload.notes = String(body.notes).slice(0, 2000);

  const { id, action } = await upsert(db, 'workouts', user, payload);
  return {
    ok: true,
    kind: 'workout',
    action,
    workout_id: id,
    source,
    name: payload.name,
    set_count: setCount,
    total_volume: volume,
    exercises: exercises.length,
  };
}

export default async function ingestActivity({ db, user, body }) {
  // Invite-only is enforced here too, not just in the app.
  if (!(await hasAccess(db, user))) {
    throw new HttpError(403, 'Redeem your invite code before syncing activities.');
  }
  const kind = body.kind ? String(body.kind).trim().toLowerCase() : 'run';
  if (kind === 'run') return ingestRun(db, user, body);
  if (kind === 'workout') return ingestWorkout(db, user, body);
  throw new HttpError(400, 'kind must be "run" or "workout"');
}
