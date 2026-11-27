// Serves the website to phones on the same Wi-Fi, over https so the browser will
// share location. Run the API as well (`npm run dev:api`).
import { spawn } from 'node:child_process';

const child = spawn('npm', ['run', 'dev', '-w', 'web'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, FITPRO_PHONE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
