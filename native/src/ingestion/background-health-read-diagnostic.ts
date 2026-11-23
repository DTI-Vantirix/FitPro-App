/** FitPro Step 7B.2B — opt-in READ-ONLY background health diagnostic.
 * Deliberately independent of the production import pipeline. Never uploads.
 * The app requests permissions in foreground only; headless task checks existing
 * grants and reads a BOUNDED number of samples. No health details are retained.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const FITPRO_HEALTH_READ_TASK = 'fitpro-background-health-read-diagnostic-v1';
const PREFIX = 'fitpro.native.6af5fd196ba44438a305cc72.';
const SETTING = `${PREFIX}background_health_read_diagnostic.v1`;
const RESULT = `${PREFIX}background_health_read_result.v1`;
const TOKEN = `${PREFIX}user.access_token`;
const CONSENT = `${PREFIX}health_import_consent.v1`;
const MAX_SAMPLES = 20;
export type RealProvider = 'apple' | 'health_connect';

type EnabledConfig = { provider: RealProvider; enabledAt: string };
export type HealthReadResult = Readonly<{
  at: string;
  provider: RealProvider;
  outcome: 'read_ok' | 'read_failed' | 'permission_missing' | 'skipped_gate';
  sessionCount?: number;
  distanceRecordCount?: number;
  truncated?: boolean;
}>;
export type HealthReadDiagnosticStatus = Readonly<{
  available: boolean;
  registered: boolean;
  enabled: boolean;
  provider: RealProvider | null;
  last: HealthReadResult | null;
}>;

function isProvider(value: unknown): value is RealProvider {
  return value === 'apple' || value === 'health_connect';
}
function decodeConfig(raw: string | null): EnabledConfig | null {
  if (!raw) return null;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const cfg = obj as Record<string, unknown>;
    if (!isProvider(cfg.provider) || typeof cfg.enabledAt !== 'string' || !Number.isFinite(Date.parse(cfg.enabledAt))) return null;
    return { provider: cfg.provider, enabledAt: cfg.enabledAt };
  } catch { return null; }
}
function matchesPlatform(provider: RealProvider): boolean {
  return (Platform.OS === 'ios' && provider === 'apple') ||
    (Platform.OS === 'android' && provider === 'health_connect');
}
async function grantedAndroidPermissions() {
  const hc = await import('react-native-health-connect');
  if (await hc.getSdkStatus() !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new Error('Health Connect unavailable or needs an update.');
  }
  if (!(await hc.initialize())) throw new Error('Health Connect could not initialize.');
  const granted = await hc.getGrantedPermissions();
  const has = (type: string) => granted.some(p => p.accessType === 'read' && p.recordType === type);
  return { hc, standard: has('ExerciseSession') && has('Distance'), background: has('BackgroundAccessPermission') };
}

async function diagnosticRead(provider: RealProvider): Promise<Pick<HealthReadResult, 'sessionCount'|'distanceRecordCount'|'truncated'>> {
  if (provider === 'health_connect') {
    const { hc, standard, background } = await grantedAndroidPermissions();
    if (!standard || !background) throw new Error('FITPRO_BACKGROUND_READ_PERMISSION_MISSING');
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const options = { timeRangeFilter: { operator: 'between' as const, startTime, endTime }, pageSize: MAX_SAMPLES };
    // Only bounded record counts. No routes, identifiers, timestamps or contents are stored.
    const sessions = await hc.readRecords('ExerciseSession', options);
    const distances = await hc.readRecords('Distance', options);
    return { sessionCount: sessions.records.length, distanceRecordCount: distances.records.length,
      truncated: Boolean(sessions.pageToken || distances.pageToken) };
  }
  const hk = await import('@kingstinct/react-native-healthkit');
  if (!(await hk.isHealthDataAvailableAsync())) throw new Error('Apple Health unavailable.');
  // Authorization was requested from the UI before registering this task.
  // Apple deliberately does not expose whether read access was granted.
  const workouts = await hk.queryWorkoutSamples({
    filter: { workoutActivityType: hk.WorkoutActivityType.running },
    ascending: false, limit: MAX_SAMPLES,
  });
  const count = workouts.length;
  for (const workout of workouts) workout.dispose();
  return { sessionCount: count, truncated: count === MAX_SAMPLES };
}

async function writeResult(value: HealthReadResult): Promise<void> {
  await SecureStore.setItemAsync(RESULT, JSON.stringify(value), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

if (!TaskManager.isTaskDefined(FITPRO_HEALTH_READ_TASK)) {
  TaskManager.defineTask(FITPRO_HEALTH_READ_TASK, async () => {
    // No permissions prompts, backend calls or background uploads in this task.
    let provider: RealProvider | null = null;
    try {
      const [enabled, token, consent] = await Promise.all([
        SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
      ]);
      const config = decodeConfig(enabled);
      if (!config) return BackgroundTask.BackgroundTaskResult.Success;
      provider = config.provider;
      if (!matchesPlatform(provider) || !token || consent !== 'accepted:v1') {
        // Do not retain a report tied to a withdrawn or changed session.
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      const stats = await diagnosticRead(provider);
      // Fail closed if consent/session/diagnostic changed while the read was executing.
      const [nextEnabled, nextToken, nextConsent] = await Promise.all([
        SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
      ]);
      if (nextEnabled !== enabled || nextToken !== token || nextConsent !== 'accepted:v1') {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await writeResult({ at: new Date().toISOString(), provider, outcome: 'read_ok', ...stats });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (cause) {
      // Do NOT persist OS error text, sample metadata, or raw health content.
      if (provider) {
        try {
          const [flag, token, consent] = await Promise.all([
            SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
          ]);
          if (decodeConfig(flag)?.provider === provider && token && consent === 'accepted:v1') {
            await writeResult({ at: new Date().toISOString(), provider,
              outcome: cause instanceof Error && cause.message === 'FITPRO_BACKGROUND_READ_PERMISSION_MISSING'
                ? 'permission_missing' : 'read_failed' });
          }
        } catch { /* No health data stored. */ }
      }
      // A diagnostic failure must not create an automatic retry loop.
      return BackgroundTask.BackgroundTaskResult.Success;
    }
  });
}

export async function healthReadDiagnosticStatus(): Promise<HealthReadDiagnosticStatus> {
  const [status, registered, flag, last] = await Promise.all([
    BackgroundTask.getStatusAsync(), TaskManager.isTaskRegisteredAsync(FITPRO_HEALTH_READ_TASK),
    SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(RESULT),
  ]);
  const parsed = decodeConfig(flag);
  let report: HealthReadResult | null = null;
  try {
    if (last) {
      const value = JSON.parse(last) as HealthReadResult;
      if (isProvider(value.provider) && typeof value.at === 'string' &&
        ['read_ok','read_failed','permission_missing','skipped_gate'].includes(value.outcome)) report = value;
    }
  } catch { /* ignore corrupt diagnostic report */ }
  return { available: status === BackgroundTask.BackgroundTaskStatus.Available,
    registered, enabled: Boolean(parsed), provider: parsed?.provider ?? null, last: report };
}

export async function enableHealthReadDiagnostic(provider: RealProvider): Promise<void> {
  if (!matchesPlatform(provider)) throw new Error('Select this device’s real health provider.');
  if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available)
    throw new Error('The native background scheduler is unavailable.');
  const [token, consent] = await Promise.all([SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT)]);
  if (!token || consent !== 'accepted:v1') throw new Error('Sign-in and health-import consent required.');
  if (provider === 'health_connect') {
    const { hc, standard, background } = await grantedAndroidPermissions();
    if (!standard) throw new Error('First grant ExerciseSession and Distance read permissions from Activities.');
    if (!background) {
      // Explicit on-screen action only; NEVER request OS permission from background task.
      await hc.requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }]);
      const updated = await hc.getGrantedPermissions();
      if (!updated.some(p => p.accessType === 'read' && p.recordType === 'BackgroundAccessPermission'))
        throw new Error('Background read permission was not granted. Check Health Connect Additional access.');
    }
  } else {
    const hk = await import('@kingstinct/react-native-healthkit');
    if (!(await hk.isHealthDataAvailableAsync())) throw new Error('Apple Health is unavailable.');
    // The API reports that the request completed, not which read types were granted.
    const completed = await hk.requestAuthorization({ toRead: [hk.WorkoutTypeIdentifier] });
    if (!completed) throw new Error('Apple Health read authorization request did not complete.');
    // The observer is registered only AFTER the local diagnostic opt-in is saved.
  }
  const config: EnabledConfig = { provider, enabledAt: new Date().toISOString() };
  await SecureStore.deleteItemAsync(RESULT);
  await SecureStore.setItemAsync(SETTING, JSON.stringify(config));
  try {
    if (provider === 'apple') {
      const hk = await import('@kingstinct/react-native-healthkit');
      // Persist a native workout observer across launch for notification only.
      // No observer callback content is read or uploaded by this milestone.
      await hk.configureBackgroundTypes([hk.WorkoutTypeIdentifier], hk.UpdateFrequency.hourly);
    }
    await BackgroundTask.registerTaskAsync(FITPRO_HEALTH_READ_TASK, { minimumInterval: 60 });
  } catch (error) {
    await SecureStore.deleteItemAsync(SETTING);
    if (provider === 'apple') {
      try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); } catch { /* do not conceal original error */ }
    }
    throw error;
  }
}

export async function disableHealthReadDiagnostic(): Promise<void> {
  // Fail-closed: revoke our local opt-in first, even when OS cancellation fails.
  await SecureStore.deleteItemAsync(SETTING);
  let failure: unknown = null;
  try {
    if (await TaskManager.isTaskRegisteredAsync(FITPRO_HEALTH_READ_TASK))
      await BackgroundTask.unregisterTaskAsync(FITPRO_HEALTH_READ_TASK);
  } catch (e) { failure = e; }
  if (Platform.OS === 'ios') {
    try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); }
    catch (e) { if (!failure) failure = e; }
  }
  if (failure) throw failure;
}

export async function clearBackgroundHealthReadDiagnostic(): Promise<void> {
  await SecureStore.deleteItemAsync(SETTING);
  // Never block sign-out if OS registration APIs fail; the worker still sees OFF.
  try {
    if (await TaskManager.isTaskRegisteredAsync(FITPRO_HEALTH_READ_TASK))
      await BackgroundTask.unregisterTaskAsync(FITPRO_HEALTH_READ_TASK);
  } catch { /* fail closed via deleted flag */ }
  if (Platform.OS === 'ios') {
    try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); }
    catch { /* no background reads after opt-in removed */ }
  }
  await SecureStore.deleteItemAsync(RESULT);
}

export async function triggerHealthReadDiagnosticForTesting(): Promise<void> {
  if (!__DEV__) throw new Error('Development build required to trigger the worker manually.');
  const state = await healthReadDiagnosticStatus();
  if (!state.enabled || !state.registered) throw new Error('Enable background health read diagnostic first.');
  // Expo Android testing may return null even when the worker runs; check last report.
  await BackgroundTask.triggerTaskWorkerForTestingAsync();
}
