/** Pure, audit-friendly Step 7A policy. Auto-import ONLY workouts completed
 * after a user enables the setting, and ONLY from the current real OS provider.
 * No guessing distance, crossing source apps, or importing old history.
 */
import type { NormalizedActivity } from '../health/types';
import { activitySyncKey, buildActivityPayload } from './activity-sync';
import { activityMark, type AutoSyncState } from './auto-sync-state';
import type { ImportReceipt } from './import-history';

export const MAX_AUTO_BATCH = 5;

export function activityCompletedMs(item: NormalizedActivity): number | null {
  if (item.kind === 'run') {
    const start = Date.parse(item.startedAt);
    if (!Number.isFinite(start) || !Number.isFinite(item.durationSec) || item.durationSec <= 0) return null;
    return start + item.durationSec * 1000;
  }
  const performed = Date.parse(item.performedAt);
  return Number.isFinite(performed) ? performed : null;
}

export function eligibleAutoActivities(
  activities: ReadonlyArray<NormalizedActivity>,
  provider: 'fake' | 'apple' | 'health_connect',
  state: AutoSyncState,
  receipts: ReadonlyArray<ImportReceipt>,
  nowMs: number = Date.now(),
): NormalizedActivity[] {
  if (!state.enabled || provider === 'fake' || !state.enabledAt) return [];
  const enabledMs = Date.parse(state.enabledAt);
  if (!Number.isFinite(enabledMs)) return [];
  const succeeded = new Set(receipts.filter((r) => r.outcome === 'created' || r.outcome === 'updated')
    .map((r) => r.activityKey));
  const marked = new Set(state.syncedMarks);
  const deduped = new Set<string>();
  const selected: Array<{ item: NormalizedActivity; ms: number }> = [];
  for (const item of activities) {
    if (item.source !== provider) continue;
    const key = activitySyncKey(item);
    if (deduped.has(key) || succeeded.has(key) || marked.has(activityMark(key))) continue;
    const completed = activityCompletedMs(item);
    // Do not upload historic workouts, future-dated records, or unfinished runs.
    if (completed === null || completed < enabledMs || completed > nowMs + 60_000) continue;
    try { buildActivityPayload(item); } catch { continue; } // no invalid payloads
    deduped.add(key);
    selected.push({ item, ms: completed });
  }
  selected.sort((a, b) => a.ms - b.ms);
  return selected.slice(0, MAX_AUTO_BATCH).map((x) => x.item);
}
