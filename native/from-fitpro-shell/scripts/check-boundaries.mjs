import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const native = resolve(import.meta.dirname, '..');
const root = resolve(native, '..');
assert(!existsSync(join(root, 'src')), 'This deliverable must never ship the web src/ tree.');
assert(!existsSync(join(root, 'base44')), 'This deliverable must never ship backend files.');
const workout = readFileSync(join(native, 'src/ingestion/spike-workout.ts'), 'utf8');
for (const name of ['external_id', 'kind', 'source', 'exercises']) assert(workout.includes(name), `Missing ${name}`);
assert(!workout.includes('total_volume') && !workout.includes('set_count'), 'Server-computed fields are prohibited.');
for (const f of ['app/index.tsx','app/spike.tsx','src/auth/session.tsx','src/auth/auth-api.ts'])
  assert(existsSync(join(native,f)), `Missing ${f}`);
const dir = join(native, 'app');
for (const file of readdirSync(dir)) assert(file.endsWith('.tsx'), 'Unexpected runtime artifact in app/');
console.log('PASS: only native/ source, key screens, contract field checks; no backend/web tree bundled.');
