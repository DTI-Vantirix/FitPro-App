/** FitPro Step 7B.2C — controlled native BACKGROUND UPLOAD pilot.
 * OFF by default; separate foreground opt-in; max ONE newly completed run/tick;
 * guarded Android same-writer SAME-MINUTE whole-run distance; no routes/HR; no retries.
 * NEVER write to HealthKit/Health Connect. Only existing authenticated ingestActivity.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getInviteStatus } from '../access/invite-api';
import type { NormalizedRun } from '../health/types';
import { toMiles, toSeconds } from '../health/apple-normalize';
import { activitySyncKey, submitHealthActivity } from './activity-sync';
import { activityMark, loadAutoSyncState } from './auto-sync-state';
import { loadImportHistory } from './import-history';
import { strictAndroidBackgroundRun, selectSafeBackgroundPilot,
  type BackgroundProvider, type BackgroundSession, type BackgroundDistance } from './background-sync-safe';

export const FITPRO_BACKGROUND_SYNC_TASK = 'fitpro-background-sync-pilot-v1';
const PREFIX = 'fitpro.native.6af5fd196ba44438a305cc72.';
const SETTING = `${PREFIX}background_sync_pilot.v1`;
const LEDGER = `${PREFIX}background_sync_pilot_marks.v1`;
const REPORT = `${PREFIX}background_sync_pilot_report.v1`;
const TOKEN = `${PREFIX}user.access_token`;
const CONSENT = `${PREFIX}health_import_consent.v1`;
const MAX_MARKS = 75; // SecureStore small-value budget; no raw IDs stored.
const MAX_SESSIONS = 50;
const MAX_DISTANCE_RECORDS = 100;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

type PilotConfig = Readonly<{ provider: BackgroundProvider; enabledAt: string; paused: boolean }>;
export type PilotOutcome = 'uploaded' | 'no_new_eligible' | 'strict_match_skipped' | 'permission_missing' |
  'invite_unverified' | 'read_failed' | 'upload_failed_paused' | 'storage_failed_paused';
export type PilotReport = Readonly<{
  at: string; provider: BackgroundProvider; outcome: PilotOutcome;
  created: number; updated: number; unsafeSkipped: number;
}>;
export type PilotStatus = Readonly<{
  available: boolean; registered: boolean; enabled: boolean; paused: boolean;
  provider: BackgroundProvider | null; enabledAt: string | null; last: PilotReport | null;
}>;

function providerMatchesOS(provider: BackgroundProvider): boolean {
  return (Platform.OS === 'android' && provider === 'health_connect') ||
    (Platform.OS === 'ios' && provider === 'apple');
}
function decodeConfig(raw: string | null): PilotConfig | null {
  if (!raw) return null;
  try {
    const val: unknown = JSON.parse(raw);
    if (!val || typeof val !== 'object') return null;
    const obj = val as Record<string, unknown>;
    if ((obj.provider !== 'apple' && obj.provider !== 'health_connect') ||
      typeof obj.enabledAt !== 'string' || !Number.isFinite(Date.parse(obj.enabledAt)) ||
      typeof obj.paused !== 'boolean') return null;
    return { provider: obj.provider, enabledAt: obj.enabledAt, paused: obj.paused };
  } catch { return null; }
}
function decodeMarks(raw: string | null): string[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > MAX_MARKS ||
    value.some((x) => typeof x !== 'string' || !/^[0-9a-f]{16}$/.test(x))) {
    throw new Error('Invalid local background receipt ledger; background upload paused.');
  }
  return value as string[];
}
function decodeReport(raw: string | null): PilotReport | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if ((obj.provider !== 'apple' && obj.provider !== 'health_connect') ||
      typeof obj.at !== 'string' || !Number.isFinite(Date.parse(obj.at)) ||
      !['uploaded','no_new_eligible','strict_match_skipped','permission_missing','invite_unverified',
        'read_failed','upload_failed_paused','storage_failed_paused'].includes(String(obj.outcome)) ||
      typeof obj.created !== 'number' || typeof obj.updated !== 'number' || typeof obj.unsafeSkipped !== 'number') return null;
    return value as PilotReport;
  } catch { return null; }
}
async function saveReport(provider: BackgroundProvider, outcome: PilotOutcome,
  created = 0, updated = 0, unsafeSkipped = 0): Promise<void> {
  await SecureStore.setItemAsync(REPORT, JSON.stringify({
    at: new Date().toISOString(), provider, outcome, created, updated, unsafeSkipped,
  } satisfies PilotReport), WRITE_OPTIONS);
}
async function gate(configString: string, token: string): Promise<boolean> {
  // A changed account, revoked consent, disabled or paused setting stops the next upload.
  const [nextSetting, nextToken, nextConsent] = await Promise.all([
    SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
  ]);
  return nextSetting === configString && nextToken === token && nextConsent === 'accepted:v1' &&
    !decodeConfig(nextSetting)?.paused;
}
async function pause(configString: string, provider: BackgroundProvider,
  outcome: PilotOutcome, skipped = 0): Promise<void> {
  const [raw, token, consent] = await Promise.all([
    SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
  ]);
  const cfg = decodeConfig(raw);
  if (raw !== configString || !cfg || !token || consent !== 'accepted:v1') return;
  // Fail closed first. If persistence fails, deleting the opt-in prevents later retries.
  try { await SecureStore.setItemAsync(SETTING, JSON.stringify({ ...cfg, paused: true }), WRITE_OPTIONS); }
  catch { await SecureStore.deleteItemAsync(SETTING); return; }
  await saveReport(provider, outcome, 0, 0, skipped);
}

async function readAndroidRuns(enabledAt: string): Promise<{ activities: NormalizedRun[]; unsafeSkipped: number }> {
  const hc = await import('react-native-health-connect');
  if (await hc.getSdkStatus() !== hc.SdkAvailabilityStatus.SDK_AVAILABLE || !(await hc.initialize()))
    throw new Error('READ_FAILED');
  const permissions = await hc.getGrantedPermissions();
  for (const recordType of ['ExerciseSession','Distance','BackgroundAccessPermission']) {
    if (!permissions.some((p) => p.accessType === 'read' && p.recordType === recordType))
      throw new Error('PERMISSION_MISSING');
  }
  const now = Date.now();
  const since = new Date(Math.max(now - WINDOW_MS, Date.parse(enabledAt) - 86_400_000)).toISOString();
  const timeRangeFilter = { operator: 'between' as const, startTime: since, endTime: new Date(now).toISOString() };
  const response = await hc.readRecords('ExerciseSession', { timeRangeFilter, ascendingOrder: false, pageSize: MAX_SESSIONS });
  // If not fully enumerated, an overlapping competing session might be hidden.
  if (response.pageToken) throw new Error('READ_FAILED');
  const inventory: BackgroundSession[] = response.records.map((r) => ({
    startTime: r.startTime, endTime: r.endTime, exerciseType: r.exerciseType,
    title: r.title, metadata: { id: r.metadata?.id, dataOrigin: r.metadata?.dataOrigin },
  }));
  const relevant = inventory.filter((s) => (s.exerciseType === 56 || s.exerciseType === 57) &&
    Date.parse(s.endTime) >= Date.parse(enabledAt) && Date.parse(s.endTime) <= now)
    .sort((a, b) => Date.parse(a.endTime) - Date.parse(b.endTime)).slice(0, 10);
  const activities: NormalizedRun[] = [];
  let unsafeSkipped = 0;
  for (const session of relevant) {
    const from = Date.parse(session.startTime), to = Date.parse(session.endTime);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 259200000) {
      unsafeSkipped++; continue;
    }
    // Expand the query to the complete minute at BOTH boundaries. Without
    // this, Health Connect can exclude a manually entered same-minute record
    // whose timestamps extend a few seconds before/after the session.
    // Pairing itself remains guarded by strictAndroidBackgroundRun().
    const queryStart = new Date(Math.floor(from / 60_000) * 60_000).toISOString();
    const queryEnd = new Date((Math.floor(to / 60_000) + 1) * 60_000).toISOString();
    const distances = await hc.readRecords('Distance', {
      timeRangeFilter: { operator: 'between' as const, startTime: queryStart, endTime: queryEnd },
      pageSize: MAX_DISTANCE_RECORDS,
    });
    if (distances.pageToken) { unsafeSkipped++; continue; }
    const candidates: BackgroundDistance[] = distances.records.map((r) => ({
      startTime: r.startTime, endTime: r.endTime, distance: { inMeters: r.distance.inMeters },
      metadata: { dataOrigin: r.metadata?.dataOrigin },
    }));
    const normalized = strictAndroidBackgroundRun(session, candidates, inventory);
    if (normalized) activities.push(normalized); else unsafeSkipped++;
  }
  return { activities, unsafeSkipped };
}

async function readAppleRuns(enabledAt: string): Promise<{ activities: NormalizedRun[]; unsafeSkipped: number }> {
  const hk = await import('@kingstinct/react-native-healthkit');
  if (!(await hk.isHealthDataAvailableAsync())) throw new Error('READ_FAILED');
  // No HealthKit authorization prompt from the headless worker.
  const workouts = await hk.queryWorkoutSamples({
    filter: { workoutActivityType: hk.WorkoutActivityType.running }, ascending: false, limit: MAX_SESSIONS,
  });
  const result: NormalizedRun[] = [];
  let unsafeSkipped = 0;
  try {
    for (const workout of workouts) {
      const miles = workout.totalDistance ? toMiles(workout.totalDistance.quantity, workout.totalDistance.unit) : null;
      const seconds = toSeconds(workout.duration.quantity, workout.duration.unit);
      const uuid = workout.uuid?.trim();
      const startedAt = workout.startDate.toISOString();
      const end = Date.parse(startedAt) + (seconds ?? 0) * 1000;
      if (miles === null || seconds === null || !uuid || uuid.length > 200 ||
        !Number.isFinite(end) || end > Date.now() || end < Date.parse(enabledAt)) {
        unsafeSkipped++; continue;
      }
      result.push({ kind: 'run', source: 'apple', externalId: uuid, startedAt,
        distanceMi: miles, durationSec: seconds, routeName: 'Apple Health run' });
    }
  } finally {
    // Nitro proxies must be disposed even when an individual sample is invalid.
    for (const workout of workouts) workout.dispose();
  }
  return { activities: result, unsafeSkipped };
}

let inFlight = false;
async function runPilotWorker(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  let raw: string | null = null;
  let provider: BackgroundProvider | null = null;
  try {
    const [setting, token, consent] = await Promise.all([
      SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT),
    ]);
    raw = setting;
    const config = decodeConfig(setting);
    if (!config || config.paused || !token || consent !== 'accepted:v1' || !providerMatchesOS(config.provider)) return;
    provider = config.provider;
    // Revalidate server-side invite before touching device health data or uploading.
    let invited = false;
    try { invited = (await getInviteStatus(token)).allowed === true; } catch { /* fail closed */ }
    if (!invited) { await pause(setting!, provider, 'invite_unverified'); return; }
    if (!await gate(setting!, token)) return;
    let reading: { activities: NormalizedRun[]; unsafeSkipped: number };
    try { reading = provider === 'apple' ? await readAppleRuns(config.enabledAt) : await readAndroidRuns(config.enabledAt); }
    catch (error) {
      await pause(setting!, provider, error instanceof Error && error.message === 'PERMISSION_MISSING'
        ? 'permission_missing' : 'read_failed'); return;
    }
    if (!await gate(setting!, token)) return;
    let marks: string[];
    let receipts: Awaited<ReturnType<typeof loadImportHistory>>;
    let foreground: Awaited<ReturnType<typeof loadAutoSyncState>>;
    try {
      [marks, receipts, foreground] = await Promise.all([
        SecureStore.getItemAsync(LEDGER).then(decodeMarks), loadImportHistory(), loadAutoSyncState(),
      ]);
    } catch { await pause(setting!, provider, 'storage_failed_paused'); return; }
    const due = selectSafeBackgroundPilot(reading.activities, provider, config.enabledAt,
      marks, receipts, foreground.syncedMarks);
    if (!due.length) {
      if (await gate(setting!, token)) await saveReport(provider,
        reading.unsafeSkipped ? 'strict_match_skipped' : 'no_new_eligible', 0, 0, reading.unsafeSkipped);
      return;
    }
    // Exactly one activity per scheduled execution, and no automatic retry on failure.
    const run = due[0];
    if (!await gate(setting!, token)) return;
    try {
      const result = await submitHealthActivity(run, token);
      if (!await gate(setting!, token)) return;
      const mark = activityMark(activitySyncKey(run));
      const latest = decodeMarks(await SecureStore.getItemAsync(LEDGER));
      const next = [...latest.filter((m) => m !== mark), mark].slice(-MAX_MARKS);
      await SecureStore.setItemAsync(LEDGER, JSON.stringify(next), WRITE_OPTIONS);
      await saveReport(provider, 'uploaded', result.action === 'created' ? 1 : 0,
        result.action === 'updated' ? 1 : 0, reading.unsafeSkipped);
    } catch {
      // A timeout may have uploaded remotely. Stop before another unattended attempt.
      await pause(setting!, provider, 'upload_failed_paused', reading.unsafeSkipped);
    }
  } finally { inFlight = false; }
}

if (!TaskManager.isTaskDefined(FITPRO_BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(FITPRO_BACKGROUND_SYNC_TASK, async () => {
    try { await runPilotWorker(); } catch { /* Fail closed: never auto-retry within this worker. */ }
    return BackgroundTask.BackgroundTaskResult.Success;
  });
}

export async function backgroundSyncPilotStatus(): Promise<PilotStatus> {
  const [available, registered, flag, report] = await Promise.all([
    BackgroundTask.getStatusAsync(), TaskManager.isTaskRegisteredAsync(FITPRO_BACKGROUND_SYNC_TASK),
    SecureStore.getItemAsync(SETTING), SecureStore.getItemAsync(REPORT),
  ]);
  const config = decodeConfig(flag);
  return { available: available === BackgroundTask.BackgroundTaskStatus.Available,
    registered, enabled: Boolean(config), paused: Boolean(config?.paused),
    provider: config?.provider ?? null, enabledAt: config?.enabledAt ?? null, last: decodeReport(report) };
}

export async function enableBackgroundSyncPilot(provider: BackgroundProvider): Promise<void> {
  if (!providerMatchesOS(provider)) throw new Error('Choose the actual OS health provider.');
  if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available)
    throw new Error('OS background scheduling is unavailable.');
  const [token, consent] = await Promise.all([SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(CONSENT)]);
  if (!token || consent !== 'accepted:v1') throw new Error('Sign-in and health-import consent are required.');
  // Do not allow legacy diagnostics to clear our observer or reschedule the same native worker.
  if (await TaskManager.isTaskRegisteredAsync('fitpro-background-health-read-diagnostic-v1') ||
      await TaskManager.isTaskRegisteredAsync('fitpro-background-scheduler-diagnostic-v1')) {
    throw new Error('Stop both Step 7B.2A and 7B.2B diagnostics before enabling background uploads.');
  }
  const invited = await getInviteStatus(token);
  if (!invited.allowed) throw new Error('FitPro invite access is not currently authorized.');
  if (provider === 'health_connect') {
    const hc = await import('react-native-health-connect');
    if (await hc.getSdkStatus() !== hc.SdkAvailabilityStatus.SDK_AVAILABLE || !(await hc.initialize()))
      throw new Error('Health Connect unavailable.');
    const granted = await hc.getGrantedPermissions();
    const has = (recordType: string) => granted.some((p) => p.accessType === 'read' && p.recordType === recordType);
    if (!has('ExerciseSession') || !has('Distance'))
      throw new Error('Grant Health Connect ExerciseSession and Distance read access before enabling.');
    if (!has('BackgroundAccessPermission')) {
      // Explicit foreground action only: never ask for permission in a headless task.
      await hc.requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }]);
      const next = await hc.getGrantedPermissions();
      if (!next.some((p) => p.accessType === 'read' && p.recordType === 'BackgroundAccessPermission'))
        throw new Error('Health Connect background access was not granted.');
    }
  } else {
    const hk = await import('@kingstinct/react-native-healthkit');
    if (!(await hk.isHealthDataAvailableAsync())) throw new Error('Apple Health is unavailable.');
    const completed = await hk.requestAuthorization({ toRead: [hk.WorkoutTypeIdentifier] });
    if (!completed) throw new Error('Apple Health read authorization request did not complete.');
  }
  // New opt-in never backfills history. Previous local receipts are reset.
  const cfg: PilotConfig = { provider, enabledAt: new Date().toISOString(), paused: false };
  await SecureStore.deleteItemAsync(REPORT);
  await SecureStore.deleteItemAsync(LEDGER);
  await SecureStore.setItemAsync(SETTING, JSON.stringify(cfg), WRITE_OPTIONS);
  try {
    if (provider === 'apple') {
      const hk = await import('@kingstinct/react-native-healthkit');
      await hk.configureBackgroundTypes([hk.WorkoutTypeIdentifier], hk.UpdateFrequency.hourly);
    }
    await BackgroundTask.registerTaskAsync(FITPRO_BACKGROUND_SYNC_TASK, { minimumInterval: 60 });
  } catch (error) {
    await SecureStore.deleteItemAsync(SETTING);
    if (provider === 'apple') {
      try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); }
      catch { /* opt-in already removed */ }
    }
    throw error;
  }
}

export async function disableBackgroundSyncPilot(): Promise<void> {
  // Removing opt-in BEFORE unregistering is the critical fail-closed behavior.
  await SecureStore.deleteItemAsync(SETTING);
  let problem: unknown = null;
  try {
    if (await TaskManager.isTaskRegisteredAsync(FITPRO_BACKGROUND_SYNC_TASK))
      await BackgroundTask.unregisterTaskAsync(FITPRO_BACKGROUND_SYNC_TASK);
  } catch (error) { problem = error; }
  if (Platform.OS === 'ios') {
    try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); }
    catch (error) { if (!problem) problem = error; }
  }
  await SecureStore.deleteItemAsync(LEDGER);
  await SecureStore.deleteItemAsync(REPORT);
  if (problem) throw problem;
}

export async function clearBackgroundSyncPilot(): Promise<void> {
  // Called on every account/consent reset, even if the OS worker cannot be unregistered.
  await SecureStore.deleteItemAsync(SETTING);
  try { if (await TaskManager.isTaskRegisteredAsync(FITPRO_BACKGROUND_SYNC_TASK))
    await BackgroundTask.unregisterTaskAsync(FITPRO_BACKGROUND_SYNC_TASK); } catch { /* setting OFF */ }
  if (Platform.OS === 'ios') {
    try { const hk = await import('@kingstinct/react-native-healthkit'); await hk.clearBackgroundTypes(); }
    catch { /* setting OFF */ }
  }
  await SecureStore.deleteItemAsync(LEDGER);
  await SecureStore.deleteItemAsync(REPORT);
}

export async function triggerBackgroundSyncPilotForTesting(): Promise<void> {
  if (!__DEV__) throw new Error('Development build required for a manual worker trigger.');
  const status = await backgroundSyncPilotStatus();
  if (!status.enabled || status.paused || !status.registered)
    throw new Error('Enable the pilot and resolve any paused status before triggering.');
  await BackgroundTask.triggerTaskWorkerForTestingAsync();
}
