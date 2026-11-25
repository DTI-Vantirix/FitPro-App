// Runs every scripts/test-*.mjs (or only those whose name starts with the given prefix)
// and fails if any of them fails:  node scripts/run-all-tests.mjs [prefix]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const prefix = process.argv[2] ?? 'test-';
const files = readdirSync(import.meta.dirname).filter((name) => name.startsWith(prefix) && name.startsWith('test-') && name.endsWith('.mjs')).sort();
let failed = 0;
for (const name of files) {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, name)], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`ok    ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}\n${result.stdout}${result.stderr}`);
  }
}
console.log(`\n${files.length - failed} of ${files.length} test files passed.`);
process.exit(failed || files.length === 0 ? 1 : 0);
