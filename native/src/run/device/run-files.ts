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

/** Writes to a temporary file and moves it into place, so a write cut short by the
 * app being killed can never leave half a run where a whole one used to be. */
function writeAtomic(target: File, text: string): void {
  const temp = new File(target.parentDirectory, `${target.name}.tmp`);
  if (temp.exists) temp.delete();
  temp.create();
  temp.write(text);
  if (target.exists) target.delete();
  temp.move(target);
}

export const runStore: RunStore = {
  async list(): Promise<string[]> {
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

function checkpointFile(): File {
  return new File(runsDir(), 'active-run.checkpoint');
}

export const runCheckpoint = {
  async save(state: RunState): Promise<void> {
    writeAtomic(checkpointFile(), JSON.stringify(state));
  },
  async load(): Promise<RunState | null> {
    const file = checkpointFile();
    if (!file.exists) return null;
    try {
      const state = JSON.parse(await file.text()) as RunState;
      return state && typeof state === 'object' && state.config && state.track ? state : null;
    } catch {
      return null;
    }
  },
  async clear(): Promise<void> {
    const file = checkpointFile();
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
