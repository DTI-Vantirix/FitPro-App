// Shared loader for the scripts/test-run-*.mjs unit tests. Transpiles a TypeScript
// module from native/ and evaluates it in this realm, following relative imports.
// Anything that is not a relative import must be supplied in `mocks`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export const root = resolve(import.meta.dirname, '..');

export function load(file, mocks = {}, globals = {}) {
  const cache = new Map();
  const names = Object.keys(globals);
  const loadOne = (abs) => {
    if (cache.has(abs)) return cache.get(abs).exports;
    const rel = relative(root, abs).replace(/\\/g, '/');
    const out = ts.transpileModule(readFileSync(abs, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: rel, reportDiagnostics: true,
    });
    const errors = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${rel}: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))}`);
    const module = { exports: {} };
    cache.set(abs, module);
    const req = (spec) => {
      if (spec in mocks) return mocks[spec];
      if (!spec.startsWith('.')) throw new Error(`Unexpected import "${spec}" in ${rel}`);
      const target = resolve(dirname(abs), spec);
      const relTarget = relative(root, target).replace(/\\/g, '/');
      if (relTarget in mocks) return mocks[relTarget];
      for (const ext of ['.ts', '.tsx']) if (existsSync(target + ext)) return loadOne(target + ext);
      throw new Error(`Cannot resolve "${spec}" from ${rel}`);
    };
    new Function('module', 'exports', 'require', ...names, out.outputText)(module, module.exports, req, ...names.map((n) => globals[n]));
    return module.exports;
  };
  return loadOne(resolve(root, file));
}

let passed = 0;
export async function test(name, fn) {
  try { await fn(); passed += 1; }
  catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
export function done(label) { console.log(`PASS: ${label} (${passed} cases)`); }

/** A point `north` and `east` metres from a fixed origin (flat-earth, fine at this scale). */
export function at(north, east) {
  return { lat: 42.36 + north / 111320, lng: -71.06 + east / (111320 * Math.cos((42.36 * Math.PI) / 180)) };
}

export const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} not within ${tol} of ${expected}`);
