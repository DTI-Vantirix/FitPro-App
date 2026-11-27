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

// The map publishes its zoom as data-zoom. Tiles are not used to read it because
// they load from the network.
const zoomOf = (page) => page.locator('.leaflet-container').getAttribute('data-zoom');

test('adding points leaves the map at the zoom you chose', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto('/routes/new');

  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible();
  await expect.poll(() => zoomOf(page)).toBe('15');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => zoomOf(page)).toBe('16');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => zoomOf(page)).toBe('17');

  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await expect(page.getByText('3 points', { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await zoomOf(page)).toBe('17');
  await context.close();
});

test('a route point can be dragged to a new spot', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto('/routes/new');

  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  const snapped = () => page.waitForRequest((r) => r.url().endsWith('/api/functions/snapRoute'));

  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.getByRole('button', { name: 'Off-road' }).click();
  let request = snapped();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const before = (await request).postDataJSON().points;
  expect(before).toHaveLength(2);

  const handles = page.locator('.leaflet-marker-draggable');
  await expect(handles).toHaveCount(2);
  const grip = await handles.nth(1).boundingBox();
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  request = snapped();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 30, { steps: 5 });
  await page.mouse.move(from.x + 40, from.y + 70, { steps: 5 });
  await page.mouse.up();
  const after = (await request).postDataJSON().points;

  // Same two points, the first untouched, the second moved south-east and still off-road.
  expect(after).toHaveLength(2);
  expect(after[0]).toEqual(before[0]);
  expect(after[1].lat).toBeLessThan(before[1].lat);
  expect(after[1].lng).toBeGreaterThan(before[1].lng);
  expect(after[1].offroad).toBe(true);
  await expect(page.getByText('2 points', { exact: true })).toBeVisible();
  await context.close();
});

test('a route point can be dragged with a finger', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signIn(page, RUNNER);
  await expectSignedIn(page);
  await page.goto('/routes/new');

  const map = page.locator('.leaflet-container');
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  const snapped = () => page.waitForRequest((r) => r.url().endsWith('/api/functions/snapRoute'));

  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(page.getByText('1 point', { exact: true })).toBeVisible();
  let request = snapped();
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const before = (await request).postDataJSON().points;

  const grip = await page.locator('.leaflet-marker-draggable').nth(1).boundingBox();
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type, px, py) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
  request = snapped();
  await touch('touchStart', x, y);
  for (let i = 1; i <= 8; i += 1) await touch('touchMove', x + i * 5, y + i * 8);
  await touch('touchEnd');
  const after = (await request).postDataJSON().points;

  expect(after).toHaveLength(2);
  expect(after[1].lat).toBeLessThan(before[1].lat);
  expect(after[1].lng).toBeGreaterThan(before[1].lng);
  await context.close();
});
