// A tester's flow: sign up with the owner's code, get in, look around, sign out.
import { expect, test } from '@playwright/test';
import { RUNNER } from './fixtures.mjs';
import { acceptConsent, expectSignedIn, mintCode, signIn, submitSignUp, watchForTrouble } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

let page;
let trouble;
let inviteCode;

test.beforeAll(async ({ browser, request }) => {
  page = await browser.newPage();
  trouble = watchForTrouble(page);
  inviteCode = await mintCode(request, 'runner flow');
});

test.afterAll(async () => {
  await page.close();
});

test('the app is closed to people who are not signed in', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('sign-up without a real code is refused', async () => {
  const answer = await submitSignUp(page, { ...RUNNER, inviteCode: 'FP-NOPE-NOPE' });
  expect(answer.status).toBe(400);
  await expect(page.getByText('That code is not recognised.')).toBeVisible();
});

test('sign-up with a code, typed loosely, then the emailed code, opens the app', async () => {
  const answer = await submitSignUp(page, { ...RUNNER, inviteCode: `  ${inviteCode.toLowerCase()} ` });
  expect(answer.status).toBe(200);
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();

  await page.locator('input[autocomplete="one-time-code"]').fill(answer.body.dev_code);
  await page.getByRole('button', { name: 'Verify' }).click();

  // Straight to the consent screen: the code was accepted at sign-up, so the
  // "Invite only" gate never shows.
  await acceptConsent(page);
  await expectSignedIn(page);
  await expect(page.getByRole('heading', { name: 'Invite only' })).toHaveCount(0);
});

test('the same code cannot be used by a second person', async ({ browser }) => {
  const visitor = await browser.newPage();
  const answer = await submitSignUp(visitor, { inviteCode, email: 'second@e2e.test', password: 'e2e-second-pass-1' });
  expect(answer.status).toBe(400);
  await expect(visitor.getByText('That code has already been used.')).toBeVisible();
  await visitor.close();
});

test('when someone else verifies with the code first, the form comes back for a new code', async ({ browser, request }) => {
  const contested = await mintCode(request, 'contested');
  const slow = await browser.newPage();
  const answer = await submitSignUp(slow, { inviteCode: contested, email: 'slow@e2e.test', password: 'e2e-slow-pass-1' });
  expect(answer.status).toBe(200);

  // A second person registers and verifies with the same code while the first
  // is still looking for their email.
  const quick = { email: 'quick@e2e.test', password: 'e2e-quick-pass-1', invite_code: contested };
  const reg = await request.post('/api/auth/register', { data: quick });
  const ver = await request.post('/api/auth/verify-otp', { data: { email: quick.email, otp_code: (await reg.json()).dev_code } });
  expect(ver.ok()).toBeTruthy();

  await slow.locator('input[autocomplete="one-time-code"]').fill(answer.body.dev_code);
  await slow.getByRole('button', { name: 'Verify' }).click();
  await expect(slow.getByText('That invite code was just used by someone else. Ask for a new one.')).toBeVisible();

  await slow.getByRole('button', { name: 'Use a different invite code' }).click();
  await expect(slow.getByLabel('Invite code')).toBeVisible();
  await expect(slow.getByLabel('Email')).toHaveValue('slow@e2e.test');
  await slow.close();
});

test('gym is hidden: no menu entry, and the old address goes home', async () => {
  await page.goto('/');
  await expectSignedIn(page);
  await expect(page.getByRole('link', { name: /gym|workout/i })).toHaveCount(0);
  await page.goto('/workouts');
  await expect(page).toHaveURL(/\/$/);
  await expectSignedIn(page);
});

for (const [path, name] of [
  ['/feed', 'Feed'],
  ['/friends', 'Friends'],
  ['/challenges', 'Challenges'],
  ['/routes', 'Routes'],
  ['/routes/new', 'Route builder'],
  ['/run', 'Live run'],
  ['/analytics', 'Analytics'],
  ['/zones', 'Pace zones'],
  ['/devices', 'Devices'],
  ['/settings', 'Settings'],
]) {
  test(`${name} opens for a new runner with nothing gym-related on it`, async () => {
    await page.goto(path);
    await expectSignedIn(page);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main, #root').first()).not.toContainText(/gym|workout/i);
  });
}

test('a runner does not see the invite-code controls', async () => {
  await page.goto('/settings');
  await expectSignedIn(page);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Invite codes' })).toHaveCount(0);
});

test('signing out closes the app, and signing back in reopens it', async () => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, RUNNER);
  await expectSignedIn(page);
  // Consent was already given, so it is not asked again.
  await expect(page.getByRole('heading', { name: 'Your training data, in your hands' })).toHaveCount(0);
});

test('the runner screens raised no errors', async () => {
  expect(trouble).toEqual([]);
});
