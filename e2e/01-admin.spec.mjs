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

test('the admin sees who has access, and can give and take back a free pass', async ({ request }) => {
  // someone who signed up with a code, so there is a person to look at
  const code = (await page.locator('section', { has: page.getByRole('heading', { name: 'Invite codes' }) })
    .getByRole('listitem').filter({ hasText: CODE_RE }).first().textContent()).match(CODE_RE)[0];
  const tester = { email: 'tester@e2e.test', password: 'e2e-tester-pass-1' };
  const reg = await request.post('/api/auth/register', { data: { ...tester, invite_code: code } });
  const ver = await request.post('/api/auth/verify-otp', { data: { email: tester.email, otp_code: (await reg.json()).dev_code } });
  expect(ver.ok()).toBeTruthy();
  const { access_token: token } = await ver.json();
  const runs = () => request.post('/api/entities/Run/query', { headers: { Authorization: `Bearer ${token}` }, data: {} });
  expect((await runs()).status()).toBe(200);

  await page.reload();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Who has access' }) });
  await expect(card).toBeVisible();
  const row = card.getByRole('row').filter({ hasText: tester.email });
  await expect(row).toContainText('Invite code');
  await expect(card.getByRole('row').filter({ hasText: ADMIN.email })).toContainText('Admin');

  // take the invite pass away: asks first, then the person is closed out on the server
  await row.getByRole('button', { name: `Remove invite code access from ${tester.email}` }).click();
  await expect(row).toContainText('Invite code', { timeout: 1000 });
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(row).toContainText('No access');
  expect((await runs()).status()).toBe(403);

  // give it back by hand
  await card.getByLabel('Email to give free access').fill(tester.email);
  await card.getByLabel('Note (optional)').fill('e2e pass');
  await card.getByRole('button', { name: 'Grant free access' }).click();
  await expect(row).toContainText('Granted by you');
  expect((await runs()).status()).toBe(200);

  // an email with no account says what to do instead
  await card.getByLabel('Email to give free access').fill('nobody@e2e.test');
  await card.getByRole('button', { name: 'Grant free access' }).click();
  await expect(card.getByText('No account with that email yet. Send them an invite code instead.')).toBeVisible();
});

test('the admin screens raised no errors', async () => {
  expect(trouble).toEqual([]);
});
