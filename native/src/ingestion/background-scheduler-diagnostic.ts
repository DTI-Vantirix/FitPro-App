/** FitPro Step 7B.2a: OS scheduler smoke-test only.
 * Task must be defined globally before any registration, including headless starts.
 * There are NO health SDK imports, network calls, imports, or workouts in this task.
 * A separate background-health sync opt-in is intentionally NOT implemented here.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const FITPRO_DIAGNOSTIC_TASK = 'fitpro-background-scheduler-diagnostic-v1';
const DIAGNOSTIC_ENABLED = 'fitpro.native.6af5fd196ba44438a305cc72.background_diagnostic_enabled.v1';
const DIAGNOSTIC_LAST_TICK = 'fitpro.native.6af5fd196ba44438a305cc72.background_diagnostic_tick.v1';
const TOKEN_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.user.access_token';
const CONSENT_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.health_import_consent.v1';

if (!TaskManager.isTaskDefined(FITPRO_DIAGNOSTIC_TASK)) {
  TaskManager.defineTask(FITPRO_DIAGNOSTIC_TASK, async () => {
    // Never make a health or network call from this smoke-test worker.
    try {
      const enabled = await SecureStore.getItemAsync(DIAGNOSTIC_ENABLED);
      if (enabled !== 'yes') return BackgroundTask.BackgroundTaskResult.Success;
      const [token, consent] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(CONSENT_KEY),
      ]);
      if (!token || consent !== 'accepted:v1') return BackgroundTask.BackgroundTaskResult.Success;
      await SecureStore.setItemAsync(DIAGNOSTIC_LAST_TICK, new Date().toISOString(), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      // Availability of keychain while device is locked can vary by platform.
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export type BackgroundSchedulerDiagnosticStatus = Readonly<{
  available: boolean;
  registered: boolean;
  enabled: boolean;
  lastRun: string | null;
}>;

export async function backgroundSchedulerDiagnosticStatus(): Promise<BackgroundSchedulerDiagnosticStatus> {
  const [status, registered, flag, lastRun] = await Promise.all([
    BackgroundTask.getStatusAsync(),
    TaskManager.isTaskRegisteredAsync(FITPRO_DIAGNOSTIC_TASK),
    SecureStore.getItemAsync(DIAGNOSTIC_ENABLED),
    SecureStore.getItemAsync(DIAGNOSTIC_LAST_TICK),
  ]);
  return { available: status === BackgroundTask.BackgroundTaskStatus.Available,
    registered, enabled: flag === 'yes', lastRun };
}

export async function enableBackgroundSchedulerDiagnostic(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') throw new Error('A native iOS/Android build is required.');
  if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available) {
    throw new Error('Background scheduling is restricted on this device.');
  }
  const [token, consent] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(CONSENT_KEY),
  ]);
  if (!token || consent !== 'accepted:v1') throw new Error('Sign-in and health-import consent required.');
  await SecureStore.setItemAsync(DIAGNOSTIC_ENABLED, 'yes');
  try {
    await BackgroundTask.registerTaskAsync(FITPRO_DIAGNOSTIC_TASK, { minimumInterval: 60 });
  } catch (error) {
    await SecureStore.deleteItemAsync(DIAGNOSTIC_ENABLED);
    throw error;
  }
}

export async function disableBackgroundSchedulerDiagnostic(): Promise<void> {
  // Fail closed before attempting unregister. A stale worker checks this key.
  await SecureStore.deleteItemAsync(DIAGNOSTIC_ENABLED);
  if (await TaskManager.isTaskRegisteredAsync(FITPRO_DIAGNOSTIC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(FITPRO_DIAGNOSTIC_TASK);
  }
}

export async function clearBackgroundSchedulerDiagnostic(): Promise<void> {
  await disableBackgroundSchedulerDiagnostic();
  await SecureStore.deleteItemAsync(DIAGNOSTIC_LAST_TICK);
}

export async function triggerBackgroundSchedulerDiagnosticForTesting(): Promise<boolean> {
  if (!__DEV__) throw new Error('The diagnostic trigger is available only in development builds.');
  const result = await backgroundSchedulerDiagnosticStatus();
  if (!result.enabled || !result.registered) throw new Error('Enable the diagnostic scheduler first.');
  return BackgroundTask.triggerTaskWorkerForTestingAsync();
}
