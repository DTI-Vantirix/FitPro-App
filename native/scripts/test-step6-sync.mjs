import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(import.meta.dirname, '..');
function cjs(file, deps = {}, sandboxExtra = {}) {
  const output = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file, reportDiagnostics: true,
  });
  const errors = (output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${file}: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))}`);
  const module = { exports: {} };
  const sb = { module, exports: module.exports, require: (path) => {
    if (!(path in deps)) throw Error(`Unexpected import ${path} in ${file}`);
    return deps[path];
  }, AbortController, setTimeout, clearTimeout, console, ...sandboxExtra };
  vm.runInNewContext(output.outputText, sb, { filename: file });
  return module.exports;
}

const mock = { fetch: null };
const sync = cjs('src/ingestion/activity-sync.ts', { '../config': { INGEST_URL: 'http://192.168.1.50:4000/api/functions/ingestActivity' } }, {
  fetch: (...args) => mock.fetch(...args),
});
const run = { kind: 'run', source: 'health_connect', externalId: 'run-uuid-123', routeName: 'Test run',
  startedAt: '2026-11-12T20:00:00.000Z', distanceMi: 0.64, durationSec: 1800,
  points: [{ lat: 40.0, lng: -73.0 }, { lat: 900, lng: 200 }], avgHr: 150 };
const payload = sync.buildActivityPayload(run);
assert.equal(payload.kind, 'run');
assert.equal(payload.source, 'health_connect');
assert.equal(payload.external_id, 'run-uuid-123');
assert.equal(payload.distance_mi, 0.64);
assert.equal(payload.duration_sec, 1800);
assert.equal(payload.points.length, 1);
assert.equal(payload.avg_hr, 150);
assert.ok(!Object.keys(payload).includes('total_volume'));
assert.ok(!Object.keys(payload).includes('avg_pace_sec'));
assert.throws(() => sync.buildActivityPayload({ ...run, source: 'manual' }), /cannot be uploaded/);
assert.throws(() => sync.buildActivityPayload({ ...run, distanceMi: 0 }), /Run distance/);
assert.throws(() => sync.buildActivityPayload({ ...run, externalId: '' }), /Stable external/);
assert.throws(() => sync.buildActivityPayload({ ...run, startedAt: 'not-a-date' }), /Run start/);
assert.deepEqual(sync.buildActivityPayload({ ...run, source: 'apple' }).source, 'apple');

const strength = {
  kind: 'workout', source: 'apple', externalId: 'strength-456', performedAt: '2026-11-10T16:00:00Z',
  name: 'Test strength', exercises: [{ name: 'Squat', muscle: 'legs', sets: [{ reps: 5, weight: 0 }] }],
};
assert.equal(sync.buildActivityPayload(strength).exercises[0].sets[0].weight, 0);
assert.throws(() => sync.buildActivityPayload({ ...strength, exercises: [] }), /no valid exercise/);

let captured;
mock.fetch = async (url, opts) => {
  captured = { url, opts };
  return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, kind: 'run', action: 'created', run_id: 'run-server-id' }) };
};
const result = await sync.submitHealthActivity(run, 'user-session-token');
assert.equal(result.action, 'created');
assert.equal(result.recordId, 'run-server-id');
assert.equal(captured.url, 'http://192.168.1.50:4000/api/functions/ingestActivity');
assert.equal(captured.opts.headers.Authorization, 'Bearer user-session-token');
assert.equal(JSON.parse(captured.opts.body).external_id, 'run-uuid-123');
mock.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, kind: 'run', action: 'updated', run_id: 'run-server-id' }) });
assert.equal((await sync.submitHealthActivity(run, 'user-session-token')).action, 'updated');
// The server skips an imported copy of a run FitPro recorded itself: success, not an error.
mock.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, kind: 'run', action: 'skipped', reason: 'overlaps_fitpro_run', run_id: 'fitpro-run-id', source: 'health_connect' }) });
assert.deepEqual({ ...(await sync.submitHealthActivity(run, 'user-session-token')) }, { action: 'skipped', recordId: 'fitpro-run-id' });
mock.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'distance_mi must be between 0 and 500' }) });
await assert.rejects(sync.submitHealthActivity(run, 'user-session-token'), (err) => err.httpStatus === 400 && err.message.includes('distance_mi'));
await assert.rejects(sync.submitHealthActivity({ ...run, source: 'manual' }, 'user-session-token'), /cannot be uploaded/);

const storage = new Map();
const history = cjs('src/ingestion/import-history.ts', { 'expo-secure-store': {
  getItemAsync: async (key) => storage.get(key) ?? null,
  setItemAsync: async (key, val) => { storage.set(key, val); },
  deleteItemAsync: async (key) => { storage.delete(key); },
} });
const receipt = { activityKey: 'health_connect:run-uuid-123', source: 'health_connect', kind: 'run',
  outcome: 'created', completedAt: '2026-11-12T21:00:00.000Z' };
assert.equal((await history.appendImportReceipt(receipt)).length, 1);
assert.equal((await history.loadImportHistory())[0].activityKey, receipt.activityKey);
await history.clearImportHistory();
assert.equal((await history.loadImportHistory()).length, 0);

const panel = readFileSync(resolve(root, 'src/ingestion/manual-import-panel.tsx'), 'utf8');
const activities = readFileSync(resolve(root, 'app/(tabs)/activities.tsx'), 'utf8');
const session = readFileSync(resolve(root, 'src/auth/session.tsx'), 'utf8');
assert(panel.includes('submitHealthActivity') && panel.includes('Import selected'));
assert(panel.includes('adapterId === \'apple\' || adapterId === \'health_connect\''));
assert(activities.includes('<ManualImportPanel activities={items}'));
assert.equal(session.split('await clearImportHistory();').length - 1, 3);
console.log('PASS: Step 6 payload contract, real sources only, stable idempotency, 400 error handling, manual UI, and SecureStore receipt clearing.');
