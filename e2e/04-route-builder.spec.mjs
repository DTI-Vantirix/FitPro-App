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

test('an off-road leg can be planned and is saved on the route', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto('/routes/new');

  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  const roads = page.getByRole('button', { name: 'Follow roads' });
  const offroad = page.getByRole('button', { name: 'Off-road' });
  await expect(roads).toHaveAttribute('aria-pressed', 'true');
  await expect(offroad).toBeInViewport({ ratio: 1 });

  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await offroad.click();
  await expect(offroad).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Off-road: points join in a straight line')).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await roads.click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.75);
  await expect(page.getByText('3 points', { exact: true })).toBeVisible();

  await page.getByPlaceholder('Ironworks loop').fill('Across the field');
  const saved = page.waitForRequest((r) => r.url().endsWith('/api/entities/Route') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Save route' }).click();
  const body = (await saved).postDataJSON();
  expect(body.points.map((p) => p.offroad === true)).toEqual([false, true, false]);
  await expect(page).toHaveURL(/\/routes$/);
  await context.close();
});
