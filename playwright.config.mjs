// Browser tests for the admin and user flows: `npm run e2e`.
// They drive the built web app, served by the real API, against a throwaway
// database (fitpro_e2e) that is wiped at the start of every run. A second server
// (fitpro_e2e_subs) runs with subscriptions on, for the subscribe flow.
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, SUBS_BASE_URL } from './e2e/fixtures.mjs';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: './e2e/.results/artifacts',
  // The flows share one database and build on each other (the admin makes the
  // code a runner signs up with), so they run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a retried sign-up would find its account already there.
  retries: 0,
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
  webServer: [
    {
      command: 'npm run build && node e2e/start-server.mjs',
      url: `${BASE_URL}/api/auth/options`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    // The same build, served by a second API that runs with SUBSCRIPTIONS on and a stand-in
    // for Stripe, on its own database (fitpro_e2e_subs). Only 05-subscribe.spec.mjs uses it.
    // It reads web/dist when a page is asked for, which is after the build above has finished.
    {
      command: 'node e2e/start-server.mjs subscriptions',
      url: `${SUBS_BASE_URL}/api/auth/options`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
