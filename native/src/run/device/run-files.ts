/** Runs on the phone's disk: one JSON file per finished run, plus the checkpoint of
 * the run in progress. They live in the app's documents folder, which the OS does
 * not clear, so a run survives the app being closed, the phone restarting, and any
 * number of failed uploads.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { RunState } from '../engine';
import type { RunStore, StoredRun } from '../queue';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function runsDir(): Directory {
  const dir = new Directory(Paths.document, 'fitpro-runs');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function runFile(id: string): File {
  if (!SAFE_ID.test(id)) throw new Error('Unexpected run id.');
  return new File(runsDir(), `${id}.json`);
}

const TMP = '.tmp';

/** Writes to a temporary file and moves it over the old one in a single step, so a write
 * cut short by the app being killed leaves either the old file or the new one, never
 * neither and never half. */
function writeAtomic(target: File, text: string): void {
  const temp = new File(target.parentDirectory, `${target.name}${TMP}`);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(text);
  temp.move(target, { overwrite: true });
}

/** If a move was ever interrupted on a system where it is not a single step, the complete
 * new copy is still sitting beside where it belongs. Put it back rather than lose it. */
function adoptOrphans(dir: Directory): void {
  for (const entry of dir.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith(TMP)) continue;
    try {
      const target = new File(dir, entry.name.slice(0, -TMP.length));
      if (target.exists) continue;
      JSON.parse(entry.textSync());
      entry.move(target);
    } catch { /* an unreadable temp file is an unfinished write: the real file, if any, is intact */ }
  }
}

export const runStore: RunStore = {
  async list(): Promise<string[]> {
    adoptOrphans(runsDir());
    return runsDir().list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((id) => SAFE_ID.test(id));
  },
  async read(id: string): Promise<StoredRun | null> {
    const file = runFile(id);
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as StoredRun;
  },
  async write(id: string, run: StoredRun): Promise<void> {
    writeAtomic(runFile(id), JSON.stringify(run));
  },
  async remove(id: string): Promise<void> {
    const file = runFile(id);
    if (file.exists) file.delete();
  },
};

function checkpointFile(ownerId: string): File {
  if (!SAFE_ID.test(ownerId)) throw new Error('Unexpected account id.');
  return new File(runsDir(), `active-run-${ownerId}.checkpoint`);
}

export const runCheckpoint = {
  async save(state: RunState): Promise<void> {
    writeAtomic(checkpointFile(state.config.ownerId), JSON.stringify(state));
  },
  async load(ownerId: string): Promise<RunState | null> {
    adoptOrphans(runsDir());
    const file = checkpointFile(ownerId);
    if (!file.exists) return null;
    try {
      const state = JSON.parse(await file.text()) as RunState;
      return state && typeof state === 'object' && state.config && state.track ? state : null;
    } catch {
      return null;
    }
  },
  async clear(ownerId: string): Promise<void> {
    const file = checkpointFile(ownerId);
    if (file.exists) file.delete();
  },
};

/** Small things worth having without a connection (zones, profile, saved routes), so a
 * runner with no signal at the start can still run. Never the source of truth. */
export const deviceCache = {
  async read<T>(name: string): Promise<T | null> {
    if (!SAFE_ID.test(name)) return null;
    try {
      const file = new File(runsDir(), `${name}.cache`);
      return file.exists ? (JSON.parse(await file.text()) as T) : null;
    } catch {
      return null;
    }
  },
  async write(name: string, value: unknown): Promise<void> {
    if (!SAFE_ID.test(name)) return;
    try { writeAtomic(new File(runsDir(), `${name}.cache`), JSON.stringify(value)); } catch { /* a cache that cannot be written is only a cache */ }
  },
  async remove(name: string): Promise<void> {
    if (!SAFE_ID.test(name)) return;
    try {
      const file = new File(runsDir(), `${name}.cache`);
      if (file.exists) file.delete();
    } catch { /* nothing to remove */ }
  },
};
