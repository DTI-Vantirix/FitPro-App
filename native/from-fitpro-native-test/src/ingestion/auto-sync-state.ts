/** Step 7A foreground opt-in. Stores only an on/off preference, enabled-at time,
 * and bounded pseudonymous dedupe fingerprints. No raw health samples are stored.
 * Local state is NOT a server-side sync ledger: Base44 remains authoritative.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'fitpro.native.6af5fd196ba44438a305cc72.foreground_auto.v1';
const MAX_MARKS = 50;

export type AutoSyncState = Readonly<{
  enabled: boolean;
  enabledAt: string | null;
  syncedMarks: ReadonlyArray<string>;
}>;

export const DISABLED_AUTO_SYNC: AutoSyncState = { enabled: false, enabledAt: null, syncedMarks: [] };

/** Two independent noncryptographic hashes, used ONLY to reduce repeated requests.
 * A hash collision cannot merge server records; Base44 still keys by source/external_id.
 */
export function activityMark(key: string): string {
  let a = 0x811c9dc5;
  let b = 0x72a5b2d1;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x27d4eb2d) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function decode(input: string | null): AutoSyncState {
  if (!input) return DISABLED_AUTO_SYNC;
  const raw: unknown = JSON.parse(input);
  if (!raw || typeof raw !== 'object') throw new Error('Invalid stored automatic-import preference.');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') throw new Error('Invalid automatic-import enabled setting.');
  if (obj.enabled && (typeof obj.enabledAt !== 'string' || !Number.isFinite(Date.parse(obj.enabledAt)))) {
    throw new Error('Automatic-import start timestamp is missing or invalid.');
  }
  if (!Array.isArray(obj.syncedMarks) || obj.syncedMarks.some((mark) => typeof mark !== 'string' || !/^[0-9a-f]{16}$/.test(mark))) {
    throw new Error('Automatic-import receipt index is invalid.');
  }
  return { enabled: obj.enabled, enabledAt: typeof obj.enabledAt === 'string' ? obj.enabledAt : null,
    syncedMarks: obj.syncedMarks.slice(-MAX_MARKS) };
}

export async function loadAutoSyncState(): Promise<AutoSyncState> {
  // Fail closed on corrupt or inaccessible storage; NEVER implicitly enable.
  try { return decode(await SecureStore.getItemAsync(KEY)); }
  catch (cause) { throw new Error(`Automatic import paused: cannot read preferences (${String(cause)}).`); }
}

async function save(state: AutoSyncState): Promise<AutoSyncState> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(state));
  return state;
}

export async function setAutoSyncEnabled(enabled: boolean, now = new Date()): Promise<AutoSyncState> {
  if (!enabled) return save(DISABLED_AUTO_SYNC);
  const enabledAt = now.toISOString();
  return save({ enabled: true, enabledAt, syncedMarks: [] });
}

export async function markActivitySynced(state: AutoSyncState, key: string): Promise<AutoSyncState> {
  if (!state.enabled) return state;
  const mark = activityMark(key);
  const marks = [...state.syncedMarks.filter((m) => m !== mark), mark].slice(-MAX_MARKS);
  return save({ ...state, syncedMarks: marks });
}

export async function clearAutoSyncState(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
