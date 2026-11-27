// End-to-end API tests against a real Postgres database.
//   TEST_DATABASE_URL=postgres://fitpro:fitpro@localhost:5432/fitpro_test npm test
// The test database is wiped at the start of every run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { GRACE_DAYS, accessOf, grantFree, hasAccess, syncInviteEntitlements } from '../src/access.js';
import { createApp } from '../src/app.js';
import { SERVER_ROOT, loadConfig } from '../src/config.js';
import { bootstrapAdmin } from '../src/auth/bootstrap.js';
import { hashPassword } from '../src/auth/crypto.js';
import { formatDay, sendTrialReminders } from '../src/billing/reminders.js';
import { loadRegistry } from '../src/entities/registry.js';
import { migrate } from '../src/migrate.js';
import { createPsqlDb } from './psql-db.js';
import { TEST_PRICES, TEST_STRIPE, createFakeStripe, daysFromNowUnix, signedEvent } from './stripe-fake.js';

const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://fitpro:fitpro@localhost:5432/fitpro_test';

async function openDb() {
  try {
    const { createDb } = await import('../src/db.js');
    return createDb(DB_URL);
  } catch {
    return createPsqlDb(DB_URL); // `pg` not installed: fall back to the psql CLI
  }
}

let db;
let server;
let base;
let testConfig;
let registry;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-uploads-'));

// `origin` sends the request to another instance of the API (see startApp).
async function call(method, url, { body, token, headers = {}, raw, origin = base } = {}) {
  const res = await fetch(origin + url, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// Sign-up needs an invite code, so tests mint one straight into the database.
let codeSeq = 0;
async function mintCode() {
  codeSeq += 1;
  const code = `FP-TEST-${String(codeSeq).padStart(4, '0')}`;
  await db.query(`insert into invite_codes (code, status, note) values ($1, 'available', 'test') returning id`, [code]);
  return code;
}

async function signUp(email, password = 'correct-horse-1') {
  return signUpWith(email, await mintCode(), password);
}

// An account from before sign-up needed a code: verified, but no accepted invite
// and so no access. Written straight into the database, as such accounts were
// never made by today's sign-up (and so that it does not count as a sign-up).
let passwordHash;
async function legacyUser(email, password = 'correct-horse-1') {
  passwordHash ||= await hashPassword('correct-horse-1');
  await db.query(
    `insert into users (email, password_hash, full_name, email_verified_at) values ($1, $2, $3, now()) returning id`,
    [email, password === 'correct-horse-1' ? passwordHash : await hashPassword(password), email.split('@')[0]]
  );
  const login = await call('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return { token: login.data.access_token, user: login.data.user };
}

// An account that has access through an invite code, without going through sign-up
// (the API allows 30 sign-ups an hour from one address, and the suite is near that).
async function invitedUser(email, code) {
  const account = await legacyUser(email);
  code ||= await mintCode();
  const res = await call('POST', '/api/functions/inviteAccess', { token: account.token, body: { action: 'redeem', code } });
  assert.deepEqual(res.data, { allowed: true });
  return account;
}

const userRow = async (id) => (await db.query('select * from users where id = $1', [id]))[0];
const entitlementsOf = (userId) =>
  db.query('select * from entitlements where user_id = $1 order by created_date, source', [userId]);
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

async function signUpWith(email, inviteCode, password = 'correct-horse-1') {
  const reg = await call('POST', '/api/auth/register', {
    body: { email, password, full_name: email.split('@')[0], invite_code: inviteCode },
  });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  const ver = await call('POST', '/api/auth/verify-otp', { body: { email, otp_code: reg.data.dev_code } });
  assert.equal(ver.status, 200, JSON.stringify(ver.data));
  return { token: ver.data.access_token, user: ver.data.user };
}

before(async () => {
  db = await openDb();
  await db.exec('drop schema if exists public cascade; create schema public;');
  await migrate(db, { log: () => {} });
  testConfig = { ...loadConfig({ NODE_ENV: 'test' }), uploadDir, routerUrl: 'off' };
  registry = await loadRegistry(db);
  server = http.createServer(createApp({ db, config: testConfig, registry }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log = () => {}; // silence request logs
});

// A second instance of the API on the same database with some settings changed,
// for behaviour that sits behind a setting. Returns its address and a way to stop it.
// `stripe` replaces the Stripe client with a fake (test/stripe-fake.js).
async function startApp(overrides, { stripe } = {}) {
  const other = http.createServer(createApp({ db, config: { ...testConfig, ...overrides }, registry, ...(stripe ? { stripe } : {}) }));
  await new Promise((r) => other.listen(0, r));
  return {
    origin: `http://127.0.0.1:${other.address().port}`,
    close: () => new Promise((r) => other.close(r)),
  };
}

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
});

let alice;
let bob;
let admin;

describe('auth', () => {
  test('sign up, verify, me', async () => {
    alice = await signUp('alice@example.com');
    bob = await signUp('bob@example.com');
    const me = await call('GET', '/api/auth/me', { token: alice.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, 'alice@example.com');
    assert.equal(me.data.role, 'user');
    assert.equal(me.data.password_hash, undefined);
  });

  test('wrong code and wrong password are rejected', async () => {
    const reg = await call('POST', '/api/auth/register', { body: { email: 'carol@example.com', password: 'longenough', invite_code: await mintCode() } });
    const bad = await call('POST', '/api/auth/verify-otp', { body: { email: 'carol@example.com', otp_code: '000000' === reg.data.dev_code ? '111111' : '000000' } });
    assert.equal(bad.status, 400);
    const unverified = await call('POST', '/api/auth/login', { body: { email: 'carol@example.com', password: 'longenough' } });
    assert.equal(unverified.status, 403);
    assert.equal(unverified.data.needs_verification, true);
    const wrong = await call('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'nope-nope' } });
    assert.equal(wrong.status, 401);
    const ok = await call('POST', '/api/auth/login', { body: { email: 'ALICE@example.com', password: 'correct-horse-1' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.access_token);
  });

  test('duplicate verified email is refused', async () => {
    const dup = await call('POST', '/api/auth/register', { body: { email: 'alice@example.com', password: 'whatever123', invite_code: await mintCode() } });
    assert.equal(dup.status, 409);
  });

  test('no token, bad token -> 401', async () => {
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: 'x.y.z' })).status, 401);
    assert.equal((await call('POST', '/api/entities/Run/query', { body: {} })).status, 401);
  });

  test('updateMe sets consent but never role', async () => {
    const res = await call('PUT', '/api/auth/me', {
      token: alice.token,
      body: { consent_version: '2026-11', consent_accepted_at: '2026-11-20T06:00:00Z', role: 'admin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.consent_version, '2026-11');
    assert.equal(res.data.role, 'user');
  });

  test('password reset flow invalidates old tokens', async () => {
    const dave = await signUp('dave@example.com');
    const req = await call('POST', '/api/auth/reset-password-request', { body: { email: 'dave@example.com' } });
    assert.ok(req.data.dev_token);
    const reset = await call('POST', '/api/auth/reset-password', {
      body: { resetToken: req.data.dev_token, newPassword: 'brand-new-pass' },
    });
    assert.equal(reset.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: dave.token })).status, 401);
    const again = await call('POST', '/api/auth/reset-password', {
      body: { resetToken: req.data.dev_token, newPassword: 'another-pass' },
    });
    assert.equal(again.status, 400, 'reset links are single use');
    const login = await call('POST', '/api/auth/login', { body: { email: 'dave@example.com', password: 'brand-new-pass' } });
    assert.equal(login.status, 200);
  });

  test('change password returns a fresh token', async () => {
    const erin = await signUp('erin@example.com');
    const res = await call('POST', '/api/auth/change-password', {
      token: erin.token,
      body: { currentPassword: 'correct-horse-1', newPassword: 'even-better-1' },
    });
    assert.equal(res.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: erin.token })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: res.data.access_token })).status, 200);
  });

  test('mfa routes answer 501', async () => {
    assert.equal((await call('POST', '/api/auth/mfa/handoff', { body: {} })).status, 501);
  });
});

describe('entities and access rules', () => {
  let aliceRun;

  test('create and list own runs', async () => {
    const created = await call('POST', '/api/entities/Run', {
      token: alice.token,
      body: {
        distance_mi: 3.1,
        duration_sec: 1500,
        route_name: 'Ironworks loop',
        started_at: '2026-11-10T12:00:00Z',
        points: [{ lat: 40.7, lng: -74 }],
        route_id: '', // blank optional link is treated as unset
        not_a_field: 'dropped',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    aliceRun = created.data;
    assert.equal(aliceRun.created_by_id, alice.user.id);
    assert.equal(aliceRun.created_by, 'alice@example.com');
    assert.deepEqual(aliceRun.points, [{ lat: 40.7, lng: -74 }]);
    assert.equal(aliceRun.not_a_field, undefined);
    assert.equal(aliceRun.route_id, undefined);

    const page = await call('POST', '/api/entities/Run/query', { token: alice.token, body: { sort: '-started_at', limit: 40 } });
    assert.equal(page.status, 200);
    assert.equal(page.data.items.length, 1);
  });

  test('required fields and enums are enforced', async () => {
    const missing = await call('POST', '/api/entities/Run', { token: alice.token, body: { distance_mi: 1 } });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /duration_sec/);
    const badEnum = await call('POST', '/api/entities/Post', { token: alice.token, body: { kind: 'swim' } });
    assert.equal(badEnum.status, 400);
    const badNum = await call('POST', '/api/entities/Run', { token: alice.token, body: { distance_mi: 'far', duration_sec: 3 } });
    assert.equal(badNum.status, 400);
  });

  test("other users can't see, change or delete it", async () => {
    const list = await call('POST', '/api/entities/Run/query', { token: bob.token, body: {} });
    assert.equal(list.data.items.length, 0);
    assert.equal((await call('GET', `/api/entities/Run/${aliceRun.id}`, { token: bob.token })).status, 404);
    assert.equal((await call('PUT', `/api/entities/Run/${aliceRun.id}`, { token: bob.token, body: { notes: 'x' } })).status, 404);
    assert.equal((await call('DELETE', `/api/entities/Run/${aliceRun.id}`, { token: bob.token })).status, 404);
    const many = await call('POST', '/api/entities/Run/delete-many', { token: bob.token, body: { q: { created_by_id: alice.user.id } } });
    assert.equal(many.data.deleted, 0);
  });

  test('owner can update; system fields are not writable', async () => {
    const res = await call('PUT', `/api/entities/Run/${aliceRun.id}`, {
      token: alice.token,
      body: { notes: 'felt good', created_by_id: bob.user.id, id: 'nope' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.notes, 'felt good');
    assert.equal(res.data.created_by_id, alice.user.id);
    assert.equal(res.data.id, aliceRun.id);
  });

  test('filters: $in, $gte/$lt, $or, data.field', async () => {
    const q = (body) => call('POST', '/api/entities/Run/query', { token: alice.token, body });
    assert.equal((await q({ q: { started_at: { $gte: '2026-11-01', $lt: '2026-12-01' } } })).data.items.length, 1);
    assert.equal((await q({ q: { started_at: { $gte: '2026-12-01' } } })).data.items.length, 0);
    assert.equal((await q({ q: { id: { $in: [aliceRun.id, 'not-an-id'] } } })).data.items.length, 1);
    assert.equal((await q({ q: { $or: [{ route_name: 'nope' }, { 'data.route_name': 'Ironworks loop' }] } })).data.items.length, 1);
    assert.equal((await q({ q: { route_id: 'not-a-uuid' } })).data.items.length, 0);
    assert.equal((await q({ q: { points: [] } })).status, 400);
    assert.equal((await q({ sort: 'bogus' })).status, 400);
    assert.equal((await q({ q: { distance_mi: { $regex: 'x' } } })).status, 400);
  });

  test('public posts are readable by others, friends posts are not', async () => {
    const pub = await call('POST', '/api/entities/Post', { token: alice.token, body: { kind: 'run', title: 'public run', visibility: 'public' } });
    const fr = await call('POST', '/api/entities/Post', { token: alice.token, body: { kind: 'run', title: 'friends run' } });
    assert.equal(fr.data.visibility, 'friends', 'schema default applied');
    const seen = await call('POST', '/api/entities/Post/query', { token: bob.token, body: { q: { visibility: 'public' } } });
    assert.deepEqual(seen.data.items.map((p) => p.id), [pub.data.id]);
    assert.equal((await call('GET', `/api/entities/Post/${fr.data.id}`, { token: bob.token })).status, 404);
    assert.equal((await call('DELETE', `/api/entities/Post/${pub.data.id}`, { token: bob.token })).status, 403);
  });

  test('field rules: a membership must be your own', async () => {
    const ch = await call('POST', '/api/entities/Challenge', {
      token: alice.token,
      body: { name: 'November 100', metric: 'distance', target_value: 100, month: '2026-11', start_date: '2026-11-01T00:00:00Z', end_date: '2026-12-01T00:00:00Z' },
    });
    assert.equal(ch.status, 201);
    const forged = await call('POST', '/api/entities/ChallengeMember', {
      token: bob.token,
      body: { challenge_id: ch.data.id, user_id: alice.user.id },
    });
    assert.equal(forged.status, 403);
    const own = await call('POST', '/api/entities/ChallengeMember', {
      token: bob.token,
      body: { challenge_id: ch.data.id, user_id: bob.user.id, handle: 'bob' },
    });
    assert.equal(own.status, 201);
    const handOff = await call('PUT', `/api/entities/ChallengeMember/${own.data.id}`, {
      token: bob.token,
      body: { user_id: alice.user.id },
    });
    assert.equal(handOff.status, 403, "can't reassign a record to someone else");
    const dup = await call('POST', '/api/entities/ChallengeMember', {
      token: bob.token,
      body: { challenge_id: ch.data.id, user_id: bob.user.id },
    });
    assert.equal(dup.status, 409);
    await call('POST', '/api/entities/ChallengeMember', {
      token: alice.token,
      body: { challenge_id: ch.data.id, user_id: alice.user.id, name: 'Alice' },
    });

    await call('POST', '/api/entities/Run', { token: bob.token, body: { distance_mi: 5, duration_sec: 2400, started_at: '2026-11-15T10:00:00Z' } });
    await call('POST', '/api/entities/Run', { token: bob.token, body: { distance_mi: 9, duration_sec: 4000, started_at: '2026-10-15T10:00:00Z' } });
    const board = await call('POST', '/api/functions/challengeBoard', { token: bob.token, body: { challenge_id: ch.data.id } });
    assert.equal(board.status, 200, JSON.stringify(board.data));
    assert.equal(board.data.member_count, 2);
    assert.equal(board.data.joined, true);
    assert.deepEqual(
      board.data.rows.map((r) => [r.handle || r.name, r.value]),
      [['bob', 5], ['Alice', 3.1]]
    );
  });

  test('bulk create and bulk update pace zones', async () => {
    const zones = [1, 2, 3].map((n) => ({ name: `Zone ${n}`, zone_number: n, fast_sec: 600 - n * 30, slow_sec: 660 - n * 30 }));
    const created = await call('POST', '/api/entities/PaceZone/bulk', { token: alice.token, body: zones });
    assert.equal(created.status, 200);
    assert.equal(created.data.length, 3);
    const updated = await call('PUT', '/api/entities/PaceZone/bulk', {
      token: alice.token,
      body: created.data.map((z) => ({ id: z.id, color: '#ff0000' })),
    });
    assert.equal(updated.status, 200);
    assert.ok(updated.data.every((z) => z.color === '#ff0000'));
    const sorted = await call('POST', '/api/entities/PaceZone/query', { token: alice.token, body: { sort: 'fast_sec' } });
    assert.deepEqual(sorted.data.items.map((z) => z.zone_number), [3, 2, 1]);
  });

  test('admins can read everyone; invite codes are admin-only', async () => {
    const adminReg = await signUp('admin@example.com');
    await db.query(`update users set role = 'admin' where id = $1 returning id`, [adminReg.user.id]);
    admin = adminReg;
    const runs = await call('POST', '/api/entities/Run/query', { token: admin.token, body: {} });
    assert.ok(runs.data.items.length >= 3);
    const codes = await call('POST', '/api/entities/InviteCode/query', { token: alice.token, body: {} });
    assert.equal(codes.data.items.length, 0);
    assert.equal((await call('POST', '/api/entities/InviteCode', { token: alice.token, body: { code: 'MINE' } })).status, 403);
  });
});

describe('invite access', () => {
  let codes;
  let nina;
  let omar;
  let before;

  test('non-admins cannot mint codes', async () => {
    const res = await call('POST', '/api/functions/adminInviteCodes', { token: alice.token, body: { action: 'generate' } });
    assert.equal(res.status, 403);
  });

  test('admin generates, user redeems, code is single use', async () => {
    nina = await legacyUser('nina@example.com');
    omar = await legacyUser('omar@example.com');
    before = (await call('POST', '/api/functions/adminInviteCodes', { token: admin.token, body: { action: 'list' } })).data;
    const gen = await call('POST', '/api/functions/adminInviteCodes', { token: admin.token, body: { action: 'generate', count: 3, note: 'batch 1' } });
    assert.equal(gen.status, 200);
    codes = gen.data.created;
    assert.equal(codes.length, 3);
    assert.match(codes[0].code, /^FP-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    assert.deepEqual((await call('POST', '/api/functions/inviteAccess', { token: nina.token, body: { action: 'status' } })).data, {
      allowed: false, reason: null, source: null, plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false,
    });
    const wrong = await call('POST', '/api/functions/inviteAccess', { token: nina.token, body: { action: 'redeem', code: 'FP-NOPE-NOPE' } });
    assert.equal(wrong.data.allowed, false);
    const redeem = await call('POST', '/api/functions/inviteAccess', {
      token: nina.token,
      body: { action: 'redeem', code: ` ${codes[0].code.toLowerCase()} ` },
    });
    assert.deepEqual(redeem.data, { allowed: true });
    assert.equal((await call('POST', '/api/functions/inviteAccess', { token: nina.token, body: {} })).data.allowed, true);

    const reuse = await call('POST', '/api/functions/inviteAccess', { token: omar.token, body: { action: 'redeem', code: codes[0].code } });
    assert.equal(reuse.data.allowed, false);
    assert.match(reuse.data.error, /already been used/);

    assert.deepEqual((await call('POST', '/api/functions/inviteAccess', { token: admin.token, body: {} })).data, {
      allowed: true, admin: true, reason: 'admin', source: null, plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false,
    });
  });

  test('revoke only unused codes', async () => {
    const used = await call('POST', '/api/functions/adminInviteCodes', { token: admin.token, body: { action: 'revoke', id: codes[0].id } });
    assert.equal(used.status, 400);
    const ok = await call('POST', '/api/functions/adminInviteCodes', { token: admin.token, body: { action: 'revoke', id: codes[1].id } });
    assert.equal(ok.data.code.status, 'revoked');
    const list = await call('POST', '/api/functions/adminInviteCodes', { token: admin.token, body: { action: 'list' } });
    assert.deepEqual(
      [list.data.stats.available - before.stats.available, list.data.stats.used - before.stats.used, list.data.stats.revoked - before.stats.revoked],
      [1, 1, 1]
    );
    assert.equal(list.data.grants.length - before.grants.length, 1);
    const grant = await call('POST', '/api/entities/AccessGrant/query', { token: nina.token, body: {} });
    assert.equal(grant.data.items.length, 1, 'a user can read their own grant');
  });
});

describe('access', () => {
  test('an account that signed up with a code has access because of the invite', async () => {
    const code = await mintCode();
    const ada = await signUpWith('ada.access@example.com', code);
    const access = await accessOf(db, await userRow(ada.user.id));
    assert.equal(access.allowed, true);
    assert.equal(access.admin, false);
    assert.equal(access.reason, 'invite');
    assert.equal(access.source, 'invite');
    assert.equal(access.plan, null);
    assert.equal(access.expires_at, null);
    assert.equal(access.cancel_at_period_end, false);
    assert.equal(await hasAccess(db, await userRow(ada.user.id)), true);

    const rows = await entitlementsOf(ada.user.id);
    assert.deepEqual(rows.map((r) => [r.source, r.status, r.granted_by]), [['invite', 'active', code]]);
    const grants = await db.query('select code from access_grants where user_id = $1', [ada.user.id]);
    assert.deepEqual(grants.map((g) => g.code), [code], 'the invite-code screen still reads access_grants');
  });

  test('an admin has access by role alone, with no entitlement row', async () => {
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'role-only@example.com', ADMIN_PASSWORD: 'a-long-enough-password' }), 'created');
    const [row] = await db.query(`select * from users where email = 'role-only@example.com'`, []);
    assert.equal((await entitlementsOf(row.id)).length, 0);
    const access = await accessOf(db, row);
    assert.equal(access.allowed, true);
    assert.equal(access.admin, true);
    assert.equal(access.reason, 'admin');
    assert.equal(access.source, null);
    assert.equal(await hasAccess(db, row), true);
  });

  test('a verified account with no grant has no access until it redeems a code', async () => {
    const lena = await legacyUser('lena.access@example.com');
    const before = await accessOf(db, await userRow(lena.user.id));
    assert.equal(before.allowed, false);
    assert.equal(before.admin, false);
    assert.equal(before.reason, null);
    assert.equal(before.source, null);
    assert.equal(await hasAccess(db, await userRow(lena.user.id)), false);

    const code = await mintCode();
    const res = await call('POST', '/api/functions/inviteAccess', { token: lena.token, body: { action: 'redeem', code } });
    assert.equal(res.data.allowed, true);
    const after = await accessOf(db, await userRow(lena.user.id));
    assert.equal(after.allowed, true);
    assert.equal(after.reason, 'invite');
    assert.deepEqual((await entitlementsOf(lena.user.id)).map((r) => [r.source, r.status, r.granted_by]), [['invite', 'active', code]]);
  });

  test('an entitlement just past its end is good for the allowance, and not after it', async () => {
    const paul = await legacyUser('paul.access@example.com');
    const user = await userRow(paul.user.id);
    const [row] = await db.query(
      `insert into entitlements (user_id, source, status, plan, expires_at, external_id)
       values ($1, 'stripe', 'active', 'monthly', $2, 'sub_paul') returning *`,
      [user.id, daysFromNow(-(GRACE_DAYS - 1))]
    );
    const inGrace = await accessOf(db, user);
    assert.equal(inGrace.allowed, true);
    assert.equal(inGrace.reason, 'subscription');
    assert.equal(inGrace.plan, 'monthly');
    assert.equal(new Date(inGrace.expires_at).getTime(), new Date(row.expires_at).getTime());

    await db.query('update entitlements set expires_at = $2 where id = $1 returning id', [row.id, daysFromNow(-(GRACE_DAYS + 1))]);
    const past = await accessOf(db, user);
    assert.equal(past.allowed, false);
    assert.equal(past.reason, null);
    assert.equal(past.plan, null);
  });

  test('with an invite and a paid entitlement, the paid one is reported and either keeps access', async () => {
    const tess = await invitedUser('tess.access@example.com');
    const user = await userRow(tess.user.id);
    await db.query(
      `insert into entitlements (user_id, source, status, plan, expires_at, cancel_at_period_end, external_id)
       values ($1, 'stripe', 'trial', 'annual', $2, true, 'sub_tess') returning id`,
      [user.id, daysFromNow(5)]
    );
    const both = await accessOf(db, user);
    assert.equal(both.allowed, true);
    assert.equal(both.reason, 'trial', 'paid before free');
    assert.equal(both.source, 'stripe');
    assert.equal(both.plan, 'annual');
    assert.equal(both.cancel_at_period_end, true);

    await db.query(`update entitlements set status = 'active' where user_id = $1 and source = 'stripe' returning id`, [user.id]);
    assert.equal((await accessOf(db, user)).reason, 'subscription');

    // the free pass goes: the paid one still holds
    await db.query(`update entitlements set status = 'revoked' where user_id = $1 and source = 'invite' returning id`, [user.id]);
    const paidOnly = await accessOf(db, user);
    assert.equal(paidOnly.allowed, true);
    assert.equal(paidOnly.source, 'stripe');

    // the paid one lapses and the free one comes back: access is by invite again
    await db.query(`update entitlements set status = 'expired' where user_id = $1 and source = 'stripe' returning id`, [user.id]);
    assert.equal((await accessOf(db, user)).allowed, false);
    await db.query(`update entitlements set status = 'active' where user_id = $1 and source = 'invite' returning id`, [user.id]);
    const freeOnly = await accessOf(db, user);
    assert.equal(freeOnly.allowed, true);
    assert.equal(freeOnly.reason, 'invite');
  });

  test('grantFree gives one row per person and source, and brings a revoked one back', async () => {
    const gus = await legacyUser('gus.access@example.com');
    const user = await userRow(gus.user.id);
    const first = await db.tx((tx) => grantFree(tx, { userId: user.id, source: 'admin', grantedBy: 'owner@example.com', note: 'coach' }));
    assert.deepEqual([first.source, first.status, first.granted_by, first.note], ['admin', 'active', 'owner@example.com', 'coach']);
    assert.equal((await accessOf(db, user)).reason, 'granted');

    const again = await db.tx((tx) => grantFree(tx, { userId: user.id, source: 'admin', grantedBy: 'other@example.com' }));
    assert.equal(again.id, first.id, 'granting twice is harmless');
    assert.deepEqual([again.granted_by, again.note], ['owner@example.com', 'coach'], 'a pass that is still good keeps its history');
    assert.equal((await entitlementsOf(user.id)).length, 1);

    await db.query(`update entitlements set status = 'revoked' where id = $1 returning id`, [first.id]);
    assert.equal(await hasAccess(db, user), false);
    const back = await db.tx((tx) => grantFree(tx, { userId: user.id, source: 'admin', grantedBy: 'other@example.com', note: 'back again' }));
    assert.deepEqual([back.id, back.status, back.granted_by, back.note], [first.id, 'active', 'other@example.com', 'back again']);
    assert.equal(await hasAccess(db, user), true);

    await assert.rejects(db.tx((tx) => grantFree(tx, { userId: user.id, source: 'stripe', grantedBy: 'x' })), /free/i);
  });

  test('the database refuses an unknown source or status, and a second row for one subscription', async () => {
    const user = await userRow(bob.user.id);
    const insert = (source, status, externalId, expiresAt = daysFromNow(30)) =>
      db.query('insert into entitlements (user_id, source, status, external_id, expires_at) values ($1, $2, $3, $4, $5) returning id', [
        user.id, source, status, externalId, expiresAt,
      ]);
    await assert.rejects(insert('paypal', 'active', null));
    await assert.rejects(insert('stripe', 'paused', null));
    await assert.rejects(insert('invite', 'active', null, null), 'bob already has his invite row');
    await insert('apple', 'expired', 'orig-tx-1');
    await assert.rejects(insert('apple', 'active', 'orig-tx-1'));
    await db.query(`delete from entitlements where user_id = $1 and source = 'apple' returning id`, [user.id]);
  });

  test('a paid entitlement must say when it ends; only a free pass may be open-ended', async () => {
    const pia = await legacyUser('pia.paid@example.com');
    const user = await userRow(pia.user.id);
    const insert = (source, status, expiresAt) =>
      db.query('insert into entitlements (user_id, source, status, external_id, expires_at) values ($1, $2, $3, $4, $5) returning id', [
        user.id, source, status, source === 'stripe' || source === 'apple' ? `${source}-pia` : null, expiresAt,
      ]);
    for (const source of ['stripe', 'apple']) {
      for (const status of ['trial', 'active', 'grace', 'expired', 'revoked']) {
        await assert.rejects(insert(source, status, null), /check constraint|not allowed/i, `${source} ${status} with no end date`);
      }
    }
    assert.equal(await hasAccess(db, user), false);
    const [paid] = await insert('stripe', 'active', daysFromNow(30));
    assert.equal(await hasAccess(db, user), true);
    await assert.rejects(db.query('update entitlements set expires_at = null where id = $1 returning id', [paid.id]), 'nor can the end date be taken away later');
    await db.query('delete from entitlements where id = $1 returning id', [paid.id]);

    await insert('admin', 'active', null);
    await insert('invite', 'active', null);
    assert.equal(await hasAccess(db, user), true);
  });

  test('the migration carries redeemed invite codes over, once', async () => {
    // an account as it stood before the migration: a grant, and no entitlement yet
    const old = await legacyUser('old.tester@example.com');
    await db.query(
      `insert into access_grants (user_id, email, code, granted_at) values ($1, $2, 'FP-OLD0-CODE', '2026-10-01T09:00:00Z') returning id`,
      [old.user.id, old.user.email]
    );
    assert.equal(await hasAccess(db, await userRow(old.user.id)), false);

    const sql = fs.readFileSync(path.join(SERVER_ROOT, 'migrations', '005_entitlements.sql'), 'utf8');
    const backfill = /insert into entitlements[\s\S]*?from access_grants[\s\S]*?;/i.exec(sql)?.[0];
    assert.ok(backfill, 'the migration copies access_grants into entitlements');
    const total = async () => (await db.query('select count(*)::int as n from entitlements', []))[0].n;
    const before = await total();
    await db.exec(backfill);
    assert.equal(await total(), before + 1, 'only the account that had no row gets one');
    await db.exec(backfill);
    assert.equal(await total(), before + 1, 'running it again adds nothing');

    const rows = await entitlementsOf(old.user.id);
    assert.deepEqual(rows.map((r) => [r.source, r.status, r.granted_by]), [['invite', 'active', 'FP-OLD0-CODE']]);
    assert.equal((await accessOf(db, await userRow(old.user.id))).reason, 'invite');
  });
});

describe('invite grants written by an older build are picked up at start-up', () => {
  // What the previous build does when someone redeems a code: a row in access_grants and nothing else.
  const oldBuildGrant = (who, code) =>
    db.query(
      `insert into access_grants (user_id, email, code, granted_at) values ($1, $2, $3, '2026-11-26T09:00:00Z') returning id`,
      [who.user.id, who.user.email, code]
    );
  const runs = (who) => call('POST', '/api/entities/Run/query', { token: who.token, body: {} });

  test('a grant with no entitlement gets one, once', async () => {
    const rolf = await legacyUser('rolf.rollback@example.com');
    await oldBuildGrant(rolf, 'FP-ROLL-BACK');
    assert.equal((await runs(rolf)).status, 403, 'locked out until the sync runs');

    assert.equal(await syncInviteEntitlements(db), 1);
    assert.equal((await runs(rolf)).status, 200);
    const rows = await entitlementsOf(rolf.user.id);
    assert.deepEqual(rows.map((r) => [r.source, r.status, r.granted_by]), [['invite', 'active', 'FP-ROLL-BACK']]);
    assert.equal(new Date(rows[0].created_date).toISOString(), '2026-11-26T09:00:00.000Z');

    assert.equal(await syncInviteEntitlements(db), 0, 'a second run finds nothing to do');
    assert.equal((await entitlementsOf(rolf.user.id)).length, 1);
  });

  test('it never touches a row that is already there: a revoked pass stays revoked', async () => {
    const rita = await invitedUser('rita.revoked@example.com');
    const [before] = await db.query(
      `update entitlements set status = 'revoked', note = 'asked to leave' where user_id = $1 and source = 'invite' returning *`,
      [rita.user.id]
    );
    assert.equal((await db.query('select id from access_grants where user_id = $1', [rita.user.id])).length, 1);

    assert.equal(await syncInviteEntitlements(db), 0);
    const [after] = await entitlementsOf(rita.user.id);
    assert.deepEqual(
      [after.id, after.status, after.granted_by, after.note, String(after.updated_date)],
      [before.id, 'revoked', before.granted_by, 'asked to leave', String(before.updated_date)]
    );
    assert.equal((await runs(rita)).status, 403);
  });

  test('a free pass from the owner or a subscription is not mistaken for the invite', async () => {
    const hugo = await legacyUser('hugo.handgrant@example.com');
    await db.tx((tx) => grantFree(tx, { userId: hugo.user.id, source: 'admin', grantedBy: 'owner@example.com' }));
    await oldBuildGrant(hugo, 'FP-HUGO-CODE');
    assert.equal(await syncInviteEntitlements(db), 1);
    assert.deepEqual((await entitlementsOf(hugo.user.id)).map((r) => r.source).sort(), ['admin', 'invite']);
  });
});

describe('the server refuses product calls without access', () => {
  const NO_ACCESS = { status: 403, data: { error: 'Enter an invite code to use VantraRun.' } };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
  const aRun = { distance_mi: 2, duration_sec: 1200, route_name: 'Before the lapse', started_at: '2026-11-21T12:00:00Z' };
  const upload = {
    kind: 'run', source: 'fitpro', external_id: 'fp-lapse-0001',
    distance_mi: 4, duration_sec: 2000, started_at: '2026-11-22T12:00:00Z',
  };
  const fn = (who, name, body = {}) => call('POST', `/api/functions/${name}`, { token: who.token, body });
  const setFree = (who, status) =>
    db.query(`update entitlements set status = $2 where user_id = $1 and source = 'invite' returning id`, [who.user.id, status]);
  let mia;
  let run;
  let zone;

  // Every product call, by name. `own` are the ids of records the person made while they had access.
  const productCalls = (who, own) => ({
    'entity list': () => call('GET', '/api/entities/Run', { token: who.token }),
    'entity query': () => call('POST', '/api/entities/Run/query', { token: who.token, body: {} }),
    'entity get': () => call('GET', `/api/entities/Run/${own.run}`, { token: who.token }),
    'entity create': () => call('POST', '/api/entities/Run', { token: who.token, body: { ...aRun, route_name: 'Sneaked in' } }),
    'entity update': () => call('PUT', `/api/entities/Run/${own.run}`, { token: who.token, body: { notes: 'changed' } }),
    'entity bulk create': () =>
      call('POST', '/api/entities/PaceZone/bulk', { token: who.token, body: [{ name: 'Sneaked zone', zone_number: 9, fast_sec: 300, slow_sec: 330 }] }),
    'entity bulk update': () => call('PUT', '/api/entities/PaceZone/bulk', { token: who.token, body: [{ id: own.zone, color: '#00ff00' }] }),
    'entity update-many': () =>
      call('POST', '/api/entities/PaceZone/update-many', { token: who.token, body: { q: { created_by_id: who.user.id }, data: { color: '#0000ff' } } }),
    'entity delete-many': () =>
      call('POST', '/api/entities/PaceZone/delete-many', { token: who.token, body: { q: { created_by_id: who.user.id } } }),
    'entity delete': () => call('DELETE', `/api/entities/Run/${own.run}`, { token: who.token }),
    upload: () => call('POST', '/api/uploads', { token: who.token, raw: png, headers: { 'Content-Type': 'image/png' } }),
    snapRoute: () => fn(who, 'snapRoute', { points: [{ lat: 40.7, lng: -74.0, offroad: true }, { lat: 40.71, lng: -74.0, offroad: true }] }),
    socialFeed: () => fn(who, 'socialFeed'),
    challengeBoard: () => fn(who, 'challengeBoard', { challenge_id: own.run }),
    routeDirections: () => fn(who, 'routeDirections', { route_id: own.run }),
    ingestActivity: () => fn(who, 'ingestActivity', { ...upload, external_id: 'fp-sneak-0001' }),
    adminInviteCodes: () => fn(who, 'adminInviteCodes', { action: 'list' }),
    adminClientErrors: () => fn(who, 'adminClientErrors', { action: 'list' }),
  });

  const snapshot = async (who) => ({
    runs: (await db.query('select id, route_name, notes from runs where created_by_id = $1 order by id', [who.user.id])).map((r) => ({ ...r })),
    zones: (await db.query('select id, name, color from pace_zones where created_by_id = $1 order by id', [who.user.id])).map((r) => ({ ...r })),
    posts: (await db.query('select count(*)::int as n from posts where created_by_id = $1', [who.user.id]))[0].n,
  });

  test('every product call is a 403 once access is gone, and nothing is read or changed', async () => {
    mia = await invitedUser('mia.lapsed@example.com');
    run = (await call('POST', '/api/entities/Run', { token: mia.token, body: aRun })).data;
    zone = (await call('POST', '/api/entities/PaceZone', { token: mia.token, body: { name: 'Easy', zone_number: 1, fast_sec: 540, slow_sec: 600 } })).data;
    assert.ok(run.id && zone.id);
    const filesBefore = fs.readdirSync(uploadDir).length;
    const before = await snapshot(mia);

    await setFree(mia, 'revoked');
    const calls = productCalls(mia, { run: run.id, zone: zone.id });
    assert.equal(Object.keys(calls).length, 18);
    for (const [name, send] of Object.entries(calls)) {
      assert.deepEqual(await send(), NO_ACCESS, name);
    }
    assert.deepEqual(await snapshot(mia), before, 'nothing was created, changed or deleted');
    assert.equal(fs.readdirSync(uploadDir).length, filesBefore, 'no file was stored');
  });

  test('function names cannot be probed without signing in', async () => {
    const UNAUTHORIZED = { status: 401, data: { error: 'Unauthorized' } };
    for (const name of ['socialFeed', 'inviteAccess', 'adminAccess', 'noSuchFunction', 'constructor', 'toString']) {
      assert.deepEqual(await call('POST', `/api/functions/${name}`, { body: {} }), UNAUTHORIZED, name);
      assert.deepEqual(await call('POST', `/api/functions/${name}`, { body: {}, token: 'x.y.z' }), UNAUTHORIZED, `${name}, bad token`);
    }
    // signed in, a name that does not exist is still a plain 404
    for (const name of ['noSuchFunction', 'constructor']) {
      assert.deepEqual(await call('POST', `/api/functions/${name}`, { token: bob.token, body: {} }), {
        status: 404,
        data: { error: `Unknown function "${name}".` },
      });
    }
  });

  test('no token is still a 401, never a 403', async () => {
    assert.equal((await call('GET', '/api/entities/Run')).status, 401);
    assert.equal((await call('POST', '/api/functions/socialFeed', { body: {} })).status, 401);
    assert.equal((await call('POST', '/api/uploads', { raw: png, headers: { 'Content-Type': 'image/png' } })).status, 401);
  });

  test('a person without access can still see their account, their access status and sign out', async () => {
    const me = await call('GET', '/api/auth/me', { token: mia.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, 'mia.lapsed@example.com');
    const consent = await call('PUT', '/api/auth/me', { token: mia.token, body: { consent_version: '2026-11' } });
    assert.equal(consent.status, 200);
    assert.equal((await call('POST', '/api/auth/logout', { token: mia.token, body: {} })).status, 200);
    assert.equal((await call('GET', '/api/auth/options')).status, 200);
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal((await call('GET', '/.well-known/apple-app-site-association')).status, 200);
    assert.equal((await call('GET', '/.well-known/assetlinks.json')).status, 200);

    const status = await fn(mia, 'inviteAccess', { action: 'status' });
    assert.deepEqual(status, {
      status: 200,
      data: { allowed: false, reason: null, source: null, plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false },
    });
  });

  test('redeeming an invite code opens every product call again', async () => {
    const wrong = await fn(mia, 'inviteAccess', { action: 'redeem', code: 'FP-NOPE-NOPE' });
    assert.deepEqual(wrong, { status: 200, data: { allowed: false, error: 'That code is not recognised.' } });
    const redeem = await fn(mia, 'inviteAccess', { action: 'redeem', code: await mintCode() });
    assert.deepEqual(redeem, { status: 200, data: { allowed: true } });
    const status = await fn(mia, 'inviteAccess', { action: 'status' });
    assert.deepEqual(status.data, {
      allowed: true, reason: 'invite', source: 'invite', plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false,
    });

    const calls = productCalls(mia, { run: run.id, zone: zone.id });
    const refusedAnyway = { challengeBoard: 404, routeDirections: 404, adminInviteCodes: 403, adminClientErrors: 403 };
    for (const [name, send] of Object.entries(calls)) {
      const res = await send();
      if (refusedAnyway[name]) {
        assert.equal(res.status, refusedAnyway[name], name);
        assert.notEqual(res.data.error, NO_ACCESS.data.error, `${name} is refused for its own reason now`);
      } else {
        assert.ok(res.status === 200 || res.status === 201, `${name}: ${res.status} ${JSON.stringify(res.data)}`);
      }
    }
  });

  test('an entitlement that ended four days ago is refused; two days ago is inside the allowance', async () => {
    const quin = await legacyUser('quin.expired@example.com');
    await db.query(
      `insert into entitlements (user_id, source, status, plan, expires_at, external_id)
       values ($1, 'stripe', 'active', 'monthly', $2, 'sub_quin') returning id`,
      [quin.user.id, daysFromNow(-4)]
    );
    assert.deepEqual(await call('POST', '/api/entities/Run/query', { token: quin.token, body: {} }), NO_ACCESS);
    assert.deepEqual(await fn(quin, 'socialFeed'), NO_ACCESS);
    assert.equal((await fn(quin, 'inviteAccess', { action: 'status' })).data.allowed, false);

    await db.query(`update entitlements set expires_at = $2 where user_id = $1 returning id`, [quin.user.id, daysFromNow(-2)]);
    const inside = await call('POST', '/api/entities/Run/query', { token: quin.token, body: {} });
    assert.equal(inside.status, 200);
    const status = (await fn(quin, 'inviteAccess', { action: 'status' })).data;
    assert.deepEqual(
      [status.allowed, status.reason, status.source, status.plan, status.cancel_at_period_end],
      [true, 'subscription', 'stripe', 'monthly', false]
    );
    assert.equal(Math.round((Date.now() - new Date(status.expires_at).getTime()) / 86400000), 2);
  });

  test('a run the phone retries after access lapses gets a clear 403, and saves once access is back', async () => {
    const ravi = await invitedUser('ravi.retry@example.com');
    const first = await fn(ravi, 'ingestActivity', upload);
    assert.equal(first.data.action, 'created');

    await setFree(ravi, 'revoked');
    const queued = { ...upload, external_id: 'fp-lapse-0002', started_at: '2026-11-23T12:00:00Z' };
    for (const body of [queued, { ...upload, distance_mi: 9 }]) {
      const refused = await fn(ravi, 'ingestActivity', body);
      // 403 with a readable `error` is what makes the phone keep the run and try again (native/src/run/queue.ts)
      assert.equal(refused.status, 403);
      assert.equal(refused.data.error, 'Enter an invite code to use VantraRun.');
    }
    const stored = await db.query('select external_id, distance_mi from runs where created_by_id = $1', [ravi.user.id]);
    assert.deepEqual(stored.map((r) => [r.external_id, Number(r.distance_mi)]), [['fp-lapse-0001', 4]], 'nothing stored or changed while refused');

    await setFree(ravi, 'active');
    const retried = await fn(ravi, 'ingestActivity', queued);
    assert.equal(retried.status, 200);
    assert.equal(retried.data.action, 'created', 'the queued run is saved by the retry');
  });

  test('an admin with no entitlement row passes everywhere by role', async () => {
    const login = await call('POST', '/api/auth/login', { body: { email: 'role-only@example.com', password: 'a-long-enough-password' } });
    const boss = { token: login.data.access_token, user: login.data.user };
    assert.equal((await entitlementsOf(boss.user.id)).length, 0);
    assert.equal((await call('POST', '/api/entities/Run/query', { token: boss.token, body: {} })).status, 200);
    assert.equal((await call('POST', '/api/entities/Run', { token: boss.token, body: aRun })).status, 201);
    assert.equal((await call('POST', '/api/uploads', { token: boss.token, raw: png, headers: { 'Content-Type': 'image/png' } })).status, 201);
    assert.equal((await fn(boss, 'socialFeed')).status, 200);
    assert.equal((await fn(boss, 'adminInviteCodes', { action: 'list' })).status, 200);
    assert.equal((await fn(boss, 'ingestActivity', { ...upload, external_id: 'fp-boss-0001' })).status, 200);
    assert.deepEqual((await fn(boss, 'inviteAccess', { action: 'status' })).data, {
      allowed: true, admin: true, reason: 'admin', source: null, plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false,
    });
  });

  test('a person without access can change or reset their password and delete their account', async () => {
    const zed = await legacyUser('zed.leaving@example.com');
    assert.deepEqual(await call('POST', '/api/entities/Run/query', { token: zed.token, body: {} }), NO_ACCESS);

    const changed = await call('POST', '/api/auth/change-password', {
      token: zed.token,
      body: { currentPassword: 'correct-horse-1', newPassword: 'another-horse-2' },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));

    const ask = await call('POST', '/api/auth/reset-password-request', { body: { email: 'zed.leaving@example.com' } });
    const reset = await call('POST', '/api/auth/reset-password', { body: { resetToken: ask.data.dev_token, newPassword: 'third-horse-3' } });
    assert.equal(reset.status, 200);
    const login = await call('POST', '/api/auth/login', { body: { email: 'zed.leaving@example.com', password: 'third-horse-3' } });
    assert.equal(login.status, 200);

    const report = await call('POST', '/api/client-errors', { token: login.data.access_token, body: { message: 'the paywall crashed' } });
    assert.equal(report.status, 201, 'a crash on the way in can still be reported');

    const gone = await call('DELETE', '/api/auth/me', { token: login.data.access_token, body: { password: 'third-horse-3' } });
    assert.deepEqual(gone, { status: 200, data: { ok: true, deleted: true } });
    assert.equal((await db.query('select id from users where id = $1', [zed.user.id])).length, 0);
  });
});

describe('sign-up needs a code', () => {
  test('no code, unknown code and used code are refused', async () => {
    const body = { email: 'erin2@example.com', password: 'longenough1' };
    assert.equal((await call('POST', '/api/auth/register', { body })).data.error, 'Enter your invite code.');
    assert.equal(
      (await call('POST', '/api/auth/register', { body: { ...body, invite_code: 'FP-NOPE-NOPE' } })).data.error,
      'That code is not recognised.'
    );
    const used = await mintCode();
    await signUpWith('frank@example.com', used);
    const res = await call('POST', '/api/auth/register', { body: { ...body, invite_code: used } });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'That code has already been used.');
  });

  test('a valid code, typed loosely, opens the app after verifying', async () => {
    const code = await mintCode();
    const gina = await signUpWith('gina@example.com', `  ${code.toLowerCase()} `);
    const status = await call('POST', '/api/functions/inviteAccess', { token: gina.token, body: { action: 'status' } });
    assert.deepEqual(status.data, {
      allowed: true, reason: 'invite', source: 'invite', plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: false,
    });
    const [row] = await db.query('select status, used_by_email from invite_codes where code = $1', [code]);
    assert.deepEqual({ ...row }, { status: 'used', used_by_email: 'gina@example.com' });
  });

  test('registering without verifying leaves the code available', async () => {
    const code = await mintCode();
    await call('POST', '/api/auth/register', { body: { email: 'hal@example.com', password: 'longenough1', invite_code: code } });
    const [row] = await db.query('select status from invite_codes where code = $1', [code]);
    assert.equal(row.status, 'available');
  });

  test('two sign-ups holding one code: the first to verify wins', async () => {
    const code = await mintCode();
    const a = await call('POST', '/api/auth/register', { body: { email: 'ivy@example.com', password: 'longenough1', invite_code: code } });
    const b = await call('POST', '/api/auth/register', { body: { email: 'jo@example.com', password: 'longenough1', invite_code: code } });
    assert.equal((await call('POST', '/api/auth/verify-otp', { body: { email: 'ivy@example.com', otp_code: a.data.dev_code } })).status, 200);
    const late = await call('POST', '/api/auth/verify-otp', { body: { email: 'jo@example.com', otp_code: b.data.dev_code } });
    assert.equal(late.status, 409);
    const login = await call('POST', '/api/auth/login', { body: { email: 'jo@example.com', password: 'longenough1' } });
    assert.equal(login.status, 403);
    assert.equal(login.data.needs_verification, true);
  });

  test('a password reset does not verify an account that still owes its code', async () => {
    const code = await mintCode();
    const email = 'pat@example.com';
    await call('POST', '/api/auth/register', { body: { email, password: 'longenough1', invite_code: code } });
    const ask = await call('POST', '/api/auth/reset-password-request', { body: { email } });
    const reset = await call('POST', '/api/auth/reset-password', { body: { reset_token: ask.data.dev_token, new_password: 'another-pass-1' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.data));

    const login = await call('POST', '/api/auth/login', { body: { email, password: 'another-pass-1' } });
    assert.equal(login.status, 403, 'still has to verify, which is where the code is claimed');
    assert.equal(login.data.needs_verification, true);
    const [row] = await db.query('select status from invite_codes where code = $1', [code]);
    assert.equal(row.status, 'available');

    const ver = await call('POST', '/api/auth/verify-otp', { body: { email, otp_code: login.data.dev_code } });
    assert.equal(ver.status, 200);
    const [after] = await db.query('select status, used_by_email from invite_codes where code = $1', [code]);
    assert.deepEqual({ ...after }, { status: 'used', used_by_email: email });
  });

  test('an older account with no code can still sign in and redeem one', async () => {
    const kim = await legacyUser('kim@example.com');
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'kim@example.com', password: 'correct-horse-1' } })).status, 200);
    const res = await call('POST', '/api/functions/inviteAccess', { token: kim.token, body: { action: 'redeem', code: await mintCode() } });
    assert.deepEqual(res.data, { allowed: true });
  });
});

describe('sign-up when subscriptions are on', () => {
  // The refusal names what is on offer: a subscription only where one can be bought.
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };
  const NO_ACCESS_OFF = { status: 403, data: { error: 'Enter an invite code to use VantraRun.' } };
  let open; // the API with SUBSCRIPTIONS=on
  const on = (method, url, options = {}) => call(method, url, { ...options, origin: open.origin });
  const register = (body) => on('POST', '/api/auth/register', { body });
  // These tests already send the password with the emailed code, as the website and the phone do.
  const verify = (email, code, password = 'longenough1') =>
    on('POST', '/api/auth/verify-otp', { body: { email, otp_code: code, ...(password === null ? {} : { password }) } });
  const WRONG_CODE = { status: 400, data: { error: 'That code is wrong or has expired.' } };
  // Sign-ups are limited per address; these tests come from their own (see TRUST_PROXY in src/lib/http.js).
  const from = (address) => ({ 'X-Forwarded-For': address });
  const withProxy = async (work) => {
    process.env.TRUST_PROXY = 'true';
    try {
      await work();
    } finally {
      delete process.env.TRUST_PROXY;
    }
  };

  before(async () => {
    open = await startApp({ subscriptions: true });
  });
  after(async () => {
    await open?.close();
  });

  test('the switch is off unless SUBSCRIPTIONS is exactly "on"', () => {
    assert.equal(loadConfig({ NODE_ENV: 'test' }).subscriptions, false);
    assert.equal(loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'off' }).subscriptions, false);
    assert.equal(loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: '' }).subscriptions, false);
    assert.equal(loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'true' }).subscriptions, false);
    assert.equal(loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'on' }).subscriptions, true);
    assert.equal(testConfig.subscriptions, false, 'the suite itself runs with it off');
  });

  test('the sign-in options say whether subscriptions are on', async () => {
    const off = await call('GET', '/api/auth/options');
    assert.deepEqual(off, { status: 200, data: { name: 'VantraRun', auth_config: { mfa_policy: 'off', providers: [] }, subscriptions: false } });
    const yes = await on('GET', '/api/auth/options');
    assert.deepEqual(yes, { status: 200, data: { name: 'VantraRun', auth_config: { mfa_policy: 'off', providers: [] }, subscriptions: true } });
  });

  test('with the switch off, sign-up without a code is refused exactly as before', async () => {
    const body = { email: 'nocode.off@example.com', password: 'longenough1' };
    // (a sign-up with the field left out altogether is in 'sign-up needs a code' above)
    assert.deepEqual(await call('POST', '/api/auth/register', { body: { ...body, invite_code: '   ' } }), { status: 400, data: { error: 'Enter your invite code.' } });
    assert.equal((await db.query(`select id from users where email = 'nocode.off@example.com'`, [])).length, 0);
  });

  test('sign-up with no code makes an account that signs in and has no access', async () => {
    const email = 'nocode.on@example.com';
    const reg = await register({ email, password: 'longenough1', full_name: 'No Code' });
    assert.equal(reg.status, 200, JSON.stringify(reg.data));
    assert.equal(reg.data.ok, true);
    const [held] = await db.query('select pending_invite_code, email_verified_at from users where email = $1', [email]);
    assert.equal(held.pending_invite_code ?? null, null);
    assert.equal(held.email_verified_at ?? null, null);

    const ver = await verify(email, reg.data.dev_code);
    assert.equal(ver.status, 200, JSON.stringify(ver.data));
    assert.ok(ver.data.access_token);
    assert.equal(ver.data.user.email, email);
    const token = ver.data.access_token;
    assert.equal((await on('GET', '/api/auth/me', { token })).status, 200);
    assert.equal((await entitlementsOf(ver.data.user.id)).length, 0);
    assert.equal((await db.query('select id from access_grants where user_id = $1', [ver.data.user.id])).length, 0);

    const status = await on('POST', '/api/functions/inviteAccess', { token, body: { action: 'status' } });
    assert.deepEqual(status.data, {
      allowed: false, reason: null, source: null, plan: null, expires_at: null, cancel_at_period_end: false, subscriptions: true,
    });
    assert.deepEqual(await on('POST', '/api/entities/Run/query', { token, body: {} }), NO_ACCESS);
    assert.deepEqual(await on('POST', '/api/entities/Run', { token, body: { distance_mi: 1, duration_sec: 600 } }), NO_ACCESS);
    assert.deepEqual(await on('POST', '/api/functions/socialFeed', { token, body: {} }), NO_ACCESS);
    // the same account is just as closed on an instance with the switch off
    assert.deepEqual(await call('POST', '/api/entities/Run/query', { token, body: {} }), NO_ACCESS_OFF);
    assert.deepEqual(await call('POST', '/api/uploads', { token, raw: 'x', headers: { 'Content-Type': 'image/png' } }), NO_ACCESS_OFF);
    assert.deepEqual(await on('POST', '/api/uploads', { token, raw: 'x', headers: { 'Content-Type': 'image/png' } }), NO_ACCESS);
    assert.deepEqual(await call('POST', '/api/functions/ingestActivity', { token, body: {} }), NO_ACCESS_OFF);
    assert.deepEqual(await on('POST', '/api/functions/ingestActivity', { token, body: {} }), NO_ACCESS);

    const redeem = await on('POST', '/api/functions/inviteAccess', { token, body: { action: 'redeem', code: await mintCode() } });
    assert.deepEqual(redeem.data, { allowed: true });
    assert.equal((await on('POST', '/api/entities/Run/query', { token, body: {} })).status, 200);
    assert.equal((await on('POST', '/api/entities/Run', { token, body: { distance_mi: 1, duration_sec: 600 } })).status, 201);
    const after = await on('POST', '/api/functions/inviteAccess', { token, body: { action: 'status' } });
    assert.deepEqual([after.data.allowed, after.data.reason, after.data.subscriptions], [true, 'invite', true]);
  });

  test('a code given at sign-up is still checked, held and claimed as today', async () => {
    const body = { email: 'withcode.on@example.com', password: 'longenough1' };
    assert.deepEqual(await register({ ...body, invite_code: 'FP-NOPE-NOPE' }), { status: 400, data: { error: 'That code is not recognised.' } });
    const used = await mintCode();
    await invitedUser('first.on@example.com', used);
    assert.deepEqual(await register({ ...body, invite_code: used }), { status: 400, data: { error: 'That code has already been used.' } });
    assert.equal((await db.query('select id from users where email = $1', [body.email])).length, 0, 'a refused code makes no account');

    const code = await mintCode();
    const reg = await register({ ...body, invite_code: ` ${code.toLowerCase()} ` });
    assert.equal(reg.status, 200);
    const [held] = await db.query('select pending_invite_code from users where email = $1', [body.email]);
    assert.equal(held.pending_invite_code, code);
    assert.equal((await db.query('select status from invite_codes where code = $1', [code]))[0].status, 'available', 'not claimed before verifying');
    const ver = await verify(body.email, reg.data.dev_code);
    assert.equal(ver.status, 200);
    assert.equal((await db.query('select status from invite_codes where code = $1', [code]))[0].status, 'used');
    assert.equal((await on('POST', '/api/entities/Run/query', { token: ver.data.access_token, body: {} })).status, 200);
  });

  test('someone who re-registers your email cannot get you verified on their password', () => withProxy(async () => {
    const email = 'vic.tim@example.com';
    const signUp = (password, address) => on('POST', '/api/auth/register', { body: { email, password }, headers: from(address) });
    const login = (password) => on('POST', '/api/auth/login', { body: { email, password } });
    const verified = async () => Boolean((await db.query('select email_verified_at from users where email = $1', [email]))[0].email_verified_at);

    assert.equal((await signUp('victim-pass-V1', '198.51.100.1')).status, 200);
    // Before the victim types their code, someone else signs up with the same address
    // and their own password. The new code goes to the victim's inbox, not to them.
    const hijack = await signUp('attacker-pass-A1', '198.51.100.2');
    assert.equal(hijack.status, 200);

    // The victim types the code that arrived, with the password they chose: refused,
    // because the account now holds someone else's password.
    assert.deepEqual(await verify(email, hijack.data.dev_code, 'victim-pass-V1'), WRONG_CODE);
    assert.equal(await verified(), false);

    // The other person never sees the code: they cannot guess it in, and signing in only
    // sends the victim another code.
    const guess = hijack.data.dev_code === '000000' ? '111111' : '000000';
    assert.deepEqual(await verify(email, guess, 'attacker-pass-A1'), WRONG_CODE);
    const theirLogin = await login('attacker-pass-A1');
    assert.equal(theirLogin.status, 403);
    assert.equal(theirLogin.data.access_token, undefined);
    assert.equal(await verified(), false);

    // The victim starts again with their own password and gets in.
    const again = await signUp('victim-pass-V1', '198.51.100.1');
    assert.equal(again.status, 200);
    const code = again.data.dev_code;
    assert.deepEqual(await verify(email, code, null), WRONG_CODE, 'with subscriptions on the password is required');
    assert.deepEqual(await verify(email, code, ''), WRONG_CODE);
    assert.deepEqual(await verify(email, code, 'attacker-pass-A1'), WRONG_CODE);
    assert.equal(await verified(), false);
    // none of those refusals used the code up
    const ok = await verify(email, code, 'victim-pass-V1');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.ok(ok.data.access_token);

    assert.equal((await login('attacker-pass-A1')).status, 401);
    assert.equal((await login('victim-pass-V1')).status, 200);
  }));

  test('with the switch off the password is optional at verification, and a wrong one does not burn the code', () => withProxy(async () => {
    const email = 'old.phone@example.com';
    const verifyOff = (body) => call('POST', '/api/auth/verify-otp', { body: { email, ...body } });
    const reg = await call('POST', '/api/auth/register', {
      body: { email, password: 'longenough1', invite_code: await mintCode() },
      headers: from('198.51.100.3'),
    });
    assert.equal(reg.status, 200, JSON.stringify(reg.data));
    assert.deepEqual(await verifyOff({ otp_code: reg.data.dev_code, password: 'not-the-password' }), WRONG_CODE);
    assert.deepEqual(await verifyOff({ otp_code: reg.data.dev_code, password: 'not-the-password' }), WRONG_CODE);
    // an installed phone build sends no password: still accepted, with the same code
    const ok = await verifyOff({ otp_code: reg.data.dev_code });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.ok(ok.data.access_token);
  }));

  test('with the switch off, the right password with the code is accepted too', () => withProxy(async () => {
    const email = 'new.phone@example.com';
    const reg = await call('POST', '/api/auth/register', {
      body: { email, password: 'longenough1', invite_code: await mintCode() },
      headers: from('198.51.100.3'),
    });
    const ok = await call('POST', '/api/auth/verify-otp', { body: { email, otp_code: reg.data.dev_code, password: 'longenough1' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    // an address with no account gets the same answer as a wrong code
    const nobody = await call('POST', '/api/auth/verify-otp', { body: { email: 'nobody.at.all@example.com', otp_code: '123456', password: 'longenough1' } });
    assert.deepEqual(nobody, WRONG_CODE);
  }));

  test('starting again without the code lets go of the code that was held', async () => {
    const email = 'changed.mind@example.com';
    const code = await mintCode();
    await register({ email, password: 'longenough1', invite_code: code });
    const again = await register({ email, password: 'longenough1', invite_code: '  ' });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    const ver = await verify(email, again.data.dev_code);
    assert.equal(ver.status, 200);
    assert.equal((await db.query('select status from invite_codes where code = $1', [code]))[0].status, 'available');
    assert.deepEqual(await on('POST', '/api/entities/Run/query', { token: ver.data.access_token, body: {} }), NO_ACCESS);
  });
});

describe('the owner sees and controls access', () => {
  const NO_ACCESS = { status: 403, data: { error: 'Enter an invite code to use VantraRun.' } };
  const access = (who, body) => call('POST', '/api/functions/adminAccess', { token: who.token, body });
  const runs = (who) => call('POST', '/api/entities/Run/query', { token: who.token, body: {} });
  const find = async (email) => (await access(admin, { action: 'list', search: email })).data.people.find((p) => p.email === email);
  let invited;
  let legacy;
  let inviteCode;

  before(async () => {
    inviteCode = await mintCode();
    invited = await invitedUser('ines.invited@example.com', inviteCode);
    legacy = await legacyUser('lars.legacy@example.com');
  });

  test('only admins may use it', async () => {
    for (const body of [{ action: 'list' }, { action: 'grant', email: 'lars.legacy@example.com' }, { action: 'revoke', entitlement_id: 'x' }, {}]) {
      assert.deepEqual(await access(invited, body), { status: 403, data: { error: 'Admins only' } });
      assert.deepEqual(await access(legacy, body), NO_ACCESS);
    }
    assert.equal((await call('POST', '/api/functions/adminAccess', { body: { action: 'list' } })).status, 401);
    assert.equal(await hasAccess(db, await userRow(legacy.user.id)), false, 'the refused grant gave nothing');
  });

  test('the list shows each person, whether they have access and why', async () => {
    const list = await access(admin, { action: 'list' });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    const people = list.data.people;
    assert.ok(people.length >= 10 && people.length <= 200);
    const created = (await db.query('select id from users order by created_date desc, id desc limit 200', [])).map((u) => u.id);
    assert.deepEqual(people.map((p) => p.user_id), created, 'newest accounts first');
    assert.ok(!JSON.stringify(people).includes('password_hash'));
    assert.ok(!JSON.stringify(people).includes('token_version'));

    const ines = people.find((p) => p.email === 'ines.invited@example.com');
    assert.deepEqual(
      { ...ines, entitlements: ines.entitlements.map(({ id, created_date, ...rest }) => rest) },
      {
        user_id: invited.user.id, email: 'ines.invited@example.com', full_name: 'ines.invited', role: 'user',
        allowed: true, reason: 'invite', source: 'invite', plan: null, expires_at: null, cancel_at_period_end: false,
        entitlements: [{ source: 'invite', status: 'active', plan: null, expires_at: null, granted_by: inviteCode, note: null }],
      }
    );
    assert.match(ines.entitlements[0].id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(new Date(ines.entitlements[0].created_date).getTime()));

    const lars = people.find((p) => p.email === 'lars.legacy@example.com');
    assert.deepEqual(
      [lars.allowed, lars.reason, lars.source, lars.plan, lars.expires_at, lars.entitlements],
      [false, null, null, null, null, []]
    );
    const boss = people.find((p) => p.email === 'admin@example.com');
    assert.deepEqual([boss.role, boss.allowed, boss.reason], ['admin', true, 'admin']);
  });

  test('search matches part of the email and nothing else', async () => {
    const some = await access(admin, { action: 'list', search: '  LEGACY@exam ' });
    assert.deepEqual(some.data.people.map((p) => p.email), ['lars.legacy@example.com']);
    assert.deepEqual((await access(admin, { action: 'list', search: 'nobody-by-this-name' })).data.people, []);
    // % and _ are ordinary characters in a search, not wildcards
    assert.deepEqual((await access(admin, { action: 'list', search: '%' })).data.people, []);
    assert.deepEqual((await access(admin, { action: 'list', search: 'lars_legacy' })).data.people, []);
  });

  test('a free grant by email opens a closed account, and granting twice is harmless', async () => {
    assert.deepEqual(await runs(legacy), NO_ACCESS);
    const grant = await access(admin, { action: 'grant', email: ' Lars.Legacy@Example.com ', note: 'club coach' });
    assert.equal(grant.status, 200, JSON.stringify(grant.data));
    assert.equal(grant.data.ok, true);
    const { id, created_date: createdDate, ...rest } = grant.data.entitlement;
    assert.deepEqual(rest, { source: 'admin', status: 'active', plan: null, expires_at: null, granted_by: 'admin@example.com', note: 'club coach' });
    assert.ok(id && createdDate);
    assert.equal((await runs(legacy)).status, 200);

    const again = await access(admin, { action: 'grant', email: 'lars.legacy@example.com' });
    assert.equal(again.status, 200);
    assert.equal(again.data.entitlement.id, id);
    assert.equal((await entitlementsOf(legacy.user.id)).length, 1);

    const lars = await find('lars.legacy@example.com');
    assert.deepEqual([lars.allowed, lars.reason, lars.source, lars.entitlements.length], [true, 'granted', 'admin', 1]);
  });

  test('an email with no account is a 404 that says what to do instead', async () => {
    assert.deepEqual(await access(admin, { action: 'grant', email: 'not.here.yet@example.com' }), {
      status: 404,
      data: { error: 'No account with that email yet. Send them an invite code instead.' },
    });
    assert.equal((await access(admin, { action: 'grant' })).status, 404);
    assert.equal((await db.query(`select id from users where email = 'not.here.yet@example.com'`, [])).length, 0);
  });

  test('removing the free pass closes the account again; granting brings it back', async () => {
    const [pass] = await entitlementsOf(legacy.user.id);
    assert.deepEqual(await access(admin, { action: 'revoke', entitlement_id: pass.id }), { status: 200, data: { ok: true } });
    assert.deepEqual(await runs(legacy), NO_ACCESS);
    const lars = await find('lars.legacy@example.com');
    assert.deepEqual([lars.allowed, lars.reason, lars.entitlements.map((e) => e.status)], [false, null, ['revoked']]);
    assert.deepEqual(await access(admin, { action: 'revoke', entitlement_id: pass.id }), { status: 200, data: { ok: true } }, 'twice is harmless');

    const back = await access(admin, { action: 'grant', email: 'lars.legacy@example.com', note: 'second time' });
    assert.deepEqual([back.data.entitlement.id, back.data.entitlement.status, back.data.entitlement.note], [pass.id, 'active', 'second time']);
    assert.equal((await runs(legacy)).status, 200);
  });

  test('an invite-code pass can be removed too, and a new code brings the person back', async () => {
    const [pass] = await entitlementsOf(invited.user.id);
    assert.equal(pass.source, 'invite');
    assert.equal((await access(admin, { action: 'revoke', entitlement_id: pass.id })).status, 200);
    assert.deepEqual(await runs(invited), NO_ACCESS);
    const code = await mintCode();
    const redeem = await call('POST', '/api/functions/inviteAccess', { token: invited.token, body: { action: 'redeem', code } });
    assert.deepEqual(redeem.data, { allowed: true });
    assert.equal((await runs(invited)).status, 200);
    assert.deepEqual((await entitlementsOf(invited.user.id)).map((r) => [r.source, r.status, r.granted_by]), [['invite', 'active', code]]);
  });

  test('removing a free pass leaves a paid subscription on the same account alone', async () => {
    const [paid] = await db.query(
      `insert into entitlements (user_id, source, status, plan, expires_at, external_id)
       values ($1, 'stripe', 'active', 'annual', $2, 'sub_ines') returning *`,
      [invited.user.id, daysFromNow(200)]
    );
    const [free] = (await entitlementsOf(invited.user.id)).filter((r) => r.source === 'invite');
    assert.equal((await find('ines.invited@example.com')).reason, 'subscription');

    assert.equal((await access(admin, { action: 'revoke', entitlement_id: free.id })).status, 200);
    assert.equal((await runs(invited)).status, 200, 'the paid entitlement still opens the product');
    const ines = await find('ines.invited@example.com');
    assert.deepEqual([ines.allowed, ines.reason, ines.source, ines.plan], [true, 'subscription', 'stripe', 'annual']);
    assert.deepEqual(
      ines.entitlements.map((e) => [e.source, e.status]).sort(),
      [['invite', 'revoked'], ['stripe', 'active']]
    );

    // a paid one cannot be removed from here
    assert.deepEqual(await access(admin, { action: 'revoke', entitlement_id: paid.id }), {
      status: 400,
      data: { error: 'Paid subscriptions are cancelled with the payment provider.' },
    });
    assert.equal((await db.query('select status from entitlements where id = $1', [paid.id]))[0].status, 'active');
  });

  test('revoke needs a real entitlement', async () => {
    assert.equal((await access(admin, { action: 'revoke' })).status, 400);
    assert.equal((await access(admin, { action: 'revoke', entitlement_id: 'nope' })).status, 404);
    assert.equal((await access(admin, { action: 'revoke', entitlement_id: '00000000-0000-4000-8000-000000000000' })).status, 404);
    assert.equal((await access(admin, { action: 'dance' })).status, 400);
  });
});

describe('ingestActivity (native contract)', () => {
  const run = {
    kind: 'run',
    external_id: 'HK-UUID-1',
    source: 'apple',
    distance_mi: '5.123',
    duration_sec: 2490,
    started_at: '2026-11-18T11:00:00Z',
    points: [{ lat: 40.1, lng: -74.2 }, { lat: 999, lng: 0 }, { lat: 'x' }],
    splits: [{ mile: 1, pace_sec: 480 }, { mile: 0, pace_sec: 400 }],
    avg_hr: 151.6,
  };

  test('first send creates, second send updates', async () => {
    const first = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: run });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.action, 'created');
    assert.equal(first.data.distance_mi, 5.12);
    assert.equal(first.data.avg_pace_sec, 486);
    assert.equal(first.data.points, 1);

    const second = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: { ...run, duration_sec: 2400, avg_hr: undefined } });
    assert.equal(second.data.action, 'updated');
    assert.equal(second.data.run_id, first.data.run_id);

    const stored = await call('GET', `/api/entities/Run/${first.data.run_id}`, { token: alice.token });
    assert.equal(stored.data.duration_sec, 2400);
    assert.equal(stored.data.avg_hr, 152, 'fields not sent are left alone on update');
    assert.deepEqual(stored.data.splits, [{ mile: 1, pace_sec: 480 }]);
  });

  test('same external id from another user is a separate record', async () => {
    const res = await call('POST', '/api/functions/ingestActivity', { token: bob.token, body: run });
    assert.equal(res.data.action, 'created');
  });

  test('workout: volume computed, bad sets dropped', async () => {
    const res = await call('POST', '/api/functions/ingestActivity', {
      token: alice.token,
      body: {
        kind: 'workout',
        external_id: 'HK-W-1',
        source: 'apple',
        name: 'Push A',
        exercises: [
          { name: 'Bench press', muscle: 'chest', sets: [{ reps: 8, weight: 185 }, { reps: 8, weight: 185 }, { reps: 5 }] },
          { name: 'Push-up', sets: [{ reps: 20, weight: 0 }] },
          { name: 'Nothing valid', sets: [{ reps: -1, weight: 10 }] },
        ],
        set_count: 999,
        total_volume: 1,
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.action, 'created');
    assert.equal(res.data.set_count, 3);
    assert.equal(res.data.total_volume, 2960);
    assert.equal(res.data.exercises, 2);
  });

  test('contract errors', async () => {
    const send = (body) => call('POST', '/api/functions/ingestActivity', { token: alice.token, body });
    assert.equal((await send({ ...run, external_id: '' })).status, 400);
    assert.equal((await send({ ...run, distance_mi: 0 })).status, 400);
    assert.equal((await send({ ...run, duration_sec: 300000 })).status, 400);
    assert.equal((await send({ ...run, started_at: 'yesterday-ish' })).status, 400);
    assert.equal((await send({ kind: 'swim', external_id: 'x' })).status, 400);
    assert.equal((await send({ kind: 'workout', external_id: 'x', exercises: [{ name: 'Curl', sets: [{ reps: 10 }] }] })).status, 400);
    const unauth = await call('POST', '/api/functions/ingestActivity', { body: run });
    assert.deepEqual(unauth, { status: 401, data: { error: 'Unauthorized' } });
  });

  test('no accepted invite code -> 403, nothing stored', async () => {
    const lee = await legacyUser('lee@example.com');
    const res = await call('POST', '/api/functions/ingestActivity', { token: lee.token, body: run });
    assert.deepEqual(res, { status: 403, data: { error: 'Enter an invite code to use VantraRun.' } });
    assert.equal((await db.query('select id from runs where created_by_id = $1', [lee.user.id])).length, 0);
    // and they cannot read runs either: the whole product is closed, not only the upload
    const mine = await call('POST', '/api/entities/Run/query', { token: lee.token, body: {} });
    assert.deepEqual(mine, { status: 403, data: { error: 'Enter an invite code to use VantraRun.' } });
  });

  test('admins upload without a code', async () => {
    await db.query('delete from access_grants where user_id = $1 returning id', [admin.user.id]);
    await db.query('delete from entitlements where user_id = $1 returning id', [admin.user.id]);
    const res = await call('POST', '/api/functions/ingestActivity', { token: admin.token, body: { ...run, external_id: 'HK-ADMIN-1' } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });
});

describe('runs recorded by FitPro', () => {
  const liveRun = {
    kind: 'run', source: 'fitpro', external_id: 'fp-run-0001',
    distance_mi: 3.1, duration_sec: 1600, started_at: '2026-11-20T12:00:00Z',
    target_zone_name: 'Zone 2', target_fast_sec: 495, target_slow_sec: 540,
    in_zone_pct: 71.6, min_hr: 98.4, avg_hr: 141, max_hr: 163,
    hr_target_min: 125, hr_target_max: 145, hr_in_zone_pct: 64,
  };
  const ingest = (who, body) => call('POST', '/api/functions/ingestActivity', { token: who.token, body });
  const stored = async (who, id) => (await call('GET', `/api/entities/Run/${id}`, { token: who.token })).data;

  test('a FitPro run stores its zone and heart-rate stats', async () => {
    const route = await call('POST', '/api/entities/Route', { token: alice.token, body: { name: 'River loop' } });
    const res = await ingest(alice, { ...liveRun, route_id: route.data.id });
    assert.equal(res.data.action, 'created', JSON.stringify(res.data));
    const run = await stored(alice, res.data.run_id);
    assert.equal(run.route_id, route.data.id);
    assert.equal(run.route_name, 'Free run');
    assert.deepEqual(
      [run.target_zone_name, run.target_fast_sec, run.target_slow_sec, run.in_zone_pct],
      ['Zone 2', 495, 540, 72]
    );
    assert.deepEqual(
      [run.min_hr, run.max_hr, run.hr_target_min, run.hr_target_max, run.hr_in_zone_pct],
      [98, 163, 125, 145, 64]
    );
  });

  test('a retried FitPro upload updates the same run', async () => {
    const again = await ingest(alice, liveRun);
    assert.equal(again.data.action, 'updated');
  });

  test('bad optional values are dropped, never rejected', async () => {
    const bobRoute = await call('POST', '/api/entities/Route', { token: bob.token, body: { name: 'Not yours' } });
    const res = await ingest(alice, {
      ...liveRun, external_id: 'fp-run-0002', started_at: '2026-11-21T12:00:00Z',
      route_id: bobRoute.data.id, target_fast_sec: 600, target_slow_sec: 500,
      in_zone_pct: 140, min_hr: 5, hr_target_max: 999,
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const run = await stored(alice, res.data.run_id);
    for (const f of ['route_id', 'target_fast_sec', 'target_slow_sec', 'in_zone_pct', 'min_hr', 'hr_target_max']) {
      assert.equal(run[f] ?? null, null, f);
    }
    assert.equal(run.hr_target_min, 125);
  });

  test('a route deleted before the upload arrives does not block it', async () => {
    const res = await ingest(alice, {
      ...liveRun, external_id: 'fp-run-0003', started_at: '2026-11-22T12:00:00Z',
      route_id: '00000000-0000-4000-8000-000000000000',
    });
    assert.equal(res.data.action, 'created', JSON.stringify(res.data));
    const junk = await ingest(alice, { ...liveRun, external_id: 'fp-run-0004', started_at: '2026-11-24T12:00:00Z', route_id: 'not-a-uuid' });
    assert.equal(junk.data.action, 'created', JSON.stringify(junk.data));
  });

  test("the watch's copy of a FitPro run is skipped", async () => {
    const res = await ingest(alice, {
      kind: 'run', source: 'apple', external_id: 'HK-DUP-1',
      distance_mi: 3.0, duration_sec: 1500, started_at: '2026-11-20T12:01:00Z',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.action, 'skipped');
    assert.equal(res.data.reason, 'overlaps_fitpro_run');
    assert.equal(res.data.source, 'apple');
    const original = await ingest(alice, liveRun);
    assert.equal(res.data.run_id, original.data.run_id);
    const [count] = await db.query(`select count(*)::int as n from runs where external_id = 'HK-DUP-1'`, []);
    assert.equal(count.n, 0);
  });

  test('a run that only brushes a FitPro run is imported', async () => {
    const res = await ingest(alice, {
      kind: 'run', source: 'apple', external_id: 'HK-LATER-1',
      distance_mi: 2, duration_sec: 1200, started_at: '2026-11-20T12:25:00Z',
    });
    assert.equal(res.data.action, 'created');
  });

  test('a FitPro run that stopped early does not swallow the full run from the watch', async () => {
    const stub = await ingest(alice, { ...liveRun, external_id: 'fp-run-stub', distance_mi: 0.2, duration_sec: 120, started_at: '2026-11-19T12:00:00Z' });
    assert.equal(stub.data.action, 'created');
    const full = await ingest(alice, {
      kind: 'run', source: 'apple', external_id: 'HK-FULL-1',
      distance_mi: 6.2, duration_sec: 3600, started_at: '2026-11-19T12:00:00Z',
    });
    assert.equal(full.data.action, 'created', 'two minutes of overlap is not the same run as an hour');
  });

  test("another person's FitPro run never causes a skip", async () => {
    const res = await ingest(bob, {
      kind: 'run', source: 'apple', external_id: 'HK-BOB-1',
      distance_mi: 3, duration_sec: 1500, started_at: '2026-11-20T12:01:00Z',
    });
    assert.equal(res.data.action, 'created');
  });

  test('a run already imported keeps updating after a FitPro run overlaps it', async () => {
    const imported = { kind: 'run', source: 'apple', external_id: 'HK-BOB-2', distance_mi: 3, duration_sec: 1500, started_at: '2026-11-23T12:00:00Z' };
    assert.equal((await ingest(bob, imported)).data.action, 'created');
    const live = await ingest(bob, { ...liveRun, external_id: 'fp-run-bob-1', started_at: '2026-11-23T12:00:30Z' });
    assert.equal(live.data.action, 'created', 'a FitPro upload that arrives after the import still saves');
    assert.equal((await ingest(bob, imported)).data.action, 'updated');
  });
});

describe('route directions', () => {
  test('router off -> not available; not your route -> 404', async () => {
    const route = await call('POST', '/api/entities/Route', {
      token: alice.token,
      body: { name: 'Two points', points: [{ lat: 40.7, lng: -74.0 }, { lat: 40.71, lng: -74.0 }] },
    });
    const mine = await call('POST', '/api/functions/routeDirections', { token: alice.token, body: { route_id: route.data.id } });
    assert.deepEqual(mine, { status: 200, data: { available: false, maneuvers: [] } });
    const theirs = await call('POST', '/api/functions/routeDirections', { token: bob.token, body: { route_id: route.data.id } });
    assert.deepEqual(theirs, { status: 404, data: { error: 'Route not found.' } });
    const junk = await call('POST', '/api/functions/routeDirections', { token: alice.token, body: { route_id: 'nope' } });
    assert.equal(junk.status, 404);
    const none = await call('POST', '/api/functions/routeDirections', { token: alice.token, body: {} });
    assert.equal(none.status, 404);
  });

  test('an off-road waypoint is kept on the saved route and drawn as a straight line', async () => {
    const points = [{ lat: 40.7, lng: -74.0 }, { lat: 40.71, lng: -74.0, offroad: true }, { lat: 40.72, lng: -74.0 }];
    const route = await call('POST', '/api/entities/Route', { token: alice.token, body: { name: 'Across the field', points } });
    assert.ok(route.status === 200 || route.status === 201);
    const saved = await call('GET', '/api/entities/Route/' + route.data.id, { token: alice.token });
    assert.deepEqual(saved.data.points, points);

    const snap = await call('POST', '/api/functions/snapRoute', { token: alice.token, body: { points: points.slice(0, 2) } });
    assert.equal(snap.status, 200);
    assert.equal(snap.data.snapped, true, 'an all off-road route is not a routing failure');
    assert.equal(snap.data.path.length, 2);
  });
});

describe('social feed', () => {
  test('friends see non-private posts after accepting', async () => {
    const before = await call('POST', '/api/functions/socialFeed', { token: bob.token, body: {} });
    assert.ok(before.data.posts.every((p) => p.created_by_id === bob.user.id));

    const link = await call('POST', '/api/entities/Connection', {
      token: bob.token,
      body: { from_user_id: bob.user.id, to_user_id: alice.user.id, from_handle: 'bob' },
    });
    assert.equal(link.status, 201);
    assert.equal(link.data.status, 'pending');
    const accept = await call('PUT', `/api/entities/Connection/${link.data.id}`, { token: alice.token, body: { status: 'accepted' } });
    assert.equal(accept.status, 200);

    await call('POST', '/api/entities/Post', { token: alice.token, body: { kind: 'run', title: 'secret', visibility: 'private' } });
    const feed = await call('POST', '/api/functions/socialFeed', { token: bob.token, body: {} });
    const titles = feed.data.posts.map((p) => p.title).sort();
    assert.deepEqual(titles, ['friends run', 'public run']);
    assert.deepEqual(feed.data.friend_ids, [alice.user.id]);
  });
});

describe('friend requests cannot be forced', () => {
  let cara;
  let dan;
  const connect = (from, to, status) =>
    call('POST', '/api/entities/Connection', {
      token: from.token,
      body: { from_user_id: from.user.id, to_user_id: to.user.id, ...(status ? { status } : {}) },
    });
  const feedTitles = async (who) =>
    (await call('POST', '/api/functions/socialFeed', { token: who.token, body: {} })).data.posts.map((p) => p.title);

  before(async () => {
    cara = await signUp('cara.friend@example.com');
    dan = await signUp('dan.friend@example.com');
    await call('POST', '/api/entities/SocialProfile', { token: cara.token, body: { handle: 'cara', visibility: 'private' } });
    await call('POST', '/api/entities/Post', { token: cara.token, body: { kind: 'run', title: 'cara friends only', visibility: 'friends' } });
  });

  test('a request to a private account starts pending, whatever the sender asks for', async () => {
    const forced = await connect(dan, cara, 'accepted');
    assert.equal(forced.status, 201);
    assert.equal(forced.data.status, 'pending');
    assert.ok(!(await feedTitles(dan)).includes('cara friends only'));

    // The sender cannot approve their own request.
    const selfAccept = await call('PUT', '/api/entities/Connection/' + forced.data.id, { token: dan.token, body: { status: 'accepted' } });
    assert.equal(selfAccept.status, 403);
    assert.ok(!(await feedTitles(dan)).includes('cara friends only'));

    // Nor can either side point the request at somebody else.
    const retarget = await call('PUT', '/api/entities/Connection/' + forced.data.id, { token: cara.token, body: { from_user_id: cara.user.id, to_user_id: alice.user.id } });
    assert.equal(retarget.status, 403);

    // The person who was asked can accept, and only then do friends-only posts show.
    const accept = await call('PUT', '/api/entities/Connection/' + forced.data.id, { token: cara.token, body: { status: 'accepted' } });
    assert.equal(accept.status, 200);
    assert.equal(accept.data.status, 'accepted');
    assert.ok((await feedTitles(dan)).includes('cara friends only'));
    await call('DELETE', '/api/entities/Connection/' + forced.data.id, { token: dan.token });
  });

  test('a public account still accepts straight away', async () => {
    const profiles = await call('POST', '/api/entities/SocialProfile/query', { token: cara.token, body: { q: { created_by_id: cara.user.id } } });
    await call('PUT', '/api/entities/SocialProfile/' + profiles.data.items[0].id, { token: cara.token, body: { visibility: 'public' } });
    const open = await connect(dan, cara, 'accepted');
    assert.equal(open.status, 201);
    assert.equal(open.data.status, 'accepted');
    await call('DELETE', '/api/entities/Connection/' + open.data.id, { token: dan.token });
  });

  test('you cannot send a request to yourself, and one made in bulk obeys the same rule', async () => {
    const self = await connect(dan, dan);
    assert.equal(self.status, 400);

    const fern = await signUp('fern.friend@example.com');
    const bulk = await call('POST', '/api/entities/Connection/bulk', {
      token: dan.token,
      body: [{ from_user_id: dan.user.id, to_user_id: fern.user.id, status: 'accepted' }],
    });
    if (bulk.status === 200 || bulk.status === 201) {
      const rows = Array.isArray(bulk.data) ? bulk.data : bulk.data.items || [];
      assert.ok(rows.length && rows.every((r) => r.status === 'pending'), 'a bulk-created request is pending too');
    } else {
      assert.ok(bulk.status >= 400);
    }
  });
});

describe('uploads', () => {
  test('upload an image and fetch it back', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const up = await call('POST', '/api/uploads', { token: alice.token, raw: bytes, headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 201);
    assert.match(up.data.file_url, /^\/uploads\/[0-9a-f-]+\.png$/);
    const res = await fetch(base + up.data.file_url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
  });

  test('rejects other file types and anonymous uploads', async () => {
    const exe = await call('POST', '/api/uploads', { token: alice.token, raw: 'MZ', headers: { 'Content-Type': 'application/x-msdownload' } });
    assert.equal(exe.status, 415);
    const anon = await call('POST', '/api/uploads', { raw: 'x', headers: { 'Content-Type': 'image/png' } });
    assert.equal(anon.status, 401);
    assert.equal((await fetch(`${base}/uploads/..%2f..%2fetc%2fpasswd`)).status, 404);
  });
});

describe('first admin on a new host', () => {
  const login = (email, password) => call('POST', '/api/auth/login', { body: { email, password } });

  test('nothing happens unless both settings are present and the password is long enough', async () => {
    assert.equal(await bootstrapAdmin(db, {}), 'skipped');
    const said = [];
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'owner@example.com' }, (line) => said.push(line)), 'skipped');
    assert.deepEqual(said, [], 'the password setting removed after set-up is not worth a warning');
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'short-pw' }, (line) => said.push(line)), 'skipped');
    assert.match(said[0], /at least 12 characters/);
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'short-pw' }), 'skipped');
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: 'a-long-enough-password' }), 'skipped');
    assert.equal((await db.query(`select id from users where email = 'owner@example.com'`, [])).length, 0);
  });

  test('creates a verified admin who can sign in and needs no invite code', async () => {
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: ' Owner@Example.com ', ADMIN_PASSWORD: 'a-long-enough-password' }), 'created');
    const signedIn = await login('owner@example.com', 'a-long-enough-password');
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
    assert.equal(signedIn.data.user.role, 'admin');
    const access = await call('POST', '/api/functions/inviteAccess', { token: signedIn.data.access_token, body: { action: 'status' } });
    assert.equal(access.data.allowed, true);
  });

  test('a second start changes nothing, even with a different password', async () => {
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'a-different-password' }), 'exists');
    assert.equal((await login('owner@example.com', 'a-long-enough-password')).status, 200);
    assert.equal((await login('owner@example.com', 'a-different-password')).status, 401);
  });

  test('an existing ordinary account with that email is never promoted or reset', async () => {
    assert.equal(await bootstrapAdmin(db, { ADMIN_EMAIL: 'bob@example.com', ADMIN_PASSWORD: 'a-long-enough-password' }), 'exists');
    const stillBob = await login('bob@example.com', 'correct-horse-1');
    assert.equal(stillBob.status, 200);
    assert.equal(stillBob.data.user.role, 'user');
    assert.equal((await login('bob@example.com', 'a-long-enough-password')).status, 401);
  });
});

describe('requests nobody should be able to hurt the server with', () => {
  const raw = (path) => fetch(base + path);
  const serverErrors = async () => (await db.query(`select count(*)::int as n from client_errors where platform = 'server'`, []))[0].n;

  test('a path that is not a valid address is a 400, and the server keeps running', async () => {
    const res = await raw('//');
    assert.equal(res.status, 400);
    assert.equal((await call('GET', '/api/health')).status, 200);
  });

  test('a badly encoded path is a 400 and is not recorded as a server error', async () => {
    const before = await serverErrors();
    for (const path of ['/uploads/%E0%A4%A', '/api/entities/Run/%E0%A4%A', '/api/functions/%E0%A4%A']) {
      const res = await raw(path);
      assert.equal(res.status, 400, path);
    }
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await serverErrors(), before);
  });

  test('sign-in guesses against one email are limited even from many addresses', async () => {
    process.env.TRUST_PROXY = 'true';
    try {
      let last;
      for (let i = 0; i < 40 && last !== 429; i++) {
        last = (await call('POST', '/api/auth/login', {
          body: { email: 'guess-target@example.com', password: `wrong-${i}` },
          headers: { 'X-Forwarded-For': `203.0.113.${i}` },
        })).status;
      }
      assert.equal(last, 429);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  test('a download the reader abandons does not hold the file open', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 7);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    const up = await call('POST', '/api/uploads', { token: bob.token, raw: big, headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 201);
    const name = up.data.file_url.split('/').pop();
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const res = await fetch(base + up.data.file_url, { signal: controller.signal });
      await res.body.getReader().read();
      controller.abort();
    }
    await new Promise((r) => setTimeout(r, 300));
    // On every platform a file that is still open cannot be renamed away and replaced cleanly;
    // the portable check is that removing it works and a later request is a clean 404.
    fs.rmSync(path.join(uploadDir, name));
    assert.equal((await fetch(base + up.data.file_url)).status, 404);
    assert.equal((await call('GET', '/api/health')).status, 200);
  });
});

describe('error reports', () => {
  const report = (token, body) => call('POST', '/api/client-errors', { token, body });
  let owner;

  test('only a signed-in person can send one', async () => {
    assert.equal((await report(undefined, { message: 'boom' })).status, 401);
    assert.equal((await report(bob.token, {})).status, 400);
    assert.equal((await report(bob.token, { message: '   ' })).status, 400);
  });

  test('a report is stored against the sender, with long fields cut down', async () => {
    const sent = await report(bob.token, {
      message: 'm'.repeat(900), stack: 's'.repeat(9000), context: 'c'.repeat(900), platform: 'ios', app_version: '1.0.0 (12)',
      user_id: alice.user.id, extra: { anything: true },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.deepEqual(sent.data, { ok: true });
    const [row] = await db.query('select * from client_errors where user_id = $1', [bob.user.id]);
    assert.deepEqual([row.message.length, row.stack.length, row.context.length, row.platform, row.app_version], [500, 4000, 200, 'ios', '1.0.0 (12)']);
    // only the API itself may label a report as coming from the server
    await report(bob.token, { message: 'pretending', platform: 'server' });
    const [fake] = await db.query(`select platform from client_errors where message = 'pretending'`, []);
    assert.equal(fake.platform, 'app');
    await db.query(`delete from client_errors where message = 'pretending' returning id`, []);
  });

  test('admins read them newest first; nobody else can', async () => {
    owner = (await call('POST', '/api/auth/login', { body: { email: 'owner@example.com', password: 'a-long-enough-password' } })).data;
    await report(bob.token, { message: 'second report', platform: 'android' });
    assert.equal((await call('POST', '/api/functions/adminClientErrors', { token: bob.token, body: { action: 'list' } })).status, 403);
    const list = await call('POST', '/api/functions/adminClientErrors', { token: owner.access_token, body: { action: 'list' } });
    assert.equal(list.status, 200);
    assert.equal(list.data.errors[0].message, 'second report');
    assert.equal(list.data.errors[0].user_email, 'bob@example.com');
    assert.equal(list.data.errors.length, 2);
    assert.equal(list.data.errors[0].password_hash, undefined);
  });

  test('an unexpected server error is recorded too, without the request body', async () => {
    const before = (await db.query(`select count(*)::int as n from client_errors where platform = 'server'`, []))[0].n;
    const crash = await call('POST', '/api/functions/adminClientErrors', { token: owner.access_token, body: { action: 'test-crash', secret: 'do-not-store-me' } });
    assert.equal(crash.status, 500);
    // the record is written just after the reply goes out
    let rows = [];
    for (let i = 0; i < 40 && rows.length <= before; i++) {
      await new Promise((r) => setTimeout(r, 25));
      rows = await db.query(`select * from client_errors where platform = 'server' order by created_date desc`, []);
    }
    assert.equal(rows.length, before + 1);
    assert.equal(rows[0].context, 'POST /api/functions/adminClientErrors');
    // the same failure again and again is recorded once, not once per request
    for (let i = 0; i < 3; i++) await call('POST', '/api/functions/adminClientErrors', { token: owner.access_token, body: { action: 'test-crash' } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await db.query(`select id from client_errors where platform = 'server'`, [])).length, before + 1);
    assert.ok(!JSON.stringify(rows[0]).includes('do-not-store-me'));
  });

  test('one person cannot flood the table', async () => {
    let last;
    for (let i = 0; i < 20; i++) last = await report(bob.token, { message: `flood ${i}` });
    assert.equal(last.status, 429);
    const [{ n }] = await db.query('select count(*)::int as n from client_errors where user_id = $1', [bob.user.id]);
    assert.equal(n, 19, 'twenty accepted in the hour, one of which was removed above');
  });

  test('admins can clear the list; deleting an account deletes its reports', async () => {
    const carol = await signUp('errors-carol@example.com');
    await report(carol.token, { message: 'from carol' });
    await call('DELETE', '/api/auth/me', { token: carol.token, body: { password: 'correct-horse-1' } });
    assert.equal((await db.query('select id from client_errors where user_id = $1', [carol.user.id])).length, 0);
    const cleared = await call('POST', '/api/functions/adminClientErrors', { token: owner.access_token, body: { action: 'clear' } });
    assert.equal(cleared.status, 200);
    assert.equal((await db.query('select id from client_errors', [])).length, 0);
  });
});

describe('your data', () => {
  test('wipe training data, then delete the account', async () => {
    for (const entity of ['Run', 'Route', 'Workout', 'PaceZone', 'Profile']) {
      const res = await call('POST', `/api/entities/${entity}/delete-many`, { token: alice.token, body: { q: { created_by_id: alice.user.id } } });
      assert.equal(res.status, 200);
    }
    const runs = await call('POST', '/api/entities/Run/query', { token: alice.token, body: {} });
    assert.equal(runs.data.items.length, 0);

    assert.equal((await call('DELETE', '/api/auth/me', { token: alice.token, body: { password: 'wrong' } })).status, 401);
    const gone = await call('DELETE', '/api/auth/me', { token: alice.token, body: { password: 'correct-horse-1' } });
    assert.equal(gone.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: alice.token })).status, 401);
    const [{ n }] = await db.query(
      `select (select count(*) from posts where created_by_id = $1)::int
            + (select count(*) from connections where to_user_id = $1)::int
            + (select count(*) from access_grants where user_id = $1)::int
            + (select count(*) from entitlements where user_id = $1)::int as n`,
      [alice.user.id]
    );
    assert.equal(n, 0, 'everything the user owned is gone');
    const [code] = await db.query(`select status, used_by_id from invite_codes where used_by_email = 'alice@example.com'`, []);
    assert.equal(code.status, 'used');
    assert.equal(code.used_by_id ?? null, null, 'invite history keeps the code but forgets the user');
  });
});

// ---------------------------------------------------------------- Stripe (stage 2)
// Every app in these tests gets a fake Stripe (test/stripe-fake.js): nothing here
// reaches the network. `shop()` is the API as it runs when it is selling.
const SELLING = { subscriptions: true, selling: true, stripe: TEST_STRIPE };
const UNAVAILABLE = { status: 503, data: { error: 'Subscriptions are not available right now.' } };
const PROVIDER_DOWN = { status: 502, data: { error: 'We could not reach the payment provider. Try again in a moment.' } };

async function shop(overrides = {}, fakeOptions = {}) {
  const fake = createFakeStripe(fakeOptions);
  const app = await startApp({ ...SELLING, ...overrides }, { stripe: fake });
  const on = (method, url, options = {}) => call(method, url, { ...options, origin: app.origin });
  return {
    ...app,
    fake,
    on,
    subscription: (who, body) => on('POST', '/api/functions/subscription', { token: who.token, body }),
    access: (who) => on('POST', '/api/functions/inviteAccess', { token: who.token, body: { action: 'status' } }),
    runs: (who) => on('POST', '/api/entities/Run/query', { token: who.token, body: {} }),
    // The newest checkout session the fake holds for this account.
    sessionOf: (who) => [...fake.state.sessions.values()].filter((s) => s.client_reference_id === who.user.id).at(-1),
    // Checkout and Stripe's page, with no webhook: returns the fake's subscription.
    async subscribe(who, plan = 'monthly') {
      const res = await on('POST', '/api/functions/subscription', { token: who.token, body: { action: 'checkout', plan } });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      return fake.completeCheckout(this.sessionOf(who).id);
    },
  };
}

describe('subscribing on the website', () => {
  let store;
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };

  before(async () => {
    store = await shop();
  });
  after(async () => {
    await store?.close();
  });

  test('status says whether the server is selling', async () => {
    const pia = await legacyUser('pia.status@example.com');
    const fresh = { trial_available: true, customer: false, subscription: null, duplicate: false };
    assert.deepEqual(await call('POST', '/api/functions/subscription', { token: pia.token, body: { action: 'status' } }), {
      status: 200, data: { selling: false, ...fresh },
    });
    const switchOnly = await startApp({ subscriptions: true });
    try {
      const res = await call('POST', '/api/functions/subscription', { token: pia.token, body: {}, origin: switchOnly.origin });
      assert.deepEqual(res, { status: 200, data: { selling: false, ...fresh } });
    } finally {
      await switchOnly.close();
    }
    assert.deepEqual(await store.subscription(pia, { action: 'status' }), { status: 200, data: { selling: true, ...fresh } });
    assert.equal(store.fake.calls.length, 0, 'reading the status never calls Stripe');
    assert.equal((await store.subscription(pia, { action: 'dance' })).status, 400);
  });

  test('checkout returns the address at Stripe and asks for a 7-day trial once', async () => {
    const tom = await legacyUser('tom.trial@example.com');
    const first = await store.subscription(tom, { action: 'checkout', plan: 'monthly' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const session = store.sessionOf(tom);
    assert.deepEqual(first.data, { url: session.url });
    const [made] = store.fake.callsTo('createCheckoutSession').filter((c) => c.args.userId === tom.user.id);
    assert.equal(made.args.trialDays, 7);
    assert.equal(made.args.priceId, TEST_STRIPE.prices.monthly);
    assert.equal(made.args.successUrl, `${testConfig.appUrl}/?checkout=success`);
    assert.equal(made.args.cancelUrl, `${testConfig.appUrl}/?checkout=cancelled`);
    assert.equal(session.client_reference_id, tom.user.id);
    const row = await userRow(tom.user.id);
    assert.match(row.stripe_customer_id, /^cus_/);
    assert.equal(row.stripe_customer_id, session.customer);
    assert.equal(row.trial_used_at, null, 'opening checkout does not use up the trial');
    assert.equal((await store.subscription(tom, { action: 'status' })).data.customer, true);

    // once the trial has been had, on either platform, the next checkout starts paid
    await db.query('update users set trial_used_at = now() where id = $1 returning id', [tom.user.id]);
    assert.equal((await store.subscription(tom, { action: 'status' })).data.trial_available, false);
    const second = await store.subscription(tom, { action: 'checkout', plan: 'annual' });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    const again = store.fake.callsTo('createCheckoutSession').filter((c) => c.args.userId === tom.user.id).at(-1);
    assert.equal(again.args.trialDays, 0);
    assert.equal(again.args.priceId, TEST_STRIPE.prices.annual);
    assert.equal(again.args.customerId, row.stripe_customer_id, 'the same customer is used again');
  });

  test('the plan must be one of the two', async () => {
    const pat = await legacyUser('pat.plan@example.com');
    for (const plan of [undefined, 'weekly', 'price_monthly_test', 42]) {
      assert.deepEqual(await store.subscription(pat, { action: 'checkout', plan }), {
        status: 400, data: { error: 'Choose the monthly or the annual plan.' },
      });
    }
    assert.equal(store.sessionOf(pat), undefined);
  });

  test('checkout is not offered while the switch is off or the keys are missing', async () => {
    const olga = await legacyUser('olga.off@example.com');
    const fake = createFakeStripe();
    // keys present, switch off
    const switchOff = await startApp({ stripe: TEST_STRIPE }, { stripe: fake });
    // switch on, keys missing
    const noKeys = await startApp({ subscriptions: true }, { stripe: fake });
    try {
      for (const app of [switchOff, noKeys]) {
        const res = await call('POST', '/api/functions/subscription', { token: olga.token, body: { action: 'checkout', plan: 'monthly' }, origin: app.origin });
        assert.deepEqual(res, UNAVAILABLE);
      }
      assert.deepEqual(await call('POST', '/api/functions/subscription', { token: olga.token, body: { action: 'checkout', plan: 'monthly' } }), UNAVAILABLE);
    } finally {
      await switchOff.close();
      await noKeys.close();
    }
    assert.equal(fake.calls.length, 0, 'Stripe was never called');
    assert.equal((await userRow(olga.user.id)).stripe_customer_id, null);
  });

  test('a price at Stripe that does not match the plan stops checkout', async () => {
    const mia = await legacyUser('mia.mismatch@example.com');
    const wrongAmount = { ...TEST_PRICES, [TEST_STRIPE.prices.monthly]: { ...TEST_PRICES[TEST_STRIPE.prices.monthly], unit_amount: 599 } };
    const wrongInterval = { ...TEST_PRICES, [TEST_STRIPE.prices.annual]: { ...TEST_PRICES[TEST_STRIPE.prices.annual], recurring: { interval: 'month', interval_count: 1 } } };
    const wrongCurrency = { ...TEST_PRICES, [TEST_STRIPE.prices.annual]: { ...TEST_PRICES[TEST_STRIPE.prices.annual], currency: 'eur' } };
    for (const prices of [wrongAmount, wrongInterval, wrongCurrency]) {
      const bad = await shop({}, { prices });
      try {
        // either plan is refused: nobody is sent to checkout while one price is wrong
        assert.deepEqual(await bad.subscription(mia, { action: 'checkout', plan: 'annual' }), UNAVAILABLE);
        assert.deepEqual(await bad.subscription(mia, { action: 'checkout', plan: 'monthly' }), UNAVAILABLE);
        assert.equal(bad.fake.state.sessions.size, 0);
        assert.equal(bad.fake.state.customers.size, 0);
      } finally {
        await bad.close();
      }
    }
    // the owner is told, in the error reports
    let reports = [];
    for (let i = 0; i < 40 && !reports.length; i++) {
      await new Promise((r) => setTimeout(r, 25));
      reports = await db.query(`select message, context from client_errors where platform = 'server' and message like 'The Stripe price for the%'`, []);
    }
    assert.ok(reports.length >= 1, 'a mismatch is written to the error reports');
    assert.match(reports[0].message, /does not match/);
    await db.query(`delete from client_errors where platform = 'server' returning id`, []);
  });

  test('someone with an invite code or a free pass is never sent to checkout', async () => {
    const ALREADY = { status: 409, data: { error: 'You already have access, so there is nothing to pay.' } };
    const ivy = await invitedUser('ivy.invited@example.com');
    const gus = await legacyUser('gus.granted@example.com');
    await db.tx((tx) => grantFree(tx, { userId: gus.user.id, source: 'admin', grantedBy: 'owner@example.com' }));
    for (const who of [ivy, gus, admin]) {
      assert.deepEqual(await store.subscription(who, { action: 'checkout', plan: 'monthly' }), ALREADY);
      assert.equal((await userRow(who.user.id)).stripe_customer_id, null);
    }
    assert.equal(store.fake.callsTo('createCustomer').filter((c) => [ivy, gus, admin].some((w) => w.user.id === c.args.userId)).length, 0);
  });

  test('two checkouts at once share one Stripe customer and leave one open session', async (t) => {
    if (db.transactional === false) return t.skip('needs real row locks; the psql test driver does not hold transactions');
    const twin = await shop();
    try {
      const tab = await legacyUser('tab.twice@example.com');
      const [a, b] = await Promise.all([
        twin.subscription(tab, { action: 'checkout', plan: 'monthly' }),
        twin.subscription(tab, { action: 'checkout', plan: 'annual' }),
      ]);
      assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.data, b.data]));
      assert.equal(twin.fake.state.customers.size, 1);
      const statuses = [...twin.fake.state.sessions.values()].map((s) => s.status).sort();
      assert.deepEqual(statuses, ['expired', 'open']);
      // and a third, later, leaves still only one open
      await twin.subscription(tab, { action: 'checkout', plan: 'monthly' });
      assert.equal([...twin.fake.state.sessions.values()].filter((s) => s.status === 'open').length, 1);
      assert.equal(twin.fake.state.customers.size, 1);
    } finally {
      await twin.close();
    }
  });

  test('checkout is refused once a subscription exists at Stripe, even before its webhook', async () => {
    const SUBSCRIBED = { status: 409, data: { error: 'You already have a subscription. Manage it in Settings.' } };
    const paz = await legacyUser('paz.paid@example.com');
    assert.deepEqual(await store.runs(paz), NO_ACCESS);
    await store.subscribe(paz, 'monthly');
    // no webhook has arrived; a second tab tries to pay again
    assert.deepEqual(await store.subscription(paz, { action: 'checkout', plan: 'monthly' }), SUBSCRIBED);
    assert.equal((await store.runs(paz)).status, 200, 'and the check let the person in');
    assert.equal([...store.fake.state.sessions.values()].filter((s) => s.client_reference_id === paz.user.id).length, 1);
    const [row] = await entitlementsOf(paz.user.id);
    assert.deepEqual([row.source, row.status, row.plan], ['stripe', 'trial', 'monthly']);
    // with the row in place the refusal needs no call to Stripe at all
    const before = store.fake.calls.length;
    assert.deepEqual(await store.subscription(paz, { action: 'checkout', plan: 'annual' }), SUBSCRIBED);
    assert.equal(store.fake.calls.length, before);
  });

  test('a Stripe failure is a clear 502 and nothing is half-made', async () => {
    const fay = await legacyUser('fay.fail@example.com');
    for (const method of ['createCustomer', 'listOpenCheckoutSessions', 'createCheckoutSession']) {
      store.fake.failNext(method);
      assert.deepEqual(await store.subscription(fay, { action: 'checkout', plan: 'monthly' }), PROVIDER_DOWN, method);
      assert.equal(store.sessionOf(fay), undefined, `no session after ${method} failed`);
    }
    const ok = await store.subscription(fay, { action: 'checkout', plan: 'monthly' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal([...store.fake.state.customers.values()].filter((c) => c.metadata.user_id === fay.user.id).length, 1);
    assert.equal((await entitlementsOf(fay.user.id)).length, 0);
  });

  test('the subscription function is open to an account without access, and closed to nobody signed in', async () => {
    const lee = await legacyUser('lee.locked@example.com');
    assert.deepEqual(await store.runs(lee), NO_ACCESS);
    assert.equal((await store.subscription(lee, { action: 'status' })).status, 200);
    assert.deepEqual(await store.on('POST', '/api/functions/subscription', { body: { action: 'status' } }), { status: 401, data: { error: 'Unauthorized' } });
  });

  test('a person is stopped after ten checkouts in an hour', async () => {
    const rex = await legacyUser('rex.repeat@example.com');
    let last;
    for (let i = 0; i < 11; i++) last = await store.subscription(rex, { action: 'checkout', plan: 'monthly' });
    assert.equal(last.status, 429);
    assert.equal(store.fake.callsTo('createCheckoutSession').filter((c) => c.args.userId === rex.user.id).length, 10);
  });
});

describe('Stripe webhook', () => {
  let store;
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };
  const RECEIVED = { status: 200, data: { received: true } };
  const DAY_MS = 24 * 60 * 60 * 1000;
  const near = (actual, expectedMs, message) =>
    assert.ok(Math.abs(new Date(actual).getTime() - expectedMs) < 2 * 60 * 1000, `${message}: ${new Date(actual).toISOString()}`);

  // Posts a delivery exactly as Stripe would: the raw body and its signature header.
  const deliver = (event, { secret = TEST_STRIPE.webhookSecret, at, body, header } = {}) => {
    const signed = signedEvent(secret, event, { at });
    return store.on('POST', '/api/stripe/webhook', {
      raw: body ?? signed.body,
      headers: { 'Content-Type': 'application/json', ...(header === null ? {} : { 'Stripe-Signature': header ?? signed.header }) },
    });
  };
  const customerOf = async (who) => (await userRow(who.user.id)).stripe_customer_id;
  // A notice about the account's customer. Only the type and the customer are read from it.
  const notify = async (who, type, extra = {}) => deliver({ type, object: { id: 'obj_ignored', customer: await customerOf(who), ...extra } });
  const eventCount = async () => (await db.query('select count(*)::int as n from stripe_events', []))[0].n;
  const stripeRows = async (who) => (await entitlementsOf(who.user.id)).filter((r) => r.source === 'stripe');

  // Someone who went through checkout and whose first notice has arrived.
  async function subscriber(email, plan = 'monthly') {
    const who = await legacyUser(email);
    const sub = await store.subscribe(who, plan);
    assert.deepEqual(await notify(who, 'checkout.session.completed'), RECEIVED);
    return { who, sub };
  }

  before(async () => {
    store = await shop();
  });
  after(async () => {
    await store?.close();
    await new Promise((r) => setTimeout(r, 100));
    await db.query(`delete from client_errors where platform = 'server' returning id`, []);
  });

  test('an unsigned or wrongly signed notice is refused and changes nothing', async () => {
    const INVALID = { status: 400, data: { error: 'Invalid signature.' } };
    const uma = await legacyUser('uma.unsigned@example.com');
    await store.subscribe(uma);
    const event = { type: 'checkout.session.completed', object: { customer: await customerOf(uma) } };
    const before = await eventCount();

    assert.deepEqual(await deliver(event, { header: null }), INVALID);
    assert.deepEqual(await deliver(event, { header: 'nonsense' }), INVALID);
    assert.deepEqual(await deliver(event, { secret: 'whsec_someone_else' }), INVALID);
    assert.deepEqual(await deliver(event, { at: Date.now() - 10 * 60 * 1000 }), INVALID, 'a delivery replayed ten minutes later');
    // a correct signature, but over a different body
    const other = signedEvent(TEST_STRIPE.webhookSecret, { type: 'invoice.paid', object: { customer: 'cus_other' } });
    assert.deepEqual(await deliver(event, { header: other.header }), INVALID);
    // and a body that is not JSON is refused on its signature, before anything is read from it
    assert.deepEqual(await deliver(event, { body: 'not json' }), INVALID);

    assert.equal((await stripeRows(uma)).length, 0);
    assert.equal(await eventCount(), before);
    assert.deepEqual(await store.runs(uma), NO_ACCESS);
    assert.equal(store.fake.callsTo('listSubscriptions').length, 0);
  });

  test('the webhook is not there without the keys', async () => {
    const { body, header } = signedEvent(TEST_STRIPE.webhookSecret, { type: 'invoice.paid', object: { customer: 'cus_x' } });
    const res = await call('POST', '/api/stripe/webhook', { raw: body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header } });
    assert.deepEqual(res, { status: 404, data: { error: 'Not found' } });
  });

  test('checkout completed opens the account', async () => {
    const cleo = await legacyUser('cleo.checkout@example.com');
    await store.subscribe(cleo, 'monthly');
    assert.deepEqual(await store.runs(cleo), NO_ACCESS);
    assert.deepEqual(await notify(cleo, 'checkout.session.completed'), RECEIVED);

    const [row] = await stripeRows(cleo);
    assert.deepEqual([row.status, row.plan, row.cancel_at_period_end], ['trial', 'monthly', false]);
    assert.match(row.external_id, /^sub_/);
    near(row.expires_at, Date.now() + 7 * DAY_MS, 'the trial ends in 7 days');
    assert.ok((await userRow(cleo.user.id)).trial_used_at, 'the free trial is used up');
    assert.equal((await store.runs(cleo)).status, 200);
    const access = (await store.access(cleo)).data;
    assert.deepEqual([access.allowed, access.reason, access.source, access.plan], [true, 'trial', 'stripe', 'monthly']);
    const status = (await store.subscription(cleo, { action: 'status' })).data;
    assert.deepEqual([status.trial_available, status.customer, status.subscription.status, status.duplicate], [false, true, 'trial', false]);
  });

  test('renewal moves the end date and clears grace', async () => {
    const { who, sub } = await subscriber('rene.renews@example.com', 'annual');
    store.fake.setSubscription(sub.id, { status: 'active', current_period_start: daysFromNowUnix(0), current_period_end: daysFromNowUnix(365) });
    assert.deepEqual(await notify(who, 'invoice.paid'), RECEIVED);
    let [row] = await stripeRows(who);
    assert.deepEqual([row.status, row.plan], ['active', 'annual']);
    near(row.expires_at, Date.now() + 365 * DAY_MS, 'the paid year');

    store.fake.setSubscription(sub.id, { status: 'past_due', current_period_start: daysFromNowUnix(-1), current_period_end: daysFromNowUnix(364) });
    await notify(who, 'invoice.payment_failed');
    [row] = await stripeRows(who);
    assert.equal(row.status, 'grace');

    store.fake.setSubscription(sub.id, { status: 'active' });
    await notify(who, 'invoice.paid');
    [row] = await stripeRows(who);
    assert.equal(row.status, 'active');
    near(row.expires_at, Date.now() + 364 * DAY_MS, 'the new period end');
    assert.equal((await store.access(who)).data.reason, 'subscription');
  });

  test('a failed payment keeps access for three days and no longer', async () => {
    const { who, sub } = await subscriber('fern.failed@example.com');
    // the period that was paid for ended two days ago, and the charge for the next one failed
    store.fake.setSubscription(sub.id, { status: 'past_due', current_period_start: daysFromNowUnix(-2), current_period_end: daysFromNowUnix(28) });
    assert.deepEqual(await notify(who, 'invoice.payment_failed'), RECEIVED);
    let [row] = await stripeRows(who);
    assert.equal(row.status, 'grace');
    near(row.expires_at, Date.now() - 2 * DAY_MS, 'the end of what was paid for');
    assert.equal((await store.runs(who)).status, 200, `inside the ${GRACE_DAYS}-day allowance`);

    store.fake.setSubscription(sub.id, { current_period_start: daysFromNowUnix(-4), current_period_end: daysFromNowUnix(26) });
    await notify(who, 'customer.subscription.updated');
    [row] = await stripeRows(who);
    assert.equal(row.status, 'grace');
    assert.deepEqual(await store.runs(who), NO_ACCESS);
    // the paywall can still see why
    assert.equal((await store.subscription(who, { action: 'status' })).data.subscription.status, 'grace');
  });

  test('cancel at period end, then resume', async () => {
    const { who, sub } = await subscriber('cara.cancels@example.com');
    store.fake.setSubscription(sub.id, { cancel_at_period_end: true });
    await notify(who, 'customer.subscription.updated');
    let [row] = await stripeRows(who);
    assert.deepEqual([row.status, row.cancel_at_period_end], ['trial', true]);
    assert.equal((await store.runs(who)).status, 200, 'access runs to the end of the period');
    assert.equal((await store.access(who)).data.cancel_at_period_end, true);

    store.fake.setSubscription(sub.id, { cancel_at_period_end: false });
    await notify(who, 'customer.subscription.updated');
    [row] = await stripeRows(who);
    assert.deepEqual([row.status, row.cancel_at_period_end], ['trial', false]);
  });

  test('final cancellation ends access', async () => {
    const { who, sub } = await subscriber('enzo.ends@example.com');
    store.fake.setSubscription(sub.id, { status: 'canceled', canceled_at: daysFromNowUnix(0), ended_at: daysFromNowUnix(0) });
    assert.deepEqual(await notify(who, 'customer.subscription.deleted'), RECEIVED);
    const [row] = await stripeRows(who);
    assert.equal(row.status, 'expired');
    assert.deepEqual(await store.runs(who), NO_ACCESS);
    const status = (await store.subscription(who, { action: 'status' })).data;
    assert.deepEqual([status.subscription, status.trial_available], [null, false]);
  });

  test('a refund without a free pass ends access immediately', async () => {
    const { who, sub } = await subscriber('rafa.refund@example.com', 'annual');
    store.fake.setSubscription(sub.id, { status: 'active', current_period_end: daysFromNowUnix(350) });
    await notify(who, 'invoice.paid');
    assert.equal((await store.runs(who)).status, 200);

    const charge = store.fake.chargeFor(sub.id);
    const refund = await deliver({ type: 'charge.refunded', object: { id: charge, customer: await customerOf(who), refunded: true } });
    assert.deepEqual(refund, RECEIVED);
    const [row] = await stripeRows(who);
    assert.deepEqual([row.status, row.note, row.cancel_at_period_end], ['revoked', 'Refunded', false]);
    near(row.expires_at, Date.now(), 'ended now');
    assert.deepEqual(store.fake.callsTo('cancelSubscription').map((c) => c.args.subscriptionId).filter((id) => id === sub.id), [sub.id]);
    assert.equal(store.fake.state.subscriptions.get(sub.id).status, 'canceled');
    assert.deepEqual(await store.runs(who), NO_ACCESS, 'no three-day allowance after a refund');
    assert.equal((await store.subscription(who, { action: 'status' })).data.subscription, null);
  });

  test('a refund ends the paid row and leaves a free pass standing', async () => {
    const { who, sub } = await subscriber('pola.pass@example.com');
    await db.tx((tx) => grantFree(tx, { userId: who.user.id, source: 'invite', grantedBy: 'FP-GIFT-0001' }));
    assert.equal((await store.access(who)).data.reason, 'trial');

    const charge = store.fake.chargeFor(sub.id);
    await deliver({ type: 'charge.refunded', object: { id: charge, customer: await customerOf(who), refunded: true } });
    assert.deepEqual((await entitlementsOf(who.user.id)).map((r) => [r.source, r.status]).sort(), [['invite', 'active'], ['stripe', 'revoked']]);
    const access = (await store.access(who)).data;
    assert.deepEqual([access.allowed, access.reason, access.source], [true, 'invite', 'invite']);
    assert.equal((await store.runs(who)).status, 200);
  });

  test('two subscriptions on one account: refunding one leaves the other', async () => {
    const { who, sub: first } = await subscriber('dora.double@example.com');
    const second = store.fake.addSubscription({ customerId: await customerOf(who), priceId: TEST_STRIPE.prices.annual, status: 'active' });
    await notify(who, 'customer.subscription.created');
    assert.deepEqual((await stripeRows(who)).map((r) => [r.external_id, r.status]).sort(), [[first.id, 'trial'], [second.id, 'active']].sort());
    assert.equal((await store.subscription(who, { action: 'status' })).data.duplicate, true);
    const listed = (await call('POST', '/api/functions/adminAccess', { token: admin.token, body: { action: 'list', search: 'dora.double@' } })).data.people[0];
    assert.equal(listed.entitlements.filter((e) => e.source === 'stripe').length, 2, 'the owner sees both');

    const charge = store.fake.chargeFor(first.id);
    await deliver({ type: 'charge.refunded', object: { id: charge, customer: await customerOf(who), refunded: true } });
    assert.deepEqual((await stripeRows(who)).map((r) => [r.external_id, r.status]).sort(), [[first.id, 'revoked'], [second.id, 'active']].sort());
    assert.equal(store.fake.state.subscriptions.get(second.id).status, 'active', 'the other one was not cancelled at Stripe');
    const access = (await store.access(who)).data;
    assert.deepEqual([access.allowed, access.reason, access.plan], [true, 'subscription', 'annual']);
    assert.equal((await store.subscription(who, { action: 'status' })).data.duplicate, false);
  });

  test('a refund Stripe cannot trace ends the only subscription, and neither of two', async () => {
    const { who: one, sub: only } = await subscriber('una.untraced@example.com');
    const lost = store.fake.chargeFor(only.id, { traceable: false });
    await deliver({ type: 'charge.refunded', object: { id: lost, customer: await customerOf(one), refunded: true } });
    assert.deepEqual((await stripeRows(one)).map((r) => r.status), ['revoked']);

    const { who: two, sub: first } = await subscriber('tess.two@example.com');
    const customer = await customerOf(two);
    store.fake.addSubscription({ customerId: customer, priceId: TEST_STRIPE.prices.annual, status: 'active' });
    const unknown = store.fake.chargeFor(first.id, { traceable: false });
    assert.deepEqual(await deliver({ type: 'charge.refunded', object: { id: unknown, customer, refunded: true } }), RECEIVED);
    assert.deepEqual((await stripeRows(two)).map((r) => r.status).sort(), ['active', 'trial'], 'neither was ended');
    let reports = [];
    for (let i = 0; i < 40 && !reports.length; i++) {
      await new Promise((r) => setTimeout(r, 25));
      reports = await db.query(`select message from client_errors where platform = 'server' and message like 'Refund received for%'`, []);
    }
    assert.equal(reports[0]?.message, `Refund received for ${customer} but the subscription could not be identified. Cancel it in Stripe.`);
  });

  test('a repeated event changes nothing', async () => {
    const dee = await legacyUser('dee.duplicate@example.com');
    await store.subscribe(dee);
    const customer = await customerOf(dee);
    const event = { id: 'evt_test_repeat_0001', type: 'checkout.session.completed', object: { customer } };
    assert.deepEqual(await deliver(event), RECEIVED);
    const [first] = await stripeRows(dee);
    const calls = store.fake.callsTo('listSubscriptions').filter((c) => c.args.customerId === customer).length;

    assert.deepEqual(await deliver(event), { status: 200, data: { received: true, duplicate: true } });
    const [second] = await stripeRows(dee);
    assert.equal(new Date(second.updated_date).getTime(), new Date(first.updated_date).getTime());
    assert.equal(store.fake.callsTo('listSubscriptions').filter((c) => c.args.customerId === customer).length, calls, 'Stripe was not asked again');
    assert.equal(calls, 1);
    // a different event that finds nothing new leaves the row as it was, too
    await notify(dee, 'customer.subscription.updated');
    const [third] = await stripeRows(dee);
    assert.equal(new Date(third.updated_date).getTime(), new Date(first.updated_date).getTime());
  });

  test('an old notice arriving after cancellation does not reopen access', async () => {
    const { who, sub } = await subscriber('otto.order@example.com');
    store.fake.setSubscription(sub.id, { status: 'canceled', canceled_at: daysFromNowUnix(0), ended_at: daysFromNowUnix(0) });
    await notify(who, 'customer.subscription.deleted');
    // the notice that the subscription was created turns up late, still saying "trialing"
    assert.deepEqual(await notify(who, 'customer.subscription.created', { status: 'trialing', id: sub.id }), RECEIVED);
    assert.deepEqual((await stripeRows(who)).map((r) => r.status), ['expired']);
    assert.deepEqual(await store.runs(who), NO_ACCESS);

    // after a refund the row stays ended whatever Stripe says about the subscription later
    const { who: back, sub: paid } = await subscriber('rory.reopened@example.com');
    await deliver({ type: 'charge.refunded', object: { id: store.fake.chargeFor(paid.id), customer: await customerOf(back), refunded: true } });
    store.fake.setSubscription(paid.id, { status: 'active', canceled_at: null, ended_at: null, current_period_end: daysFromNowUnix(30) });
    await notify(back, 'customer.subscription.updated');
    assert.deepEqual((await stripeRows(back)).map((r) => [r.status, r.note]), [['revoked', 'Refunded']]);
    assert.deepEqual(await store.runs(back), NO_ACCESS);
  });

  test('a notice is asked for again when Stripe cannot be reached', async () => {
    const ned = await legacyUser('ned.network@example.com');
    await store.subscribe(ned);
    const event = { id: 'evt_test_retry_0001', type: 'checkout.session.completed', object: { customer: await customerOf(ned) } };
    store.fake.failNext('listSubscriptions');
    const failed = await deliver(event);
    assert.equal(failed.status, 500);
    assert.equal((await db.query('select id from stripe_events where id = $1', [event.id])).length, 0);
    assert.equal((await stripeRows(ned)).length, 0);

    assert.deepEqual(await deliver(event), RECEIVED, 'the same event, sent again, is handled');
    assert.deepEqual((await stripeRows(ned)).map((r) => r.status), ['trial']);
    assert.equal((await db.query('select type from stripe_events where id = $1', [event.id]))[0].type, 'checkout.session.completed');
  });

  test('a notice for a customer we do not know is accepted and ignored', async () => {
    const [{ n: before }] = await db.query('select count(*)::int as n from entitlements', []);
    const calls = store.fake.calls.length;
    assert.deepEqual(await deliver({ type: 'customer.subscription.updated', object: { customer: 'cus_nobody_here' } }), RECEIVED);
    assert.deepEqual(await deliver({ type: 'charge.refunded', object: { id: 'ch_unknown', customer: 'cus_nobody_here', refunded: true } }), RECEIVED);
    assert.deepEqual(await deliver({ type: 'invoice.paid', object: {} }), RECEIVED, 'no customer at all');
    assert.deepEqual(await deliver({ type: 'customer.created', object: { id: 'cus_new' } }), RECEIVED, 'a type we do not act on');
    assert.equal((await db.query('select count(*)::int as n from entitlements', []))[0].n, before);
    assert.equal(store.fake.calls.length, calls, 'Stripe was not called');
  });

  test('a partial refund changes nothing', async () => {
    const { who, sub } = await subscriber('pru.partial@example.com');
    const cancels = store.fake.callsTo('cancelSubscription').length;
    const charge = store.fake.chargeFor(sub.id);
    assert.deepEqual(await deliver({ type: 'charge.refunded', object: { id: charge, customer: await customerOf(who), refunded: false, amount_refunded: 100 } }), RECEIVED);
    assert.deepEqual((await stripeRows(who)).map((r) => [r.status, r.note]), [['trial', null]]);
    assert.equal(store.fake.callsTo('cancelSubscription').length, cancels);
    assert.equal((await store.runs(who)).status, 200);
  });

  test('old event ids are cleared out as new ones arrive', async () => {
    await db.query(`insert into stripe_events (id, type, received_at) values ('evt_test_ancient', 'invoice.paid', now() - interval '31 days'), ('evt_test_recent', 'invoice.paid', now() - interval '29 days') returning id`, []);
    await deliver({ type: 'customer.created', object: {} });
    const left = (await db.query(`select id from stripe_events where id in ('evt_test_ancient', 'evt_test_recent')`, [])).map((r) => r.id);
    assert.deepEqual(left, ['evt_test_recent']);
  });

  test('no card details are stored', async () => {
    const { who, sub } = await subscriber('nina.nocard@example.com', 'annual');
    await deliver({ type: 'charge.refunded', object: { id: store.fake.chargeFor(sub.id), customer: await customerOf(who), refunded: true, payment_method_details: { card: { last4: '4242', brand: 'visa' } } } });
    const columns = async (table) =>
      (await db.query('select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1', [table])).map((r) => r.column_name).sort();
    assert.deepEqual(await columns('stripe_events'), ['id', 'received_at', 'type']);
    for (const table of ['users', 'entitlements', 'stripe_events']) {
      assert.equal((await columns(table)).some((name) => /card|payment_method|last4|iban/.test(name)), false, table);
    }
    // the only things from Stripe on the account are its customer id and its subscription id
    const user = await userRow(who.user.id);
    const fromStripe = (row) => Object.entries(row).filter(([, v]) => typeof v === 'string' && /^(cus|sub|evt|ch|pi|pm|cs|in|card|price)_/.test(v));
    assert.deepEqual(fromStripe(user).map(([k, v]) => [k, v.slice(0, 4)]), [['stripe_customer_id', 'cus_']]);
    for (const row of await entitlementsOf(who.user.id)) {
      assert.deepEqual(fromStripe(row).map(([k, v]) => [k, v.slice(0, 4)]), [['external_id', 'sub_']]);
    }
    const events = await db.query('select * from stripe_events', []);
    assert.ok(events.length > 0);
    for (const event of events) assert.match(event.id, /^evt_/);
    assert.equal(JSON.stringify([user, await entitlementsOf(who.user.id), events]).includes('4242'), false);
  });
});

describe('when the webhook is late', () => {
  let store;
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };
  const customerOf = async (who) => (await userRow(who.user.id)).stripe_customer_id;
  const stripeRows = async (who) => (await entitlementsOf(who.user.id)).filter((r) => r.source === 'stripe');
  const listCalls = (fake, customer) => fake.callsTo('listSubscriptions').filter((c) => c.args.customerId === customer).length;

  before(async () => {
    store = await shop();
  });
  after(async () => {
    await store?.close();
  });

  test('a payer whose webhook never arrives is let in on return from checkout', async () => {
    const wes = await legacyUser('wes.waiting@example.com');
    await store.subscribe(wes, 'annual');
    assert.deepEqual(await store.runs(wes), NO_ACCESS);

    const res = await store.subscription(wes, { action: 'refresh' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.allowed, true);
    assert.deepEqual(
      [res.data.selling, res.data.trial_available, res.data.customer, res.data.duplicate, res.data.subscription.status, res.data.subscription.plan],
      [true, false, true, false, 'trial', 'annual']
    );
    assert.equal((await store.runs(wes)).status, 200);
    assert.ok((await userRow(wes.user.id)).trial_used_at);
  });

  test('refresh for someone who abandoned checkout stays closed', async () => {
    const abe = await legacyUser('abe.abandoned@example.com');
    assert.equal((await store.subscription(abe, { action: 'checkout', plan: 'monthly' })).status, 200);
    const res = await store.subscription(abe, { action: 'refresh' });
    assert.deepEqual(res, {
      status: 200,
      data: { selling: true, trial_available: true, customer: true, subscription: null, duplicate: false, allowed: false },
    });
    assert.equal((await stripeRows(abe)).length, 0);
    assert.deepEqual(await store.runs(abe), NO_ACCESS);
    // someone who never started checkout: nothing to ask Stripe about
    const nell = await legacyUser('nell.never@example.com');
    const calls = store.fake.calls.length;
    assert.equal((await store.subscription(nell, { action: 'refresh' })).data.allowed, false);
    assert.equal(store.fake.calls.length, calls);
  });

  test("refresh cannot be pointed at someone else's subscription", async () => {
    const payer = await legacyUser('vera.victim@example.com');
    const paid = await store.subscribe(payer);
    const session = store.sessionOf(payer);
    const thief = await legacyUser('theo.thief@example.com');
    await store.subscription(thief, { action: 'checkout', plan: 'monthly' });

    const res = await store.subscription(thief, {
      action: 'refresh',
      subscription_id: paid.id, subscription: paid.id, customer: session.customer, customer_id: session.customer,
      session_id: session.id, user_id: payer.user.id,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.allowed, false);
    assert.equal((await stripeRows(thief)).length, 0);
    assert.deepEqual(await store.runs(thief), NO_ACCESS);
    assert.equal(listCalls(store.fake, session.customer), 0, "the payer's customer was never asked about");
    // and the payer still gets what they paid for
    assert.equal((await store.subscription(payer, { action: 'refresh' })).data.allowed, true);
    assert.deepEqual((await stripeRows(payer)).map((r) => r.external_id), [paid.id]);
  });

  test('a lost renewal is repaired when the phone asks for its status', async () => {
    const lola = await legacyUser('lola.lost@example.com');
    const sub = await store.subscribe(lola);
    await store.subscription(lola, { action: 'refresh' });
    // the period ended five days ago as far as we know; the renewal notice never came
    await db.query(`update entitlements set status = 'active', expires_at = $2 where user_id = $1 and source = 'stripe' returning id`, [lola.user.id, daysFromNow(-5)]);
    assert.deepEqual(await store.runs(lola), NO_ACCESS);
    store.fake.setSubscription(sub.id, { status: 'active', current_period_start: daysFromNowUnix(-5), current_period_end: daysFromNowUnix(25) });

    const customer = await customerOf(lola);
    const before = listCalls(store.fake, customer);
    const status = await store.access(lola);
    assert.equal(status.status, 200);
    assert.deepEqual(Object.keys(status.data).sort(), ['allowed', 'cancel_at_period_end', 'expires_at', 'plan', 'reason', 'source', 'subscriptions'], 'the shape the phone knows');
    assert.deepEqual([status.data.allowed, status.data.reason, status.data.source], [true, 'subscription', 'stripe']);
    const [row] = await stripeRows(lola);
    assert.ok(new Date(row.expires_at).getTime() > Date.now() + 24 * 24 * 60 * 60 * 1000, 'the row has the new end date');
    assert.equal(listCalls(store.fake, customer), before + 1);
    // someone who has access is never a reason to call Stripe
    await store.access(lola);
    assert.equal(listCalls(store.fake, customer), before + 1);
  });

  test('a status check asks Stripe at most once in five minutes, and only for an account that has a customer', async () => {
    const gone = await legacyUser('gil.gone@example.com');
    const sub = await store.subscribe(gone);
    store.fake.setSubscription(sub.id, { status: 'canceled', canceled_at: daysFromNowUnix(0), ended_at: daysFromNowUnix(0) });
    const customer = await customerOf(gone);
    assert.equal((await store.access(gone)).data.allowed, false);
    assert.equal(listCalls(store.fake, customer), 1);
    assert.equal((await store.access(gone)).data.allowed, false);
    assert.equal((await store.access(gone)).data.allowed, false);
    assert.equal(listCalls(store.fake, customer), 1, 'the second and third checks made no call');

    const never = await legacyUser('nora.nocustomer@example.com');
    const calls = store.fake.calls.length;
    assert.equal((await store.access(never)).data.allowed, false);
    assert.equal(store.fake.calls.length, calls);
  });

  test('the status check still answers when Stripe is down', async () => {
    const dot = await legacyUser('dot.down@example.com');
    await store.subscribe(dot);
    store.fake.failNext('listSubscriptions');
    const res = await store.access(dot);
    assert.equal(res.status, 200);
    assert.equal(res.data.allowed, false);
    assert.equal(res.data.subscriptions, true);
  });

  test('looking after a subscription needs the keys, not the switch', async () => {
    const kit = await legacyUser('kit.keys@example.com');
    const sub = await store.subscribe(kit);
    // the owner has switched SUBSCRIPTIONS off again; the keys are still there
    const keysOnly = await startApp({ stripe: TEST_STRIPE }, { stripe: store.fake });
    // and here the keys are gone altogether
    const noKeys = await startApp({ subscriptions: true }, { stripe: store.fake });
    const ask = (app, body) => call('POST', '/api/functions/subscription', { token: kit.token, body, origin: app.origin });
    try {
      const refreshed = await ask(keysOnly, { action: 'refresh' });
      assert.deepEqual([refreshed.status, refreshed.data.allowed, refreshed.data.selling], [200, true, false]);
      assert.equal((await ask(keysOnly, { action: 'portal' })).status, 200);
      assert.deepEqual((await stripeRows(kit)).map((r) => r.external_id), [sub.id]);

      for (const action of ['refresh', 'portal', 'resume']) {
        assert.deepEqual(await ask(noKeys, { action }), UNAVAILABLE, action);
      }
    } finally {
      await keysOnly.close();
      await noKeys.close();
    }
  });

  test("the portal link is made for the account's own customer", async () => {
    const mo = await legacyUser('mo.manages@example.com');
    await store.subscribe(mo);
    await store.subscription(mo, { action: 'refresh' });
    const res = await store.subscription(mo, { action: 'portal', customer: 'cus_someone_else', return_url: 'https://evil.example/' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const made = store.fake.callsTo('createPortalSession').at(-1).args;
    assert.equal(made.customerId, await customerOf(mo));
    assert.equal(made.returnUrl, `${testConfig.appUrl}/settings?billing=updated`);
    assert.equal(made.cancelSubscriptionId ?? null, null);
    assert.deepEqual(res.data, { url: store.fake.state.portals.at(-1).url });
  });

  test("the cancel link names the account's subscription", async () => {
    const cy = await legacyUser('cy.cancel@example.com');
    const sub = await store.subscribe(cy);
    await store.subscription(cy, { action: 'refresh' });
    const res = await store.subscription(cy, { action: 'portal', flow: 'cancel', subscription: 'sub_someone_else' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const made = store.fake.callsTo('createPortalSession').at(-1).args;
    assert.deepEqual([made.customerId, made.cancelSubscriptionId], [await customerOf(cy), sub.id]);
  });

  test('no customer, no portal', async () => {
    const ann = await legacyUser('ann.nothing@example.com');
    const calls = store.fake.calls.length;
    for (const body of [{ action: 'portal' }, { action: 'portal', flow: 'cancel' }]) {
      assert.deepEqual(await store.subscription(ann, body), { status: 404, data: { error: 'You do not have a subscription to manage.' } });
    }
    assert.equal(store.fake.calls.length, calls);
  });

  test('resume clears the end date at Stripe and here', async () => {
    const ray = await legacyUser('ray.resumes@example.com');
    const sub = await store.subscribe(ray);
    store.fake.setSubscription(sub.id, { cancel_at_period_end: true });
    assert.equal((await store.subscription(ray, { action: 'refresh' })).data.subscription.cancel_at_period_end, true);

    const res = await store.subscription(ray, { action: 'resume' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual([res.data.subscription.status, res.data.subscription.cancel_at_period_end], ['trial', false]);
    assert.deepEqual(store.fake.callsTo('setCancelAtPeriodEnd').at(-1).args, { subscriptionId: sub.id, value: false });
    assert.equal(store.fake.state.subscriptions.get(sub.id).cancel_at_period_end, false);
    assert.equal((await stripeRows(ray))[0].cancel_at_period_end, false);
  });

  test('resume with nothing to resume', async () => {
    const NOTHING = { status: 400, data: { error: 'Your subscription is not set to end, so there is nothing to resume.' } };
    const sam = await legacyUser('sam.steady@example.com');
    assert.deepEqual(await store.subscription(sam, { action: 'resume' }), NOTHING, 'no subscription at all');
    await store.subscribe(sam);
    await store.subscription(sam, { action: 'refresh' });
    const calls = store.fake.callsTo('setCancelAtPeriodEnd').length;
    assert.deepEqual(await store.subscription(sam, { action: 'resume' }), NOTHING, 'one that is not ending');
    assert.equal(store.fake.callsTo('setCancelAtPeriodEnd').length, calls);
  });

  test('a Stripe failure in any of them is the same clear 502', async () => {
    const zed = await legacyUser('zed.zapped@example.com');
    const sub = await store.subscribe(zed);
    await store.subscription(zed, { action: 'refresh' });
    store.fake.setSubscription(sub.id, { cancel_at_period_end: true });
    await store.subscription(zed, { action: 'refresh' });

    store.fake.failNext('listSubscriptions');
    assert.deepEqual(await store.subscription(zed, { action: 'refresh' }), PROVIDER_DOWN);
    store.fake.failNext('createPortalSession');
    assert.deepEqual(await store.subscription(zed, { action: 'portal' }), PROVIDER_DOWN);
    store.fake.failNext('setCancelAtPeriodEnd');
    assert.deepEqual(await store.subscription(zed, { action: 'resume' }), PROVIDER_DOWN);
    assert.equal((await stripeRows(zed))[0].cancel_at_period_end, true, 'nothing changed here');
  });
});

describe('your data: an account with a subscription', () => {
  let store;
  const NOT_DELETED = {
    status: 502,
    data: { error: 'We could not cancel your subscription, so your account was not deleted. Try again in a few minutes, or email info@dtisys.com.' },
  };
  const remove = (app, who, password = 'correct-horse-1') =>
    call('DELETE', '/api/auth/me', { token: who.token, body: { password }, origin: app.origin });
  const login = (email) => call('POST', '/api/auth/login', { body: { email, password: 'correct-horse-1' } });

  before(async () => {
    store = await shop();
  });
  after(async () => {
    await store?.close();
  });

  test('deleting an account deletes its Stripe customer first', async () => {
    const del = await legacyUser('del.deletes@example.com');
    const sub = await store.subscribe(del);
    await store.subscription(del, { action: 'refresh' });
    const customer = (await userRow(del.user.id)).stripe_customer_id;
    // the customer is deleted while the account still exists: the fake looks when it is called
    let accountThere = null;
    const real = store.fake.deleteCustomer;
    store.fake.deleteCustomer = async (id) => {
      accountThere = Boolean(await userRow(del.user.id));
      return real(id);
    };
    try {
      assert.deepEqual(await remove(store, del), { status: 200, data: { ok: true, deleted: true } });
    } finally {
      store.fake.deleteCustomer = real;
    }
    assert.equal(accountThere, true);
    assert.deepEqual(store.fake.callsTo('deleteCustomer').at(-1).args, { customerId: customer });
    assert.equal(store.fake.state.customers.get(customer).deleted, true);
    assert.equal(store.fake.state.subscriptions.get(sub.id).status, 'canceled', 'so nothing is billed again');
    assert.equal(await userRow(del.user.id), undefined);
    assert.equal((await entitlementsOf(del.user.id)).length, 0);
    assert.equal((await login('del.deletes@example.com')).status, 401);
  });

  test('the account is kept when Stripe cannot be reached', async () => {
    const kay = await legacyUser('kay.kept@example.com');
    const sub = await store.subscribe(kay);
    await store.subscription(kay, { action: 'refresh' });
    store.fake.failNext('deleteCustomer');
    assert.deepEqual(await remove(store, kay), NOT_DELETED);
    assert.ok(await userRow(kay.user.id));
    assert.equal((await login('kay.kept@example.com')).status, 200, 'the person can still sign in');
    assert.equal((await store.runs(kay)).status, 200, 'and still has what they pay for');
    assert.equal(store.fake.state.subscriptions.get(sub.id).status, 'trialing');

    assert.deepEqual(await remove(store, kay), { status: 200, data: { ok: true, deleted: true } }, 'trying again succeeds');
    assert.equal(await userRow(kay.user.id), undefined);
    assert.equal(store.fake.state.subscriptions.get(sub.id).status, 'canceled');
  });

  test('the account is kept when the keys have been removed', async () => {
    const ken = await legacyUser('ken.keyless@example.com');
    await store.subscribe(ken);
    const calls = store.fake.callsTo('deleteCustomer').length;
    // the main app has no Stripe settings at all
    assert.deepEqual(await call('DELETE', '/api/auth/me', { token: ken.token, body: { password: 'correct-horse-1' } }), NOT_DELETED);
    assert.ok(await userRow(ken.user.id));
    assert.equal(store.fake.callsTo('deleteCustomer').length, calls);
    // with the switch off but the keys present, it works
    const keysOnly = await startApp({ stripe: TEST_STRIPE }, { stripe: store.fake });
    try {
      assert.equal((await remove(keysOnly, ken)).status, 200);
    } finally {
      await keysOnly.close();
    }
    assert.equal(await userRow(ken.user.id), undefined);
  });

  test('a wrong password never reaches Stripe', async () => {
    const wyn = await legacyUser('wyn.wrong@example.com');
    await store.subscribe(wyn);
    const calls = store.fake.callsTo('deleteCustomer').length;
    assert.deepEqual(await remove(store, wyn, 'not-the-password'), { status: 401, data: { error: 'Enter your current password to delete your account.' } });
    assert.equal(store.fake.callsTo('deleteCustomer').length, calls);
    assert.ok(await userRow(wyn.user.id));
  });

  test('an account that never subscribed is deleted with no Stripe call', async () => {
    const nan = await legacyUser('nan.never@example.com');
    const calls = store.fake.calls.length;
    assert.deepEqual(await remove(store, nan), { status: 200, data: { ok: true, deleted: true } });
    assert.equal(store.fake.calls.length, calls);
    assert.equal(await userRow(nan.user.id), undefined);
  });

  test('the cancellation notice that follows a deleted account is accepted', async () => {
    const bye = await legacyUser('bye.bye@example.com');
    const sub = await store.subscribe(bye);
    const customer = (await userRow(bye.user.id)).stripe_customer_id;
    assert.equal((await remove(store, bye)).status, 200);
    const calls = store.fake.callsTo('listSubscriptions').length;
    const { body, header } = signedEvent(TEST_STRIPE.webhookSecret, { type: 'customer.subscription.deleted', object: { id: sub.id, customer, status: 'canceled' } });
    const res = await store.on('POST', '/api/stripe/webhook', { raw: body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header } });
    assert.deepEqual(res, { status: 200, data: { received: true } });
    assert.equal(store.fake.callsTo('listSubscriptions').length, calls);
    assert.equal((await db.query(`select id from entitlements where external_id = $1`, [sub.id])).length, 0);
  });
});

describe('trial reminder', () => {
  const HOUR_MS = 60 * 60 * 1000;
  let seq = 0;
  // An account with one Stripe row, written straight into the table.
  async function withRow(name, { status = 'trial', plan = 'monthly', endsInHours = 36, cancelled = false, source = 'stripe' } = {}) {
    const who = await legacyUser(`${name}@example.com`);
    seq += 1;
    await db.query(
      `insert into entitlements (user_id, source, status, plan, expires_at, cancel_at_period_end, external_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [who.user.id, source, status, source === 'stripe' ? plan : null, source === 'stripe' ? new Date(Date.now() + endsInHours * HOUR_MS).toISOString() : null, cancelled, source === 'stripe' ? `sub_reminder_${seq}` : null]
    );
    return who;
  }
  // Collects what would have been mailed; `answer` is what the mail provider said.
  function outbox(answer = { delivered: true }) {
    const sent = [];
    return { sent, send: async (_config, message) => (sent.push(message), answer), to: (who) => sent.filter((m) => m.to === who.user.email) };
  }
  const sweep = (box, config = testConfig, now = new Date()) => sendTrialReminders({ db, config, now, send: box.send });
  const claimed = async (who) => (await entitlementsOf(who.user.id))[0].trial_reminder_sent_at;

  test('a trial ending within two days gets one reminder', async () => {
    const mona = await withRow('mona.monthly', { plan: 'monthly', endsInHours: 36 });
    const anna = await withRow('anna.annual', { plan: 'annual', endsInHours: 47 });
    const box = outbox();
    const count = await sweep(box);
    assert.ok(count >= 2);

    const [monthly] = box.to(mona);
    const [row] = await entitlementsOf(mona.user.id);
    const day = formatDay(row.expires_at);
    assert.match(day, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    assert.equal(monthly.subject, `Your VantraRun free trial ends on ${day}`);
    assert.equal(
      monthly.text,
      `Your VantraRun free trial ends on ${day}. On that day your card will be charged $4.99 for the monthly plan, and it renews every month at that price until you cancel.\n\n` +
        `To cancel before you are charged, sign in at ${testConfig.appUrl}/settings and choose "Cancel subscription". You keep access until the trial ends and pay nothing.\n\n` +
        'Questions: info@dtisys.com'
    );
    const [annual] = box.to(anna);
    assert.match(annual.text, /your card will be charged \$49\.99 for the annual plan, and it renews every year at that price until you cancel\./);
    assert.ok(await claimed(mona));

    // a second sweep, and a third an hour later, send nothing more
    const again = outbox();
    assert.equal(await sweep(again), 0);
    assert.equal(await sweep(again, testConfig, new Date(Date.now() + HOUR_MS)), 0);
    assert.equal(again.sent.length, 0);
    assert.equal(box.to(mona).length, 1);
  });

  test('no reminder three days out, none after the trial has ended', async () => {
    const early = await withRow('earl.early', { endsInHours: 72 });
    const late = await withRow('lane.late', { endsInHours: -1 });
    const box = outbox();
    await sweep(box);
    assert.equal(box.to(early).length, 0);
    assert.equal(box.to(late).length, 0);
    assert.equal(await claimed(early), null);
    // a day later the first one is inside the two days
    await sweep(box, testConfig, new Date(Date.now() + 25 * HOUR_MS));
    assert.equal(box.to(early).length, 1);
  });

  test('no reminder for a trial already cancelled, an active subscription or a free pass', async () => {
    const cancelled = await withRow('cal.cancelled', { cancelled: true });
    const active = await withRow('ada.active', { status: 'active' });
    const free = await withRow('finn.free', { source: 'admin', status: 'active' });
    const expired = await withRow('exa.expired', { status: 'expired' });
    const box = outbox();
    await sweep(box);
    for (const who of [cancelled, active, free, expired]) {
      assert.equal(box.to(who).length, 0, who.user.email);
      assert.equal(await claimed(who), null);
    }
  });

  test('a refused message is tried again', async () => {
    const rita = await withRow('rita.refused');
    const withKey = { ...testConfig, mail: { ...testConfig.mail, resendApiKey: 're_test_not_real' } };
    const refused = outbox({ delivered: false });
    const before = await sweep(refused, withKey);
    assert.equal(refused.to(rita).length, 1, 'it was attempted');
    assert.equal(before, 0, 'and not counted as sent');
    assert.equal(await claimed(rita), null, 'the claim was cleared');

    const broken = { sent: [], send: async () => { throw new Error('mail provider timed out'); } };
    assert.equal(await sweep(broken, withKey), 0);
    assert.equal(await claimed(rita), null);

    const ok = outbox();
    assert.equal(await sweep(ok, withKey), 1);
    assert.equal(ok.to(rita).length, 1);
    assert.ok(await claimed(rita));
  });

  test('without a mail key the reminder is printed like every other email, once', async () => {
    const dev = await withRow('devon.dev');
    // no key: sendMail answers { delivered: false } after printing, which is not a refusal
    const box = outbox({ delivered: false });
    assert.equal(await sweep(box), 1);
    assert.ok(await claimed(dev));
    assert.equal(await sweep(box), 0);
  });
});
