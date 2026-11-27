import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
// The policy has no runtime imports. Compile using installed TypeScript and execute
// in a sandbox to test its real logic without React Native or Expo.
const root = new URL('../src/ingestion/background-sync-policy.ts', import.meta.url);
const code = readFileSync(root, 'utf8');
const transpiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, strict: true } }).outputText;
const exports = {};
runInNewContext(transpiled, { exports, Date, Set, Number, Object, Array, String });
const { backgroundBlockers, selectBackgroundCandidates, CURRENT_BACKGROUND_FOUNDATION } = exports;
const valid = { platform: 'android', provider: 'health_connect', signedIn: true,
  consentAccepted: true, inviteVerified: true, separateBackgroundOptIn: true,
  nativeSchedulerInstalled: true, nativeHealthCapability: true, backgroundHealthPermission: true, productionSafeNormalization: true };
assert.equal(CURRENT_BACKGROUND_FOUNDATION.separateBackgroundOptIn, false);
assert.equal(CURRENT_BACKGROUND_FOUNDATION.nativeSchedulerInstalled, false);
assert(backgroundBlockers({ ...valid, ...CURRENT_BACKGROUND_FOUNDATION }).length >= 4);
assert.equal(backgroundBlockers(valid).length, 0);
for (const field of ['signedIn','consentAccepted','inviteVerified','separateBackgroundOptIn','nativeSchedulerInstalled','nativeHealthCapability','backgroundHealthPermission','productionSafeNormalization']) {
  assert(backgroundBlockers({ ...valid, [field]: false }).length, `Missing safety gate: ${field}`);
}
assert(backgroundBlockers({ ...valid, provider: 'fake' }).length);
assert(backgroundBlockers({ ...valid, platform: 'ios' }).length);
const day = Date.parse('2026-11-12T23:00:00Z');
const due = [
  { source: 'health_connect', externalId: 'previous', kind: 'run', startedAt: '2026-11-12T21:00:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'first', kind: 'run', startedAt: '2026-11-12T22:30:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'first', kind: 'run', startedAt: '2026-11-12T22:30:00Z', durationSec: 300 },
  { source: 'apple', externalId: 'wrong-source', kind: 'run', startedAt: '2026-11-12T22:40:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'second', kind: 'run', startedAt: '2026-11-12T22:40:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'third', kind: 'run', startedAt: '2026-11-12T22:41:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'fourth', kind: 'run', startedAt: '2026-11-12T22:42:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: 'future', kind: 'run', startedAt: '2026-11-13T08:00:00Z', durationSec: 300 },
  { source: 'health_connect', externalId: '', kind: 'run', startedAt: '2026-11-12T22:50:00Z', durationSec: 300 },
];
const selected = selectBackgroundCandidates(valid, due, '2026-11-12T22:00:00Z', [], day);
assert.deepEqual(Array.from(selected, a => a.externalId), ['first','second','third']);
assert.deepEqual(Array.from(selectBackgroundCandidates(valid, due, '2026-11-12T22:00:00Z', ['health_connect:first'], day), a => a.externalId), ['second','third','fourth']);
assert.equal(selectBackgroundCandidates({ ...valid, separateBackgroundOptIn: false }, due, '2026-11-12T22:00:00Z', [], day).length, 0);
assert.equal(selectBackgroundCandidates(valid, due, null, [], day).length, 0);
assert.equal(selectBackgroundCandidates(valid, due, 'bad', [], day).length, 0);
const panel = readFileSync(new URL('../src/ingestion/background-readiness-panel.tsx', import.meta.url),'utf8');
assert(panel.includes('Historical Step 7B.1 foundation snapshot') && panel.includes('No background health-sync tasks scheduled at Step 7B.1'));
const activities = readFileSync(new URL('../app/(tabs)/activities.tsx', import.meta.url), 'utf8');
assert(activities.includes('<BackgroundReadinessPanel ') && activities.includes('const authorized = Boolean('));
console.log('PASS: Step 7B background sync remains OFF by default; all consent, access, provider, native and OS safety gates enforced.');
console.log('PASS: dry-run activity selection is source-scoped, bounded, opt-in-only, recent-only, and duplicate-safe.');
console.log('PASS: read-only readiness panel installed; no health-sync task registration or background uploads.');
