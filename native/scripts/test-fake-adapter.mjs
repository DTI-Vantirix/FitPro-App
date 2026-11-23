import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Compile only the fake provider in memory. Its only import is type-only,
// therefore tests do not require Expo, React Native or a device.
const source = readFileSync(resolve(import.meta.dirname, '../src/health/fake-adapter.ts'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.length ?? 0, 0, 'TypeScript syntax must be valid');
const exports = {};
runInNewContext(transpiled.outputText, { exports }, { filename: 'fake-adapter.js' });
const adapter = exports.fakeHealthAdapter;
assert.equal(adapter.id, 'fake');
assert.equal(typeof adapter.readActivities, 'function');

const activities = await adapter.readActivities();
const activitiesAgain = await adapter.readActivities();
assert.equal(activities.length, 4, 'Step 3 demo should contain four sample activities');
assert.deepEqual(Array.from(activities, (a) => a.externalId), Array.from(activitiesAgain, (a) => a.externalId), 'Fake activity IDs must be stable');
assert.equal(activities.filter((a) => a.kind === 'run').length, 2);
assert.equal(activities.filter((a) => a.kind === 'workout').length, 2);
const ids = new Set();
for (const a of activities) {
  assert.equal(a.source, 'manual', 'Samples must not pretend to come from real OS health services');
  assert.match(a.externalId, /^fitpro-fake-/);
  assert(!ids.has(a.source + ':' + a.externalId), 'Duplicate external IDs');
  ids.add(a.source + ':' + a.externalId);
  if (a.kind === 'run') {
    assert(a.distanceMi > 0 && a.distanceMi <= 500);
    assert(a.durationSec > 0 && a.durationSec <= 259200);
    assert(!Number.isNaN(Date.parse(a.startedAt)));
    assert(a.routeName.length <= 120);
    assert((a.splits ?? []).every((s) => s.mile > 0 && s.paceSec > 0));
  } else if (a.kind === 'workout') {
    assert(a.name.length <= 120);
    assert(!Number.isNaN(Date.parse(a.performedAt)));
    assert(a.exercises.length > 0);
    for (const e of a.exercises) {
      assert(e.sets.length > 0);
      assert(e.sets.every((s) => s.reps > 0 && s.reps <= 1000 && s.weight >= 0 && s.weight <= 2000));
    }
  } else {
    assert.fail('Unexpected activity kind');
  }
}
// A returned sample must not mutate subsequent reads.
activities[0].routeName = 'CHANGED BY TEST';
assert.equal((await adapter.readActivities())[0].routeName, 'Demo park loop');
// Reload-feedback regression: a fast, repeatable provider must still show
// proof that a read completed, instead of silently repainting identical cards.
const screen = readFileSync(resolve(import.meta.dirname, '../app/activities.tsx'), 'utf8');
const controls = readFileSync(resolve(import.meta.dirname, '../src/components/Ui.tsx'), 'utf8');
assert.match(screen, /setReadCount\(\(value\) => value \+ 1\)/, 'Reload button must trigger a new adapter read');
assert.match(screen, /lastSuccessfulRead/, 'Completed reads must have persistent on-screen status');
assert.match(screen, /Adapter read #/, 'Reload must show read counter on screen');
assert.match(screen, /Reload in progress/, 'Reload must show pending state');
assert.match(controls, /pressed && !\(busy \|\| disabled\)/, 'Buttons need pressed-state feedback');
console.log('PASS: reload action, persistent completion status, and button pressed-state feedback.');
console.log('PASS: 4 deterministic normalized fake activities (2 runs + 2 workouts), stable IDs, shape/limit checks, isolation across reads.');
