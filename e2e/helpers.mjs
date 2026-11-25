import { expect } from '@playwright/test';
import { ADMIN } from './fixtures.mjs';

export const CODE_RE = /FP-[A-Z2-9]{4}-[A-Z2-9]{4}/;

// Sign in through the login page.
export async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

// The one-time health-data consent screen every new account sees.
export async function acceptConsent(page) {
  await expect(page.getByRole('heading', { name: 'Your training data, in your hands' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue' }).click();
}

export async function expectSignedIn(page) {
  await expect(page.getByRole('link', { name: 'Today' }).first()).toBeVisible();
}

// An invite code minted through the API as the admin, for tests that need one
// without going through the Settings screen.
export async function mintCode(request, note = 'e2e') {
  const login = await request.post('/api/auth/login', { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  const { access_token: token } = await login.json();
  const res = await request.post('/api/functions/adminInviteCodes', {
    headers: { Authorization: `Bearer ${token}` },
    data: { action: 'generate', count: 1, note },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).created[0].code;
}

// Fill and submit the sign-up form. Resolves with the server's answer, which in
// a test run carries the emailed code as `dev_code`.
export async function submitSignUp(page, { inviteCode, email, password }) {
  await page.goto('/register');
  await page.getByLabel('Invite code').fill(inviteCode);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password').fill(password);
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create account' }).click();
  const res = await answer;
  return { status: res.status(), body: await res.json() };
}

// Collects uncaught page errors and failed API calls so a test can assert the
// screens it visited were healthy.
export function watchForTrouble(page) {
  const trouble = [];
  page.on('pageerror', (err) => trouble.push(`page error: ${err.message}`));
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) trouble.push(`${res.status()} ${res.url()}`);
  });
  return trouble;
}
