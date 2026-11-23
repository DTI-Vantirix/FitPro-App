/** Only fields declared in docs/native-contract.md. Synthetic, never sourced from HealthKit. */
export const SPIKE_EXTERNAL_ID = 'fitpro-native-auth-spike-workout-v1';

export const SPIKE_WORKOUT = {
  kind: 'workout',
  external_id: SPIKE_EXTERNAL_ID,
  source: 'manual',
  name: 'FitPro Native — Authentication Spike',
  duration_min: 5,
  exercises: [
    { name: 'Bodyweight squat', muscle: 'legs', sets: [{ reps: 5, weight: 0 }] },
  ],
  notes: 'Synthetic test record created only when the user taps Send Test Workout.',
} as const;
