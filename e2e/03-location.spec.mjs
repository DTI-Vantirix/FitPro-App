// The maps find the runner: with location allowed they open where you are and
// mark the spot; without it they say why instead of quietly showing New York.
import { expect, test } from '@playwright/test';
import { RUNNER } from './fixtures.mjs';
import { expectSignedIn, signIn } from './helpers.mjs';

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

async function openAs(browser, contextOptions, path) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto(path);
  return { context, page };
}

test('the route builder opens on your location and marks it', async ({ browser }) => {
  const { context, page } = await openAs(browser, { geolocation: TORONTO, permissions: ['geolocation'] }, '/routes/new');
  await expect(page.locator('.you-are-here')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add my location' })).toBeEnabled();
  await context.close();
});

test('the route builder says so when location is blocked', async ({ browser }) => {
  const { context, page } = await openAs(browser, { permissions: [] }, '/routes/new');
  await expect(page.getByText('Location access is blocked. Allow location for this site, then reload.')).toBeVisible();
  await expect(page.locator('.you-are-here')).toHaveCount(0);
  await context.close();
});

test('the run screen marks where you are before you start', async ({ browser }) => {
  const { context, page } = await openAs(browser, { geolocation: TORONTO, permissions: ['geolocation'] }, '/run');
  await expect(page.locator('.you-are-here')).toHaveCount(1);
  await context.close();
});
