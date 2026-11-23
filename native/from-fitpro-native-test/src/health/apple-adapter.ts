import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { HealthAdapter, NormalizedActivity, NormalizedRun } from './types';
import { beatsPerMinute, resolveWorkoutDistance, resolveWorkoutDuration, sanitizeRoute } from './apple-normalize';

// There is deliberately no HealthKit import at module initialization. That
// keeps the fake provider usable even inside Expo Go and on Android.
let permissionRequestedInThisSession = false;
let warnings: string[] = [];

export function isAppleHealthBuildAvailable(): boolean {
  return Platform.OS === 'ios'
    && Constants.appOwnership !== 'expo'
    && Constants.executionEnvironment !== 'storeClient';
}

async function loadHealthKit() {
  if (Platform.OS !== 'ios') throw new Error('Apple Health is available only on iOS. Select sample activities on Android.');
  if (!isAppleHealthBuildAvailable()) throw new Error('Apple Health requires the FitPro iOS development build. Expo Go cannot access the HealthKit native module.');
  try {
    return await import('@kingstinct/react-native-healthkit');
  } catch (cause) {
    throw new Error(`Unable to load Apple Health native module. Rebuild the iOS development client. ${message(cause)}`);
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function bps(value: { quantity: number; unit: string } | undefined) {
  return value ? beatsPerMinute(value.quantity, value.unit) : undefined;
}

export const appleHealthAdapter: HealthAdapter = {
  id: 'apple',
  displayName: 'Apple Health (read-only)',
  getReadWarnings: () => warnings.slice(),

  async requestReadAuthorization() {
    permissionRequestedInThisSession = false;
    const hk = await loadHealthKit();
    if (!(await hk.isHealthDataAvailableAsync())) throw new Error('Apple Health data is unavailable on this device.');
    // Explicitly READ-only: do not request any toShare permissions.
    // Apple's read authorization is privacy-preserving: a completed request
    // does not reveal which categories the person allowed/denied.
    const requestCompleted = await hk.requestAuthorization({
      toRead: [
        hk.WorkoutTypeIdentifier, hk.WorkoutRouteTypeIdentifier,
        'HKQuantityTypeIdentifierHeartRate',
        'HKQuantityTypeIdentifierDistanceWalkingRunning',
      ],
    });
    if (!requestCompleted) throw new Error('Apple Health did not complete the read authorization request.');
    permissionRequestedInThisSession = true;
  },

  async readActivities(): Promise<ReadonlyArray<NormalizedActivity>> {
    if (!permissionRequestedInThisSession) {
      throw new Error('Select Apple Health and request read access before loading any real health activities.');
    }
    const hk = await loadHealthKit();
    warnings = [];
    const results: NormalizedRun[] = [];
    let skipped = 0;
    // Foreground-only recent read, no anchor, background listeners or uploads.
    const workouts = await hk.queryWorkoutSamples({
      filter: { workoutActivityType: hk.WorkoutActivityType.running },
      ascending: false,
      limit: 50,
    });
    for (const [index, workout] of workouts.entries()) {
      try {
        // Apple has deprecated HKWorkout.totalDistance. Some valid runs have
        // no totalDistance but expose summed distance in workout statistics.
        const primaryDistance = resolveWorkoutDistance(workout.totalDistance, undefined);
        let statisticDistance: { quantity: number; unit: string } | undefined;
        let distanceQueryIssue: string | undefined;
        if (primaryDistance == null) {
          try {
            const statistic = await workout.getStatistic('HKQuantityTypeIdentifierDistanceWalkingRunning', 'm');
            statisticDistance = statistic?.sumQuantity;
          } catch (cause) {
            distanceQueryIssue = message(cause);
          }
        }
        const distance = primaryDistance ?? resolveWorkoutDistance(undefined, statisticDistance);
        const { seconds: duration, fromElapsedTime } = resolveWorkoutDuration(
          workout.duration, workout.startDate, workout.endDate,
        );
        const reasons: string[] = [];
        if (distance == null) {
          reasons.push(workout.totalDistance
            ? `distance invalid or unsupported (${workout.totalDistance.unit})`
            : 'total distance missing');
          if (distanceQueryIssue) reasons.push(`distance statistics failed (${distanceQueryIssue})`);
          else reasons.push('no usable summed running distance in workout statistics');
        }
        if (duration == null) reasons.push('duration invalid (including elapsed time)');
        // Required identity: use HealthKit UUID, never a timestamp/hash.
        if (!workout.uuid) reasons.push('stable workout UUID missing');
        if (!Number.isFinite(workout.startDate?.getTime())) reasons.push('invalid start date');
        if (reasons.length) {
          skipped++;
          warnings.push(`Running workout #${index + 1} skipped: ${reasons.join('; ')}.`);
          continue;
        }
        // After validation, all required values are known to be present.
        if (distance == null || duration == null || !workout.uuid) continue;
        if (primaryDistance == null) {
          warnings.push(`Running workout #${index + 1}: distance recovered from Apple workout statistics.`);
        }
        if (fromElapsedTime) {
          warnings.push(`Running workout #${index + 1}: duration derived from start/end times; may include pauses.`);
        }
        const run: NormalizedRun = {
          kind: 'run',
          externalId: workout.uuid,
          source: 'apple',
          routeName: 'Apple Health run',
          startedAt: workout.startDate.toISOString(),
          distanceMi: distance,
          durationSec: duration,
        };
        try {
          const stat = await workout.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min');
          const avg = bps(stat?.averageQuantity);
          const max = bps(stat?.maximumQuantity);
          if (avg != null) run.avgHr = avg;
          if (max != null) run.maxHr = max;
        } catch (cause) {
          warnings.push(`Heart-rate detail unavailable for run ${workout.uuid}: ${message(cause)}`);
        }
        try {
          const routes = await workout.getWorkoutRoutes();
          const locations = routes.flatMap((route) => route.locations);
          const clean = sanitizeRoute(locations);
          if (clean.length) run.points = clean;
        } catch (cause) {
          warnings.push(`GPS route detail unavailable for run ${workout.uuid}: ${message(cause)}`);
        }
        results.push(run);
      } catch (cause) {
        warnings.push(`A HealthKit running workout could not be normalized: ${message(cause)}`);
      } finally {
        // Nitro workout proxy retains native memory until disposed.
        workout.dispose();
      }
    }
    if (skipped) warnings.push(`${skipped} running workout(s) could not be normalized. See the specific reasons above.`);
    return results;
  },
};
