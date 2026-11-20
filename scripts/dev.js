// Runs the API and the web app together: `npm run dev`.
// Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', ['run', 'dev', '-w', 'server']],
  ['web', ['run', 'dev', '-w', 'web']],
].map(([name, args]) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = name === 'api' ? '\x1b[36m[api]\x1b[0m' : '\x1b[35m[web]\x1b[0m';
  const relay = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) if (line.trim()) out.write(`${tag} ${line}\n`);
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${tag} exited with code ${code}`);
    for (const p of procs) if (p !== child) p.kill();
    process.exit(code ?? 0);
  });
  return child;
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill(sig)));
