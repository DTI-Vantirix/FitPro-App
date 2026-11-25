// Starts the real API, serving the built web app, against a throwaway database
// for the browser tests. Everything in fitpro_e2e is wiped on every start.
//   node e2e/start-server.mjs        (Playwright runs this; see playwright.config.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, BASE_URL, PORT } from './fixtures.mjs';

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
const dbName = decodeURIComponent(e2eUrl.pathname.slice(1));
if (!/e2e/.test(dbName)) throw new Error(`Refusing to wipe "${dbName}": the e2e database name must contain "e2e".`);

Object.assign(process.env, {
  NODE_ENV: 'development', // so sign-up answers include the emailed code
  DATABASE_URL: e2eUrl.href,
  PORT: String(PORT),
  WEB_DIST: path.join(root, 'web', 'dist'),
  APP_URL: BASE_URL,
  PUBLIC_URL: '',
  CORS_ORIGINS: BASE_URL,
  ROUTER_URL: 'off',
  RESEND_API_KEY: '', // never send real email from a test run
  EXPOSE_DEV_CODES: 'true',
  TRUST_PROXY: 'false',
  UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-e2e-uploads-')),
  MIGRATE_ON_START: 'false',
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
} finally {
  await db.close();
}

await import('../server/src/index.js');
