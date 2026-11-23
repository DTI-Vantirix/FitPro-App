import Constants from 'expo-constants';
import type { ReadRecordsResult } from 'react-native-health-connect';
import { Platform } from 'react-native';
import type { HealthAdapter, NormalizedActivity, NormalizedRun } from './types';
import { normalizeAndroidRun, resolveAndroidDistance, RUNNING_TYPES } from './android-normalize';

/** All calls to Health Connect are foreground-only and strictly read-only. */
let permissionRequestedThisSession = false;
let warnings: string[] = [];
const lookbackDays = 30;
const maxRunCount = 50;

export function isAndroidHealthBuildAvailable(): boolean {
  return Platform.OS === 'android' && Constants.appOwnership !== 'expo'
    && Constants.executionEnvironment !== 'storeClient';
}

async function loadHealthConnect() {
  if (Platform.OS !== 'android') throw new Error('Health Connect is available only on Android.');
  if (!isAndroidHealthBuildAvailable()) throw new Error('Health Connect requires a FitPro Android development build; Expo Go does not include its native module.');
  try {
    return await import('react-native-health-connect');
  } catch (cause) {
    throw new Error(`Cannot load Health Connect native module. Build a new Android development client. ${explain(cause)}`);
  }
}
function explain(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function warn(text: string) { if (warnings.length < 35) warnings.push(text); }

export const androidHealthAdapter: HealthAdapter = {
  id: 'health_connect',
  displayName: 'Android Health Connect (read-only)',
  getReadWarnings: () => [...warnings],

  async requestReadAuthorization() {
    permissionRequestedThisSession = false;
    const hc = await loadHealthConnect();
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) {
      throw new Error(status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ? 'Health Connect needs to be installed or updated. Open the Health Connect app/Play Store, then retry.'
        : 'Health Connect is unavailable on this Android device. Android 8+ with a supported provider is required.');
    }
    if (!(await hc.initialize())) throw new Error('Health Connect could not initialize. Open or update Health Connect and retry.');
    // Read requests only. No write, route, history, or background permission.
    await hc.requestPermission([
      { accessType: 'read', recordType: 'ExerciseSession' },
      { accessType: 'read', recordType: 'Distance' },
      { accessType: 'read', recordType: 'HeartRate' },
    ]);
    const granted = await hc.getGrantedPermissions();
    for (const required of ['ExerciseSession', 'Distance'] as const) {
      if (!granted.some((permission) => permission.accessType === 'read' && permission.recordType === required)) {
        throw new Error(`Health Connect requires read access to ${required} to display running workouts. Grant it in Health Connect settings, then retry.`);
      }
    }
    permissionRequestedThisSession = true;
  },

  async readActivities(): Promise<ReadonlyArray<NormalizedActivity>> {
    if (!permissionRequestedThisSession) throw new Error('Request Health Connect read access before loading real activities.');
    const hc = await loadHealthConnect();
    const granted = await hc.getGrantedPermissions();
    for (const required of ['ExerciseSession', 'Distance'] as const) {
      if (!granted.some((permission) => permission.accessType === 'read' && permission.recordType === required)) {
        throw new Error(`Health Connect ${required} access was revoked. Request read authorization again.`);
      }
    }
    warnings = [];
    const hasHeartRate = granted.some((permission) => permission.accessType === 'read' && permission.recordType === 'HeartRate');
    if (!hasHeartRate) warn('Heart-rate access was not granted; runs will display without heart-rate metrics.');
    const until = new Date();
    const since = new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const timeRangeFilter = { operator: 'between' as const, startTime: since.toISOString(), endTime: until.toISOString() };
    // 30-day foreground read; do not request historical or background access.
    const sessions: ReadRecordsResult<'ExerciseSession'>['records'] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const response = await hc.readRecords('ExerciseSession', {
        timeRangeFilter, ascendingOrder: false, pageSize: 100, ...(pageToken ? { pageToken } : {}),
      });
      sessions.push(...response.records);
      pageToken = response.pageToken;
      if (!pageToken) break;
    }
    if (pageToken) warn('Very large Health Connect history was truncated at 500 sessions.');
    const running = sessions.filter((session) => RUNNING_TYPES.some((kind) => kind === session.exerciseType))
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)).slice(0, maxRunCount);
    const results: NormalizedRun[] = [];
    for (const [index, session] of running.entries()) {
      // Query all available sources for distance. Filtering by the session's
      // writer here would hide separately entered Health Connect Toolbox data.
      const timeRange = {
        operator: 'between' as const,
        startTime: new Date(Date.parse(session.startTime) - 60_000).toISOString(),
        endTime: new Date(Date.parse(session.endTime) + 60_000).toISOString(),
      };
      const origin = session.metadata?.dataOrigin;
      const distanceOptions = { timeRangeFilter: timeRange, pageSize: 100 };
      // Heart-rate stays source-specific; it must not be borrowed from another
      // workout/device merely because it happened at the same time.
      const heartOptions = { ...distanceOptions, ...(origin ? { dataOriginFilter: [origin] } : {}) };
      const sessionOverlapsAnother = sessions.some((other) => other !== session
        && Date.parse(other.startTime) < Date.parse(session.endTime)
        && Date.parse(other.endTime) > Date.parse(session.startTime));
      const sameMinuteSessionConflict = sessions.some((other) => other !== session
        && other.metadata?.dataOrigin === origin
        && Math.floor(Date.parse(other.startTime) / 60_000) === Math.floor(Date.parse(session.startTime) / 60_000)
        && Math.floor(Date.parse(other.endTime) / 60_000) === Math.floor(Date.parse(session.endTime) / 60_000));
      try {
        // Read all pages or skip the run if distance coverage could be incomplete.
        const distances: ReadRecordsResult<'Distance'>['records'] = [];
        let nextPage: string | undefined;
        let distanceComplete = false;
        for (let page = 0; page < 5; page++) {
          const response = await hc.readRecords('Distance', { ...distanceOptions, ...(nextPage ? { pageToken: nextPage } : {}) });
          distances.push(...response.records);
          nextPage = response.pageToken;
          if (!nextPage) { distanceComplete = true; break; }
        }
        if (!distanceComplete) { warn(`Running session #${index + 1} skipped: distance records exceeded 500 items.`); continue; }
        let heartRates: ReadRecordsResult<'HeartRate'>['records'] = [];
        if (hasHeartRate) {
          try {
            const heart = await hc.readRecords('HeartRate', heartOptions);
            heartRates = heart.records;
            if (heart.pageToken) warn(`Running session #${index + 1}: partial heart-rate samples (first 100 records only).`);
          } catch (cause) {
            warn(`Running session #${index + 1}: heart-rate detail unavailable (${explain(cause)}).`);
          }
        }
        const matchingOptions = { allowCrossSource: !sessionOverlapsAnother, allowShiftedSameSource: !sessionOverlapsAnother, allowSameMinuteSource: false /* Step 7B.2C: disable test-only minute fallback */ };
        const normalized = normalizeAndroidRun(session, distances, heartRates, matchingOptions);
        if (normalized.run) {
          results.push(normalized.run);
          const distanceMatch = resolveAndroidDistance(session, distances, matchingOptions);
          if (distanceMatch.kind === 'same_source_minute') {
            warn(`Running session #${index + 1}: TEST-ONLY minute-based distance match; seconds ignored. Check this pairing before trusting or uploading it.`);
          }
          if (distanceMatch.kind === 'cross_source_exact') {
            warn(`Running session #${index + 1}: distance matched by exact workout interval from a different app (${distanceMatch.source}); verify this pairing before any future upload.`);
          }
        } else {
          warn(`Running session #${index + 1} skipped: ${normalized.reasons.join('; ')}.`);
        }
        if (session.exerciseRoute?.type === 2) {
          warn(`Running session #${index + 1}: GPS route requires separate, per-workout consent; it was not requested.`);
        }
      } catch (cause) {
        warn(`Running session #${index + 1} could not be read: ${explain(cause)}.`);
      }
    }
    if (!results.length && !running.length) {
      warn('No running or treadmill sessions found in the last 30 days. Health Connect may restrict access to older data.');
    }
    return results;
  },
};
