// The owner's flow: sign in, hand out invite codes, take one back.
import { expect, test } from '@playwright/test';
import { ADMIN } from './fixtures.mjs';
import { CODE_RE, acceptConsent, expectSignedIn, signIn, watchForTrouble } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

let page;
let trouble;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  trouble = watchForTrouble(page);
});

test.afterAll(async () => {
  await page.close();
});

test('a wrong password is refused', async () => {
  await signIn(page, { email: ADMIN.email, password: 'not-the-password' });
  await expect(page.getByText('Invalid email or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('the admin signs in without needing an invite code', async () => {
  await signIn(page, ADMIN);
  await acceptConsent(page);
  await expectSignedIn(page);
  await expect(page.getByRole('heading', { name: 'Invite only' })).toHaveCount(0);
});

test('the admin generates invite codes in Settings', async () => {
  await page.goto('/settings');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Invite codes' }) });
  await expect(card).toBeVisible();
  await card.getByLabel('How many codes').fill('2');
  await card.getByPlaceholder('Batch label (optional)').fill('first testers');
  await card.getByRole('button', { name: 'Generate' }).click();

  const codes = card.getByRole('listitem').filter({ hasText: CODE_RE });
  await expect(codes).toHaveCount(2);
  await expect(codes.first()).toContainText('first testers');
});

test('the admin revokes an unused code', async () => {
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Invite codes' }) });
  const first = card.getByRole('listitem').filter({ hasText: CODE_RE }).first();
  const code = (await first.textContent()).match(CODE_RE)[0];
  await card.getByRole('button', { name: `Revoke ${code}` }).click();

  await expect(card.getByRole('button', { name: `Copy ${code}` })).toHaveCount(0);
  await card.getByText(/Redeemed and revoked \(1\)/).click();
  await expect(card.getByRole('listitem').filter({ hasText: code })).toContainText('revoked');
});

test('a revoked code cannot be used to sign up', async ({ browser }) => {
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Invite codes' }) });
  const revoked = (await card.locator('details').getByRole('listitem').first().textContent()).match(CODE_RE)[0];

  const visitor = await browser.newPage();
  await visitor.goto('/register');
  await visitor.getByLabel('Invite code').fill(revoked);
  await visitor.getByLabel('Email').fill('late@e2e.test');
  await visitor.getByLabel('Password', { exact: true }).fill('e2e-late-pass-1');
  await visitor.getByLabel('Confirm Password').fill('e2e-late-pass-1');
  await visitor.getByRole('button', { name: 'Create account' }).click();
  await expect(visitor.getByText('That code has already been used.')).toBeVisible();
  await visitor.close();
});

test('the admin screens raised no errors', async () => {
  expect(trouble).toEqual([]);
});
