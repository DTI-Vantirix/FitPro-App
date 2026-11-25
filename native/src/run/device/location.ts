/** GPS for a run, continuing with the screen locked and the app in the background.
 * The task is defined at module load, and native/index.js imports this file before
 * the router starts, so the OS can deliver fixes to a relaunched app.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { Fix } from '../tracker';

export const RUN_LOCATION_TASK = 'fitpro-run-location-v1';

let handler: ((fix: Fix) => void) | null = null;

type TaskBody = { data?: { locations?: Location.LocationObject[] }; error?: unknown };

TaskManager.defineTask(RUN_LOCATION_TASK, async (body: TaskBody) => {
  if (body.error || !handler) return;
  for (const location of body.data?.locations ?? []) {
    handler({
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      t: location.timestamp,
      accuracy: location.coords.accuracy ?? null,
      speed: location.coords.speed ?? null,
    });
  }
});

export type RunPermissions = { foreground: boolean };

/** Asks for location "while using the app" and nothing more. That is enough to keep
 * recording with the screen locked: on iOS the app holds a background location session it
 * started in the foreground, and on Android the foreground service does the same.
 * "Always" access is never requested. */
export async function requestRunPermissions(): Promise<RunPermissions> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  return { foreground: foreground.granted };
}

export async function startTracking(onFix: (fix: Fix) => void): Promise<void> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is needed to record a run.');
  handler = onFix;
  if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 0,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Recording your run',
      notificationBody: 'FitPro is tracking distance and pace.',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTracking(): Promise<void> {
  handler = null;
  if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
  }
}

/** One position for centring the map before the run starts. Null when it cannot be had. */
export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    const location = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: location.coords.latitude, lng: location.coords.longitude };
  } catch {
    return null;
  }
}
