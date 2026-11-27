// Subscribing on the website, against a second server that runs with SUBSCRIPTIONS on
// and a stand-in for Stripe (e2e/start-server.mjs, "subscriptions" mode). No request
// leaves this machine: "checkout" and "the portal" are pages of that test server.
import { expect, test } from '@playwright/test';
import { ADMIN, SUBS_BASE_URL } from './fixtures.mjs';
import { acceptConsent, expectSignedIn, mintCode, signIn, submitSignUp, watchForTrouble } from './helpers.mjs';

test.use({ baseURL: SUBS_BASE_URL });
test.describe.configure({ mode: 'serial' });

const SUBSCRIBER = { email: 'subscriber@e2e.test', password: 'e2e-subscriber-pass-1' };
const INVITED = { email: 'invited-later@e2e.test', password: 'e2e-invited-pass-1' };

let page;
let trouble;

// Sign up with no invite code and confirm the emailed code.
async function signUpWithoutCode(target, account) {
  const answer = await submitSignUp(target, { ...account, inviteCode: '' });
  expect(answer.status).toBe(200);
  await expect(target.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await target.locator('input[autocomplete="one-time-code"]').fill(answer.body.dev_code);
  await target.getByRole('button', { name: 'Verify' }).click();
}

// What the stand-in for Stripe holds for an account, and a way to make it act.
const stripe = async (request, data) => {
  const res = await request.post('/__stripe/control', { data });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
};

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  trouble = watchForTrouble(page);
});

test.afterAll(async () => {
  await page.close();
});

test('this server is selling', async ({ request }) => {
  const options = await (await request.get('/api/auth/options')).json();
  expect(options.subscriptions).toBe(true);
});

test('sign-up without a code lands on the paywall, not in the app', async ({ browser }) => {
  await signUpWithoutCode(page, SUBSCRIBER);

  await expect(page.getByRole('heading', { name: 'Start with 7 days free' })).toBeVisible();
  await expect(page.getByText('VantraRun coaches each run against your own five zones, with routes, history and challenges.')).toBeVisible();
  await expect(page.getByText('$49.99 a year', { exact: true })).toBeVisible();
  await expect(page.getByText('$4.99 a month', { exact: true })).toBeVisible();
  await expect(page.getByText('Save $9.89 a year')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Annual/ })).toBeChecked();
  await expect(page.getByText('7 days free, then $49.99 a year.')).toBeVisible();
  await expect(
    page.getByText('Renews automatically until you cancel. Cancel any time in Settings, under Subscription; you keep access to the end of the period you paid for.')
  ).toBeVisible();
  await expect(page.getByText('Cancel before the trial ends and you pay nothing. We email you two days before it ends.')).toBeVisible();
  await expect(
    page.getByText('Monthly payments are not refundable. An annual payment is refunded in full if you ask within 14 days of the charge: email info@dtisys.com.')
  ).toBeVisible();
  await expect(page.getByText(/Payment is taken by Stripe; VantraRun never sees your card number\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'I have an invite code' })).toBeVisible();
  await expect(page.getByText(SUBSCRIBER.email)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();

  // nothing of the app itself, and not the old gate either
  await expect(page.getByRole('link', { name: 'Today' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Invite only' })).toHaveCount(0);

  // the terms and the privacy policy are linked, and open for someone who is not signed in
  await expect(page.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
  const visitor = await browser.newPage();
  await visitor.goto('/terms');
  await expect(visitor.getByRole('heading', { name: 'Terms of use' })).toBeVisible();
  await expect(visitor.getByText('VantraRun costs $4.99 a month or $49.99 a year when bought on the website.')).toBeVisible();
  await expect(visitor.getByText('Monthly payments are not refundable once charged.')).toBeVisible();
  await visitor.goto('/privacy');
  await expect(visitor.getByRole('heading', { name: 'Your data stays yours' })).toBeVisible();
  await expect(visitor.getByText(/subscriptions bought on the website are paid through Stripe/)).toBeVisible();
  await visitor.close();
});

test('the sign-up form says what creating an account agrees to', async ({ browser }) => {
  const visitor = await browser.newPage();
  await visitor.goto('/register');
  await expect(visitor.getByText('By creating an account you agree to the Terms of use and the Privacy policy.')).toBeVisible();
  await expect(visitor.getByLabel('Invite code')).not.toHaveAttribute('required', '');
  await visitor.close();
});

test('subscribing opens the app although no webhook arrives', async ({ request }) => {
  await page.getByRole('radio', { name: /Monthly/ }).check();
  await expect(page.getByText('7 days free, then $4.99 a month.')).toBeVisible();

  // First they change their mind on Stripe's page and come back.
  await stripe(request, { action: 'cancel-next-checkout' });
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(page).toHaveURL(/checkout=cancelled/);
  await expect(page.getByText('Checkout was cancelled. Nothing was charged.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with 7 days free' })).toBeVisible();

  // Then they go through with it. The server asked Stripe about this account a moment ago
  // (when the page above loaded) and will not ask again on its own for five minutes, and no
  // webhook is coming: it is the page's own confirmation that lets them in.
  await page.getByRole('radio', { name: /Monthly/ }).check();

  // Hold the first confirmation back for a moment so the waiting screen can be seen.
  let held = false;
  await page.route('**/api/functions/subscription', async (route) => {
    if (!held && route.request().postDataJSON()?.action === 'refresh') {
      held = true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your subscription…' })).toBeVisible();

  await acceptConsent(page);
  await expectSignedIn(page);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await expect(page).not.toHaveURL(/checkout=/);

  // Stripe was asked for a monthly plan with the 7-day trial, and no notice was ever sent.
  const held2 = await stripe(request, { action: 'state', email: SUBSCRIBER.email });
  expect(held2.sessions).toEqual([
    { status: 'expired', plan: 'monthly', trialDays: 7 },
    { status: 'complete', plan: 'monthly', trialDays: 7 },
  ]);
  expect(held2.subscriptions.map((s) => s.status)).toEqual(['trialing']);
  expect(held2.eventsSent).toBe(0);
});

test('Settings shows the trial, cancelling shows "Ends on" with Resume, and Resume puts it back', async () => {
  await page.goto('/settings');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Subscription', exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Monthly plan, $4.99 a month')).toBeVisible();
  await expect(card.getByText(/^Free trial\. Ends on .+, then \$4\.99 a month\.$/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
  await expect(
    card.getByText(/Monthly payments are not refundable\. Annual: full refund within 14 days of the charge, on request to info@dtisys\.com\./)
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Resume' })).toHaveCount(0);

  // two taps: the link here, then the confirmation on Stripe's page (the stand-in confirms at once)
  await card.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(card.getByText(/^Ends on .+\. You will not be charged\.$/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0);
  // still in the app until the period ends
  await expect(page.getByRole('link', { name: 'Today' }).first()).toBeVisible();

  await card.getByRole('button', { name: 'Resume' }).click();
  await expect(card.getByText('Your subscription continues.')).toBeVisible();
  await expect(card.getByText(/^Free trial\. Ends on .+, then \$4\.99 a month\.$/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Cancel subscription' })).toBeVisible();
});

test('the owner sees the subscriber as "Trial (monthly)"', async ({ browser }) => {
  const owner = await browser.newPage();
  const ownerTrouble = watchForTrouble(owner);
  await signIn(owner, ADMIN);
  await acceptConsent(owner);
  await expectSignedIn(owner);
  await owner.goto('/settings');
  const card = owner.locator('section', { has: owner.getByRole('heading', { name: 'Who has access' }) });
  const row = card.getByRole('row').filter({ hasText: SUBSCRIBER.email });
  await expect(row).toContainText('Trial (monthly)');
  await expect(row).toContainText('Trial ends');
  await expect(row).toContainText(/sub_fake/);
  // an admin has no subscription card of their own
  await expect(owner.getByRole('heading', { name: 'Subscription', exact: true })).toHaveCount(0);
  expect(ownerTrouble).toEqual([]);
  await owner.close();
});

test('a refund in the middle of a session sends the person to the paywall', async ({ request }) => {
  await page.goto('/');
  await expectSignedIn(page);

  const refunded = await stripe(request, { action: 'refund', email: SUBSCRIBER.email });
  expect(refunded.webhook).toBe(200);

  // the next thing they do in the app is refused by the server; the paywall takes over
  await page.getByRole('link', { name: 'Routes' }).first().click();
  await expect(page.getByRole('heading', { name: 'Subscribe to VantraRun' })).toBeVisible();
  await expect(page.getByText('$4.99 a month, charged today.').or(page.getByText('$49.99 a year, charged today.'))).toBeVisible();
  await expect(page.getByText(/7 days free/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Today' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // a refusal is not a fault: no server error, no page error
  expect(trouble).toEqual([]);
  // and it holds after a reload
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Subscribe to VantraRun' })).toBeVisible();
});

test('a person can delete their account from the paywall', async ({ request }) => {
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading', { name: 'Delete your VantraRun account?' })).toBeVisible();
  await expect(dialog.getByText(/A subscription bought on the website is cancelled and you are not charged again\./)).toBeVisible();
  await dialog.getByLabel('Password').fill(SUBSCRIBER.password);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/login/);

  const login = await request.post('/api/auth/login', { data: SUBSCRIBER });
  expect(login.status()).toBe(401);
  // the customer went at Stripe before the account did
  const left = await stripe(request, { action: 'state', email: SUBSCRIBER.email });
  expect(left.account).toBe(false);
  expect(left.customersDeleted).toContain(SUBSCRIBER.email);
});

test('cancelled checkout says nothing was charged', async () => {
  await signUpWithoutCode(page, INVITED);
  await expect(page.getByRole('heading', { name: 'Start with 7 days free' })).toBeVisible();
  await page.goto('/?checkout=cancelled');
  await expect(page.getByText('Checkout was cancelled. Nothing was charged.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with 7 days free' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Today' })).toHaveCount(0);
});

test('an invite code entered on the paywall opens the app with no card asked for', async ({ request }) => {
  const code = await mintCode(request, 'paywall');
  await page.getByRole('button', { name: 'I have an invite code' }).click();
  await page.getByLabel('Invite code').fill(code);
  await page.getByRole('button', { name: 'Unlock VantraRun' }).click();
  await acceptConsent(page);
  await expectSignedIn(page);

  // Stripe never heard of this account
  const held = await stripe(request, { action: 'state', email: INVITED.email });
  expect(held.customer).toBe(false);
  expect(held.sessions).toEqual([]);
  // and no Subscription card: there is nothing to manage
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toHaveCount(0);
});

test('the subscription screens raised no errors', async () => {
  expect(trouble).toEqual([]);
});
