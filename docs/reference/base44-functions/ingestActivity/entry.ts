import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

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

const cleanPoints = (input) => {
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

const cleanSplits = (input) => {
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

const cleanExercises = (input) => {
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
    return {
      error: `${label}.external_id is required — it is how a re-sync updates the ${label} instead of duplicating it`,
    };
  }
  return { externalId };
};

async function ingestRun(base44, body) {
  const { externalId, error } = readExternalId(body, 'run');
  if (error) return Response.json({ error }, { status: 400 });

  const distance = num(body.distance_mi);
  const duration = num(body.duration_sec);
  if (distance === null || duration === null) {
    return Response.json({ error: 'distance_mi and duration_sec are required numbers' }, { status: 400 });
  }
  if (distance <= 0 || distance > MAX_DISTANCE_MI) {
    return Response.json({ error: `distance_mi must be between 0 and ${MAX_DISTANCE_MI}` }, { status: 400 });
  }
  if (duration <= 0 || duration > MAX_DURATION_SEC) {
    return Response.json({ error: 'duration_sec is out of range' }, { status: 400 });
  }

  const startedAt = body.started_at ? new Date(body.started_at) : new Date();
  if (Number.isNaN(startedAt.getTime())) {
    return Response.json({ error: 'started_at must be a valid date' }, { status: 400 });
  }

  const source = (body.source ? String(body.source).trim().slice(0, 40) : 'manual') || 'manual';
  const points = cleanPoints(body.points);
  const splits = cleanSplits(body.splits);
  const avgHr = num(body.avg_hr);
  const maxHr = num(body.max_hr);

  const avgPaceSec = Math.round(duration / distance);

  const payload = {
    route_name: body.route_name ? String(body.route_name).trim().slice(0, 120) : 'Imported run',
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

  const page = await base44.entities.Run.filter({ external_id: externalId, source }, { limit: 1 });
  const existing = page?.items?.[0];

  if (existing) {
    const updated = await base44.entities.Run.update(existing.id, payload);
    return Response.json({
      ok: true,
      kind: 'run',
      action: 'updated',
      run_id: updated.id,
      source,
      distance_mi: payload.distance_mi,
      duration_sec: payload.duration_sec,
      avg_pace_sec: avgPaceSec,
      points: points.length,
    });
  }

  const created = await base44.entities.Run.create(payload);
  return Response.json({
    ok: true,
    kind: 'run',
    action: 'created',
    run_id: created.id,
    source,
    distance_mi: payload.distance_mi,
    duration_sec: payload.duration_sec,
    avg_pace_sec: avgPaceSec,
    points: points.length,
  });
}

async function ingestWorkout(base44, body) {
  const { externalId, error } = readExternalId(body, 'workout');
  if (error) return Response.json({ error }, { status: 400 });

  const { exercises, setCount, volume } = cleanExercises(body.exercises);
  if (!exercises.length) {
    return Response.json(
      { error: 'exercises must hold at least one exercise with a name and one set of reps and weight' },
      { status: 400 }
    );
  }

  const performedAt = body.performed_at || body.started_at ? new Date(body.performed_at || body.started_at) : new Date();
  if (Number.isNaN(performedAt.getTime())) {
    return Response.json({ error: 'performed_at must be a valid date' }, { status: 400 });
  }

  const duration = num(body.duration_min);
  if (duration !== null && (duration <= 0 || duration > MAX_WORKOUT_MIN)) {
    return Response.json({ error: 'duration_min is out of range' }, { status: 400 });
  }

  const source = (body.source ? String(body.source).trim().slice(0, 40) : 'manual') || 'manual';

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

  const page = await base44.entities.Workout.filter({ external_id: externalId, source }, { limit: 1 });
  const existing = page?.items?.[0];

  if (existing) {
    const updated = await base44.entities.Workout.update(existing.id, payload);
    return Response.json({
      ok: true,
      kind: 'workout',
      action: 'updated',
      workout_id: updated.id,
      source,
      name: payload.name,
      set_count: setCount,
      total_volume: volume,
      exercises: exercises.length,
    });
  }

  const created = await base44.entities.Workout.create(payload);
  return Response.json({
    ok: true,
    kind: 'workout',
    action: 'created',
    workout_id: created.id,
    source,
    name: payload.name,
    set_count: setCount,
    total_volume: volume,
    exercises: exercises.length,
  });
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const kind = body.kind ? String(body.kind).trim().toLowerCase() : 'run';

    if (kind === 'run') return await ingestRun(base44, body);
    if (kind === 'workout') return await ingestWorkout(base44, body);

    return Response.json({ error: 'kind must be "run" or "workout"' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}