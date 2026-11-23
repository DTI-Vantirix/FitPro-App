import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(import.meta.dirname, '..');
function transpile(file, deps = {}) {
  const output = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file} failed TS syntax checks`);
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, {
    module, exports: module.exports, require: (name) => {
      if (!(name in deps)) throw Error(`Undeclared test dependency ${name} in ${file}`);
      return deps[name];
    }, console, Date, Set, Math, JSON,
  }, { filename: file });
  return module.exports;
}
const store = new Map();
const secureStore = {
  getItemAsync: async (key) => store.get(key) ?? null,
  setItemAsync: async (key, value) => { store.set(key, value); },
  deleteItemAsync: async (key) => { store.delete(key); },
};
const state = transpile('src/ingestion/auto-sync-state.ts', {'expo-secure-store': secureStore});
const sync = transpile('src/ingestion/activity-sync.ts', { '../config': { INGEST_URL: 'https://fit-pro-a305cc72.base44.app/functions/ingestActivity' } });
const select = transpile('src/ingestion/auto-sync-selection.ts', {
  './activity-sync': sync, './auto-sync-state': state,
});
const now = '2026-11-12T22:00:00.000Z';
const oldRun = { kind:'run', source:'health_connect', externalId:'old', routeName:'Old', startedAt:'2026-11-12T20:00:00.000Z', durationSec:1800, distanceMi:1 };
const recentRun = { ...oldRun, externalId:'new', startedAt:'2026-11-12T22:05:00.000Z' };
const appleRun = { ...recentRun, externalId:'apple', source:'apple' };
assert.equal((await state.loadAutoSyncState()).enabled, false, 'Must default OFF');
assert.equal(select.eligibleAutoActivities([recentRun], 'health_connect', state.DISABLED_AUTO_SYNC, []).length, 0);
const enabled = await state.setAutoSyncEnabled(true, new Date(now));
assert.equal(enabled.enabled, true);
assert.equal((await state.loadAutoSyncState()).enabled, true);
const due = select.eligibleAutoActivities([oldRun, recentRun, appleRun], 'health_connect', enabled, [], Date.parse('2026-11-12T22:40:00.000Z'));
assert.equal(due.length, 1, 'Only one new source-matching workout');
assert.equal(due[0].externalId, 'new');
assert.equal(select.eligibleAutoActivities([recentRun], 'fake', enabled, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 0);
assert.equal(select.eligibleAutoActivities([appleRun], 'health_connect', enabled, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 0);
assert.equal(select.eligibleAutoActivities([recentRun], 'health_connect', enabled, [], Date.parse('2026-11-12T22:04:00.000Z')).length, 0, 'No future/unfinished workout');
assert.equal(select.eligibleAutoActivities([{ ...recentRun, distanceMi:0 }], 'health_connect', enabled, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 0);
const receipt = { activityKey:'health_connect:new', outcome:'created', source:'health_connect', kind:'run', completedAt:now };
assert.equal(select.eligibleAutoActivities([recentRun], 'health_connect', enabled, [receipt], Date.parse('2026-11-12T22:40:00.000Z')).length, 0, 'Existing manual receipt prevents double import');
const marked = await state.markActivitySynced(enabled, 'health_connect:new');
assert.equal(select.eligibleAutoActivities([recentRun], 'health_connect', marked, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 0, 'Persistent marker prevents repeat');
assert.equal((await state.loadAutoSyncState()).syncedMarks.length, 1);
const series = Array.from({length:10}, (_, i) => ({ ...recentRun, externalId:'run'+i }));
assert.equal(select.eligibleAutoActivities(series, 'health_connect', enabled, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 5, 'Strict batch cap');
const disabled = await state.setAutoSyncEnabled(false);
assert.equal(disabled.enabled,false);
assert.equal(select.eligibleAutoActivities([recentRun], 'health_connect', disabled, [], Date.parse('2026-11-12T22:40:00.000Z')).length, 0);
await state.setAutoSyncEnabled(true,new Date(now));
await state.clearAutoSyncState();
assert.equal((await state.loadAutoSyncState()).enabled, false, 'Sign-out/withdrawal clears auto opt-in');
// Corruption must FAIL CLOSED rather than silently enabling automatic upload.
const actualKey = [...store.keys()].find((k)=>k.includes('foreground_auto'));
if (actualKey) {
  store.set(actualKey, '{invalid json');
  await assert.rejects(state.loadAutoSyncState(), /paused/);
}
const screen = readFileSync(resolve(root, 'src/ingestion/manual-import-panel.tsx'), 'utf8');
const activities = readFileSync(resolve(root, 'app/activities.tsx'), 'utf8');
const session = readFileSync(resolve(root, 'src/auth/session.tsx'), 'utf8');
assert(screen.includes('setAutoSyncEnabled') && screen.includes('eligibleAutoActivities'), 'Auto opt-in and selection UI present');
assert(screen.includes("onForegroundResume?.()"), 'Foreground resume triggers a health refresh');
assert(screen.includes('submitHealthActivity'), 'Existing single authorized endpoint retained');
assert(screen.includes('cross-app distance matching needs manual review'), 'Ambiguous cross-source Android data blocked');
assert(screen.includes("next !== 'active'"), 'Uploads cancelled when app becomes inactive');
assert(activities.includes('onForegroundResume={() => setReadCount'), 'Activity screen refresh wired');
assert.equal(session.split('await clearAutoSyncState();').length - 1, 3, 'All three consent/account resets clear auto setting');
assert(!screen.includes('BackgroundFetch') && !screen.includes('setInterval('), 'No background/timer support');
console.log('PASS: Step 7A opt-in default OFF, new-only policy, provider gating, payload checks, manual receipt dedupe, batch cap, persistent marks, reset and foreground UI wiring.');
