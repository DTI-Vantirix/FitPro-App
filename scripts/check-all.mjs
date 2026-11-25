// Runs every automated check in order and prints one summary:
//   npm run check
// 1. API tests (server, against the fitpro_test database)
// 2. Web lint
// 3. Browser flows (Playwright: builds the web app, then drives it against fitpro_e2e)
// The result of the last run is also written to .checks/last-run.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  { name: 'API tests', cmd: 'npm test', count: (out) => tally(out, /^ℹ pass (\d+)/m, /^ℹ fail (\d+)/m) },
  { name: 'Web lint', cmd: 'npm run lint', count: () => null },
  { name: 'Browser flows', cmd: 'npx playwright test', count: (out) => tally(out, /(\d+) passed/, /(\d+) failed/) },
];

function tally(out, passRe, failRe) {
  const pass = Number(passRe.exec(out)?.[1] ?? NaN);
  const fail = Number(failRe.exec(out)?.[1] ?? 0);
  return Number.isNaN(pass) ? null : { pass, fail };
}

function run(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, env: process.env });
    let out = '';
    const keep = (buf) => {
      out += buf.toString();
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (err) => resolve({ code: 1, out: `${out}\n${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

export async function checkAll({ log = console.log } = {}) {
  const started = new Date();
  const results = [];
  for (const step of STEPS) {
    const t0 = Date.now();
    log(`▶ ${step.name} …`);
    const { code, out } = await run(step.cmd);
    const result = {
      name: step.name,
      ok: code === 0,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      counts: step.count(out),
    };
    results.push(result);
    const counts = result.counts ? ` (${result.counts.pass} passed, ${result.counts.fail} failed)` : '';
    log(`${result.ok ? '✔' : '✖'} ${step.name}${counts} in ${result.seconds}s`);
    if (!result.ok) log(out.split('\n').slice(-40).join('\n'));
  }
  const summary = { started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: results.every((r) => r.ok), results };
  fs.mkdirSync(path.join(root, '.checks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.checks', 'last-run.json'), `${JSON.stringify(summary, null, 2)}\n`);
  log(summary.ok ? '\nAll checks passed.' : '\nSome checks FAILED.');
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = await checkAll();
  process.exit(summary.ok ? 0 : 1);
}
