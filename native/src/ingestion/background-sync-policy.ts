/**
 * FitPro Step 7B.1 — background delivery policy, NOT a running background worker.
 * Side-effect free: no health access, network requests, or task registration.
 * A future native scheduler must call this policy before touching health data and
 * again before each upload. Foreground auto-import opt-in does NOT authorize background.
 */
export type BackgroundPlatform = 'ios' | 'android' | 'other';
export type BackgroundProvider = 'apple' | 'health_connect' | 'fake';
export type BackgroundReadiness = Readonly<{
  platform: BackgroundPlatform;
  provider: BackgroundProvider;
  signedIn: boolean;
  consentAccepted: boolean;
  inviteVerified: boolean;
  separateBackgroundOptIn: boolean;
  nativeSchedulerInstalled: boolean;
  nativeHealthCapability: boolean;
  backgroundHealthPermission: boolean;
  productionSafeNormalization: boolean;
}>;

// Existing FitPro native builds have no registered OS background worker and no
// independently granted background-sync opt-in. NEVER change these to true
// merely because foreground auto-import is enabled.
export const CURRENT_BACKGROUND_FOUNDATION = Object.freeze({
  separateBackgroundOptIn: false,
  nativeSchedulerInstalled: false,
  nativeHealthCapability: false,
  backgroundHealthPermission: false,
  productionSafeNormalization: false,
});

export function backgroundBlockers(input: BackgroundReadiness): string[] {
  const problems: string[] = [];
  if (input.provider === 'fake') problems.push('Sample activities are never eligible for background upload.');
  if ((input.platform === 'ios' && input.provider !== 'apple') ||
      (input.platform === 'android' && input.provider !== 'health_connect') ||
      input.platform === 'other') problems.push('A matching iOS/Android health provider is required.');
  if (!input.signedIn) problems.push('A current user session is required.');
  if (!input.consentAccepted) problems.push('Health-import consent is required.');
  if (!input.inviteVerified) problems.push('Base44 invite access must be revalidated.');
  if (!input.separateBackgroundOptIn) problems.push('Background import needs a separate explicit opt-in.');
  if (!input.nativeSchedulerInstalled) problems.push('The native background task worker is not installed or registered.');
  if (!input.nativeHealthCapability) problems.push('A new native build with background health capabilities is required.');
  if (!input.backgroundHealthPermission) problems.push('OS background health access is not authorized.');
  if (!input.productionSafeNormalization) problems.push('Production-safe health data matching has not been verified.');
  return problems;
}

export type BackgroundCandidate = Readonly<{
  source: string;
  externalId: string;
  kind: 'run' | 'workout';
  startedAt?: string;
  durationSec?: number;
  performedAt?: string;
}>;

export const MAX_BACKGROUND_IMPORT_BATCH = 3;

function completedAt(item: BackgroundCandidate): number | null {
  if (item.kind === 'run') {
    const started = Date.parse(item.startedAt ?? '');
    const duration = item.durationSec;
    if (!Number.isFinite(started) || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 259200) return null;
    return started + duration * 1000;
  }
  const performed = Date.parse(item.performedAt ?? '');
  return Number.isFinite(performed) ? performed : null;
}

/** A dry-run preview for future background batches. No writes and no retry loops.
 * Never pull in historical workouts from before an independent background opt-in.
 * `succeededKeys` should be supplied from a receipt ledger; the server still
 * remains authoritative for source+external_id deduplication.
 */
export function selectBackgroundCandidates(
  input: BackgroundReadiness,
  activities: ReadonlyArray<BackgroundCandidate>,
  enabledAt: string | null,
  succeededKeys: ReadonlyArray<string>,
  nowMs = Date.now(),
): BackgroundCandidate[] {
  if (backgroundBlockers(input).length || !enabledAt) return [];
  const enabledMs = Date.parse(enabledAt);
  if (!Number.isFinite(enabledMs)) return [];
  const succeeded = new Set(succeededKeys);
  const visited = new Set<string>();
  const due: { item: BackgroundCandidate; end: number }[] = [];
  for (const item of activities) {
    if (item.source !== input.provider || !item.externalId || item.externalId.length > 200) continue;
    const key = `${item.source}:${item.externalId}`;
    if (visited.has(key) || succeeded.has(key)) continue;
    const end = completedAt(item);
    if (end === null || end < enabledMs || end > nowMs + 60_000) continue;
    visited.add(key);
    due.push({ item, end });
  }
  due.sort((a, b) => a.end - b.end);
  return due.slice(0, MAX_BACKGROUND_IMPORT_BATCH).map(({ item }) => item);
}
