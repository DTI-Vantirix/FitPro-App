// A tester's flow: sign up with the owner's code, get in, look around, sign out.
import { expect, test } from '@playwright/test';
import { ADMIN, RUNNER } from './fixtures.mjs';
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

test('the sign-up form is the invite-only one while subscriptions are off', async ({ request }) => {
  const options = await (await request.get('/api/auth/options')).json();
  expect(options.subscriptions).toBe(false);

  await page.goto('/register');
  await expect(page.getByText('VantraRun is invite-only. Use the code you were sent.')).toBeVisible();
  await expect(page.getByLabel('Invite code')).toHaveAttribute('required', '');
  await expect(page.getByText(/Have an invite code\?/)).toHaveCount(0);

  // and the server refuses a sign-up with no code, whatever the form allows
  const res = await request.post('/api/auth/register', { data: { email: 'nocode@e2e.test', password: 'e2e-nocode-pass-1' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe('Enter your invite code.');
});

test('the form makes the code optional once the server reports subscriptions on', async ({ browser }) => {
  // The test server runs with the switch off, so only the form is checked here: its
  // answer from /api/auth/options is replaced. The server side is covered in server/test.
  const visitor = await browser.newPage();
  await visitor.route('**/api/auth/options', (route) =>
    route.fulfill({ json: { name: 'VantraRun', auth_config: { mfa_policy: 'off', providers: [] }, subscriptions: true } })
  );
  await visitor.goto('/register');
  await expect(visitor.getByText('Have an invite code? Enter it here. Otherwise leave this empty.')).toBeVisible();
  await expect(visitor.getByText('VantraRun is invite-only. Use the code you were sent.')).toHaveCount(0);
  await expect(visitor.getByLabel('Invite code')).not.toHaveAttribute('required', '');
  await visitor.close();
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
  await expect(page.getByRole('heading', { name: 'Who has access' })).toHaveCount(0);
});

test('the owner sees the runner listed with an invite code, and a runner cannot ask for the list', async ({ browser, request }) => {
  const owner = await browser.newPage();
  const ownerTrouble = watchForTrouble(owner);
  await signIn(owner, ADMIN);
  await expectSignedIn(owner);
  await owner.goto('/settings');
  const card = owner.locator('section', { has: owner.getByRole('heading', { name: 'Who has access' }) });
  await expect(card).toBeVisible();
  await expect(card.getByRole('row').filter({ hasText: RUNNER.email })).toContainText('Invite code');
  // The row of the admin's own account: found by its Person cell, because another row can
  // now name the admin too ("Free access removed by admin@... on ...").
  const adminRow = card.getByRole('row').filter({ has: owner.locator('td:first-child', { hasText: ADMIN.email }) });
  await expect(adminRow).toContainText('Admin');

  await card.getByLabel('Search by email').fill('runner@');
  await expect(card.getByRole('row').filter({ hasText: ADMIN.email })).toHaveCount(0);
  await expect(card.getByRole('row').filter({ hasText: RUNNER.email })).toHaveCount(1);
  expect(ownerTrouble).toEqual([]);
  await owner.close();

  const login = await request.post('/api/auth/login', { data: RUNNER });
  const { access_token: token } = await login.json();
  const res = await request.post('/api/functions/adminAccess', { headers: { Authorization: `Bearer ${token}` }, data: { action: 'list' } });
  expect(res.status()).toBe(403);
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
