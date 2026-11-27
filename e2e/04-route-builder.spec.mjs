// Drawing a route on a phone: a wrong tap can be taken back without scrolling
// away from the map.
import { expect, test } from '@playwright/test';
import { RUNNER } from './fixtures.mjs';
import { expectSignedIn, signIn } from './helpers.mjs';

test('undo sits on the map and takes back the last point', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto('/routes/new');

  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible();
  const undo = page.getByRole('button', { name: 'Undo last point' });
  await expect(undo).toBeDisabled();

  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await expect(page.getByText('1 point', { exact: true })).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7);
  await expect(page.getByText('2 points', { exact: true })).toBeVisible();

  // Reachable where you are tapping: inside the map, on screen, no scrolling.
  await expect(undo).toBeInViewport({ ratio: 1 });
  const at = await undo.boundingBox();
  expect(at.y).toBeGreaterThanOrEqual(box.y);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height);

  await undo.click();
  await expect(page.getByText('1 point', { exact: true })).toBeVisible();
  await undo.click();
  await expect(page.getByText('0 points', { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
  await context.close();
});
