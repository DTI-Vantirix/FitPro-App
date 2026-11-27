// Starts the real API, serving the built web app, against a throwaway database
// for the browser tests. Everything in fitpro_e2e is wiped on every start.
//   node e2e/start-server.mjs                 (Playwright runs this; see playwright.config.mjs)
//   node e2e/start-server.mjs subscriptions   a second server with SUBSCRIPTIONS on and a
//                                             stand-in for Stripe, on fitpro_e2e_subs (below)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ADMIN, BASE_URL, CARRIED, PORT, SUBS_BASE_URL, SUBS_PORT } from './fixtures.mjs';

// The second server: same website, same API, but selling. Its own port and database.
const selling = process.argv[2] === 'subscriptions';
const baseUrl = selling ? SUBS_BASE_URL : BASE_URL;
const port = selling ? SUBS_PORT : PORT;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pick up the local database port from server/.env, then pin everything else so
// a developer's settings can never leak into a test run (or a test run into
// their database or their mail provider).
try {
  process.loadEnvFile?.(path.join(root, 'server', '.env'));
} catch {
  // no server/.env: the defaults below apply
}
const nearby = process.env.TEST_DATABASE_URL || 'postgres://fitpro:fitpro@localhost:5432/fitpro_test';
const e2eUrl = new URL(process.env.E2E_DATABASE_URL || nearby);
if (!process.env.E2E_DATABASE_URL) e2eUrl.pathname = '/fitpro_e2e';
if (selling) e2eUrl.pathname = `${e2eUrl.pathname}_subs`;
const dbName = decodeURIComponent(e2eUrl.pathname.slice(1));
if (!/e2e/.test(dbName)) throw new Error(`Refusing to wipe "${dbName}": the e2e database name must contain "e2e".`);

Object.assign(process.env, {
  NODE_ENV: 'development', // so sign-up answers include the emailed code
  DATABASE_URL: e2eUrl.href,
  PORT: String(port),
  WEB_DIST: path.join(root, 'web', 'dist'),
  APP_URL: baseUrl,
  PUBLIC_URL: '',
  CORS_ORIGINS: baseUrl,
  ROUTER_URL: 'off',
  RESEND_API_KEY: '', // never send real email from a test run
  EXPOSE_DEV_CODES: 'true',
  TRUST_PROXY: 'false',
  UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-e2e-uploads-')),
  MIGRATE_ON_START: 'false',
  // The first server covers today's invite-only sign-up; the second one sells.
  SUBSCRIPTIONS: selling ? 'on' : 'off',
  // Never a developer's Stripe settings: the second server gets made-up ids and a fake below.
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  STRIPE_PRICE_MONTHLY: '',
  STRIPE_PRICE_ANNUAL: '',
});

const { createDb } = await import('../server/src/db.js');
const { migrate } = await import('../server/src/migrate.js');
const { hashPassword } = await import('../server/src/auth/crypto.js');

// Create the database on first use.
const admin = createDb(nearby);
try {
  const found = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (!found.length) await admin.exec(`create database "${dbName.replace(/"/g, '')}"`);
} finally {
  await admin.close();
}

const db = createDb(e2eUrl.href);
try {
  await db.exec('drop schema if exists public cascade; create schema public;');
  await migrate(db, { log: () => {} });
  await db.query(
    `insert into users (email, password_hash, full_name, role, email_verified_at)
     values ($1, $2, 'E2E Admin', 'admin', now()) returning id`,
    [ADMIN.email, await hashPassword(ADMIN.password)]
  );
  // Someone who redeemed a code while the previous build was serving: the grant is
  // there, the entitlement is not. Starting the API below has to put that right.
  const [carried] = await db.query(
    `insert into users (email, password_hash, full_name, email_verified_at)
     values ($1, $2, 'E2E Carried', now()) returning id`,
    [CARRIED.email, await hashPassword(CARRIED.password)]
  );
  await db.query(`insert into access_grants (user_id, email, code, granted_at) values ($1, $2, 'FP-OLD0-BLD0', now()) returning id`, [
    carried.id,
    CARRIED.email,
  ]);
  await db.query('delete from entitlements where user_id = $1 returning id', [carried.id]);
} finally {
  await db.close();
}

if (!selling) {
  await import('../server/src/index.js');
} else {
  const { startSellingServer } = await import('./stripe-stand-in.mjs');
  await startSellingServer({ baseUrl, port });
}
