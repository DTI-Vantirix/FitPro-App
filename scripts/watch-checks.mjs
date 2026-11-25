// Reruns every check whenever the code changes:
//   npm run check:watch
// Leave it running in a terminal. A change made while a run is in progress
// queues exactly one more run. Ctrl+C stops it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAll } from './check-all.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHED = ['server/src', 'server/test', 'server/migrations', 'server/entities', 'web/src', 'e2e', 'playwright.config.mjs'];
const IGNORED = /(^|[\\/])(\.results|node_modules|dist|uploads)([\\/]|$)/;
const QUIET_MS = 1500;

let timer = null;
let running = false;
let queued = false;

async function runChecks(reason) {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  console.log(`\n──── ${new Date().toLocaleTimeString()} · ${reason} ────`);
  try {
    await checkAll();
  } catch (err) {
    console.error(err);
  }
  running = false;
  if (queued) {
    queued = false;
    runChecks('changed during the last run');
  } else {
    console.log('Watching for changes…');
  }
}

for (const entry of WATCHED) {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) continue;
  fs.watch(full, { recursive: fs.statSync(full).isDirectory() }, (_event, file) => {
    const changed = file ? path.join(entry, String(file)) : entry;
    if (IGNORED.test(changed)) return;
    clearTimeout(timer);
    timer = setTimeout(() => runChecks(`${changed} changed`), QUIET_MS);
  });
}

runChecks('first run');
