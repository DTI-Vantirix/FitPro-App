// Browser tests for the admin and user flows: `npm run e2e`.
// They drive the built web app, served by the real API, against a throwaway
// database (fitpro_e2e) that is wiped at the start of every run.
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/fixtures.mjs';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: './e2e/.results/artifacts',
  // The flows share one database and build on each other (the admin makes the
  // code a runner signs up with), so they run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e/.results/results.json' }],
    ['html', { outputFolder: 'e2e/.results/html', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node e2e/start-server.mjs',
    url: `${BASE_URL}/api/auth/options`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
