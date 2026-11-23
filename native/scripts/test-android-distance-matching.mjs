import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/health/android-normalize.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: true,
});
assert(!compiled.diagnostics?.length, 'Android normalizer TypeScript transpilation failed');
const sandbox = { exports: {} };
vm.runInNewContext(compiled.outputText, sandbox);
const { resolveAndroidDistance, normalizeAndroidRun, describeDistanceCandidates } = sandbox.exports;

const base = Date.parse('2026-11-12T16:00:00.000Z');
const iso = (n) => new Date(base + n * 1000).toISOString();
const session = {
  startTime: iso(0), endTime: iso(600), exerciseType: 56,
  title: 'FitPro testing', metadata: { id: 'hc-run-001', dataOrigin: 'com.samsung.health' },
};
const record = (from, to, meters, dataOrigin = 'com.toolbox.health') => ({
  startTime: iso(from), endTime: iso(to), distance: { inMeters: meters },
  metadata: { dataOrigin },
});
const goodSame = record(0, 600, 1609.344, 'com.samsung.health');
const goodCross = record(0, 600, 1609.344);
const run = (records, options = {}) => normalizeAndroidRun(session, records, [], options);

// Existing first-party same-source workout must still pass unchanged.
assert.equal(resolveAndroidDistance(session, [goodSame]).kind, 'same_source');
// Step 7A fix: Toolbox's 8.6-second start/end drift is safe ONLY when the
// session and distance have the same source, the same duration, and no overlaps.
const shifted = record(8.6, 608.6, 1609.344, 'com.samsung.health');
assert.equal(resolveAndroidDistance(session, [shifted]).kind, 'none'); // opt-in matching gate
assert.equal(resolveAndroidDistance(session, [shifted], { allowShiftedSameSource: true }).kind, 'same_source');
assert.equal(normalizeAndroidRun(session, [shifted], [], { allowShiftedSameSource: true }).run.distanceMi, 1);
assert.equal(resolveAndroidDistance(session, [shifted, record(8.8, 608.8, 1500, 'com.samsung.health')], { allowShiftedSameSource: true }).kind, 'none');
assert.equal(resolveAndroidDistance(session, [record(-8.6, 605, 1609.344, 'com.samsung.health')], { allowShiftedSameSource: true }).kind, 'none');
assert.equal(resolveAndroidDistance(session, [record(8.6, 608.6, 1609.344, 'com.toolbox.health')], { allowShiftedSameSource: true, allowCrossSource: true }).kind, 'none');
const shortSession = { ...session, endTime: iso(30) };
assert.equal(resolveAndroidDistance(shortSession, [record(8.6, 38.6, 1609.344, 'com.samsung.health')], { allowShiftedSameSource: true }).kind, 'none');
assert(Math.abs(run([goodSame]).run.distanceMi - 1) < 1e-8);
// Same-source slight timestamp difference is normal when data is inserted by
// separate Toolbox forms. Only one near-exact candidate can be accepted.
assert.equal(resolveAndroidDistance(session, [record(-1, 601, 1609.344, 'com.samsung.health')]).kind, 'same_source');
assert.equal(resolveAndroidDistance(session, [record(-16, 616, 1609.344, 'com.samsung.health')], { allowShiftedSameSource: true }).kind, 'none');
assert.equal(resolveAndroidDistance(session, [record(-1, 601, 1609.344, 'com.samsung.health'), record(-1, 601, 1500, 'com.samsung.health')]).kind, 'none');
const diag = describeDistanceCandidates(session, [record(8, 605, 1609.344, 'com.toolbox.health')]);
assert(diag.includes('session source=com.samsung.health') && diag.includes('source=com.toolbox.health') && diag.includes('start difference=8.0s'));
assert(!diag.includes('2026-11-12'));
assert.equal(run([goodSame]).run.externalId, 'hc-run-001');

// Non-overlapping same-origin distance fragments may be summed.
assert(Math.abs(run([record(0, 300, 700, 'com.samsung.health'),
  record(300, 600, 909.344, 'com.samsung.health')]).run.distanceMi - 1) < 1e-8);

// Exact cross-origin Toolbox distance is accepted only with explicit collision check.
assert.equal(run([goodCross]).run, null);
assert.equal(resolveAndroidDistance(session, [goodCross], { allowCrossSource: true }).kind, 'cross_source_exact');
assert(Math.abs(run([goodCross], { allowCrossSource: true }).run.distanceMi - 1) < 1e-8);
assert.equal(run([goodCross], { allowCrossSource: false }).run, null);
assert(Math.abs(run([record(1, 599, 1609.344)], { allowCrossSource: true }).run.distanceMi - 1) < 1e-8);

// Do not infer fractional distance from unrelated/partial time windows.
assert.equal(run([record(60, 580, 1200)], { allowCrossSource: true }).run, null);
assert.equal(run([record(-6, 600, 1609.344)], { allowCrossSource: true }).run, null);
assert.equal(run([record(-400, -200, 1609.344)], { allowCrossSource: true }).run, null);

// Never choose among multiple exact cross-origin candidates or sum duplicates.
assert.equal(run([goodCross, record(0, 600, 1800, 'com.strava')], { allowCrossSource: true }).run, null);
assert.equal(run([goodSame, record(0, 600, 1609.344, 'com.strava')], { allowCrossSource: true }).run.distanceMi, 1);
assert.equal(run([goodSame, goodSame]).run, null);
assert.equal(run([record(0, 600, 0)], { allowCrossSource: true }).run, null);
assert.equal(run([record(0, 600, -3)], { allowCrossSource: true }).run, null);
assert.equal(run([], { allowCrossSource: true }).run, null);
assert(run([], { allowCrossSource: true }).reasons.some((r) => r.includes('zero distance records')));

// Missing stable IDs are never fabricated, and optional HR stays writer-specific.
assert.equal(normalizeAndroidRun({ ...session, metadata: { dataOrigin: 'com.samsung.health' } }, [goodCross], [], { allowCrossSource: true }).run, null);
const otherHr = [{ startTime: iso(0), endTime: iso(600), metadata: { dataOrigin: 'com.toolbox.health' }, samples: [{ time: iso(120), beatsPerMinute: 145 }] }];
assert.equal(normalizeAndroidRun(session, [goodCross], otherHr, { allowCrossSource: true }).run.avgHr, undefined);

// Source adapter must query distance without a source filter; still only read native data.
const adapter = readFileSync(new URL('../src/health/android-adapter.ts', import.meta.url), 'utf8');
assert(adapter.includes("hc.readRecords('Distance', { ...distanceOptions"));
assert(adapter.includes("hc.readRecords('HeartRate', heartOptions)"));
assert(adapter.includes('allowCrossSource: !sessionOverlapsAnother'));
assert(adapter.includes('allowShiftedSameSource: !sessionOverlapsAnother'));
assert(adapter.includes('Date.parse(session.startTime) - 60_000'));
assert(!adapter.includes("hc.readRecords('Distance', { ...options"));
assert(!/\b(insertRecords|updateRecords|deleteRecords|ingestActivity|fetch\s*\()\b/.test(adapter));
// Minute precision is a DEV-ONLY Toolbox workaround. Start AND end must
// each share the workout's minute, regardless of their seconds.
const minuteSame = record(39, 641, 1609.344, 'com.samsung.health');
assert.equal(resolveAndroidDistance(session, [minuteSame]).kind, 'none');
assert.equal(resolveAndroidDistance(session, [minuteSame], { allowSameMinuteSource: true }).kind, 'same_source_minute');
assert.equal(normalizeAndroidRun(session, [minuteSame], [], { allowSameMinuteSource: true }).run.distanceMi, 1);
assert.equal(resolveAndroidDistance(session, [record(58, 659, 1609.344, 'com.samsung.health')], { allowSameMinuteSource: true }).kind, 'same_source_minute');
assert.equal(resolveAndroidDistance(session, [record(58, 660, 1609.344, 'com.samsung.health')], { allowSameMinuteSource: true }).kind, 'none'); // end minute changed
assert.equal(resolveAndroidDistance(session, [record(-45, 555, 1609.344, 'com.samsung.health')], { allowSameMinuteSource: true }).kind, 'none'); // start minute changed
assert.equal(resolveAndroidDistance(session, [record(39, 641, 1609.344, 'com.toolbox.health')], { allowSameMinuteSource: true, allowCrossSource: true }).kind, 'none'); // wrong source
assert.equal(resolveAndroidDistance(session, [minuteSame, record(35, 635, 1500, 'com.samsung.health')], { allowSameMinuteSource: true }).kind, 'none'); // ambiguous
assert(adapter.includes('allowSameMinuteSource: false'), 'Production foreground adapter must disable minute fallback');
assert(adapter.includes('Date.parse(session.startTime) - 60_000'));
assert(adapter.includes('Date.parse(session.endTime) + 60_000'));
assert(adapter.includes('TEST-ONLY minute-based distance match'));
console.log('PASS: Test-only same-source minute matching, both timestamp minutes, wrong-writer/ambiguous rejection, 60s read window and dev-only gate.');
console.log('PASS: Android same-source distance, exact cross-source Toolbox fallback, ambiguity/overlap rejection, stable IDs, HR origin and read-only boundaries.');
