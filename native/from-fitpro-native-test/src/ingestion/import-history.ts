/** Step 6 local receipts, not a copy of raw health records.
 * Stored in existing Expo SecureStore. Wiped on consent withdrawal and sign-out.
 * Local-only receipts are NOT a guaranteed reflection of the remote database.
 */
import * as SecureStore from 'expo-secure-store';
import type { SyncSource } from './activity-sync';

export const IMPORT_HISTORY_KEY = 'fitpro.native.6af5fd196ba44438a305cc72.sync_receipts.v1';
export type ImportOutcome = 'created' | 'updated' | 'skipped' | 'failed';
export type ImportReceipt = Readonly<{
  activityKey: string;
  source: SyncSource;
  kind: 'run' | 'workout';
  outcome: ImportOutcome;
  completedAt: string;
  httpStatus?: number;
}>;

export async function loadImportHistory(): Promise<ImportReceipt[]> {
  const saved = await SecureStore.getItemAsync(IMPORT_HISTORY_KEY);
  if (!saved) return [];
  try {
    const list: unknown = JSON.parse(saved);
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is ImportReceipt => x && typeof x === 'object'
      && typeof x.activityKey === 'string' && x.activityKey.length <= 240
      && (x.source === 'apple' || x.source === 'health_connect')
      && (x.kind === 'run' || x.kind === 'workout')
      && ['created', 'updated', 'skipped', 'failed'].includes(x.outcome)
      && typeof x.completedAt === 'string').slice(0, 12);
  } catch {
    return [];
  }
}

export async function appendImportReceipt(receipt: ImportReceipt): Promise<ImportReceipt[]> {
  const previous = await loadImportHistory();
  const next = [receipt, ...previous].slice(0, 12);
  // iOS SecureStore has per-item size constraints; keep only short receipts.
  while (next.length && JSON.stringify(next).length > 1600) next.pop();
  await SecureStore.setItemAsync(IMPORT_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearImportHistory(): Promise<void> {
  await SecureStore.deleteItemAsync(IMPORT_HISTORY_KEY);
}
