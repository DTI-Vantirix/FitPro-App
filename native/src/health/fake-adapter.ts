import type { HealthAdapter, NormalizedActivity } from './types';

// Deliberately deterministic, fabricated examples. The fake reads no personal
// or operating-system health information, and does not call any backend.
const SAMPLE_ACTIVITIES: ReadonlyArray<NormalizedActivity> = [
  {
    kind: 'run',
    externalId: 'fitpro-fake-run-001',
    source: 'manual',
    routeName: 'Demo park loop',
    startedAt: '2026-11-07T13:00:00.000Z',
    distanceMi: 3.11,
    durationSec: 1740,
    splits: [
      { mile: 1, paceSec: 552 },
      { mile: 2, paceSec: 561 },
      { mile: 3, paceSec: 565 },
    ],
    avgHr: 149,
    maxHr: 168,
    notes: 'SIMULATED — no actual HealthKit or Health Connect data',
  },
  {
    kind: 'workout',
    externalId: 'fitpro-fake-workout-001',
    source: 'manual',
    name: 'Demo upper body',
    performedAt: '2026-11-06T18:30:00.000Z',
    durationMin: 45,
    exercises: [
      { name: 'Bench press', muscle: 'chest', sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }] },
      { name: 'Row', muscle: 'back', sets: [{ reps: 10, weight: 90 }] },
    ],
    notes: 'SIMULATED — no actual HealthKit or Health Connect data',
  },
  {
    kind: 'run',
    externalId: 'fitpro-fake-run-002',
    source: 'manual',
    routeName: 'Demo easy run',
    startedAt: '2026-11-05T12:00:00.000Z',
    distanceMi: 2.0,
    durationSec: 1335,
    notes: 'SIMULATED — no actual HealthKit or Health Connect data',
  },
  {
    kind: 'workout',
    externalId: 'fitpro-fake-workout-002',
    source: 'manual',
    name: 'Demo mobility & bodyweight',
    performedAt: '2026-11-04T17:00:00.000Z',
    durationMin: 20,
    exercises: [
      { name: 'Bodyweight squat', muscle: 'legs', sets: [{ reps: 12, weight: 0 }, { reps: 12, weight: 0 }] },
    ],
    notes: 'SIMULATED — no actual HealthKit or Health Connect data',
  },
];

/** Return fresh copies so consumers cannot mutate subsequent fake reads. */
function copyActivity(activity: NormalizedActivity): NormalizedActivity {
  if (activity.kind === 'run') {
    return {
      ...activity,
      ...(activity.points ? { points: activity.points.map((p) => ({ ...p })) } : {}),
      ...(activity.splits ? { splits: activity.splits.map((s) => ({ ...s })) } : {}),
    };
  }
  return {
    ...activity,
    exercises: activity.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set })),
    })),
  };
}

export const fakeHealthAdapter: HealthAdapter = {
  id: 'fake',
  displayName: 'Sample activities (offline)',
  async readActivities() {
    return SAMPLE_ACTIVITIES.map(copyActivity);
  },
};
