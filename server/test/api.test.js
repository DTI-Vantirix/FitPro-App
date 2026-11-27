// End-to-end API tests against a real Postgres database.
//   TEST_DATABASE_URL=postgres://fitpro:fitpro@localhost:5432/fitpro_test npm test
// The test database is wiped at the start of every run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { GRACE_DAYS, accessOf, grantFree, hasAccess } from '../src/access.js';
import { createApp } from '../src/app.js';
import { SERVER_ROOT, loadConfig } from '../src/config.js';
import { bootstrapAdmin } from '../src/auth/bootstrap.js';
import { hashPassword } from '../src/auth/crypto.js';
import { loadRegistry } from '../src/entities/registry.js';
import { migrate } from '../src/migrate.js';
import { createPsqlDb } from './psql-db.js';

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

// An account that has access through an invite code, without going through sign-up.
async function invitedUser(email) {
  const account = await legacyUser(email);
  const code = await mintCode();
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
async function startApp(overrides) {
  const other = http.createServer(createApp({ db, config: { ...testConfig, ...overrides }, registry }));
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
    const insert = (source, status, externalId) =>
      db.query('insert into entitlements (user_id, source, status, external_id) values ($1, $2, $3, $4) returning id', [user.id, source, status, externalId]);
    await assert.rejects(insert('paypal', 'active', null));
    await assert.rejects(insert('stripe', 'paused', null));
    await assert.rejects(insert('invite', 'active', null), 'bob already has his invite row');
    await insert('apple', 'expired', 'orig-tx-1');
    await assert.rejects(insert('apple', 'active', 'orig-tx-1'));
    await db.query(`delete from entitlements where user_id = $1 and source = 'apple' returning id`, [user.id]);
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

describe('the server refuses product calls without access', () => {
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };
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
      assert.equal(refused.data.error, 'Subscribe or enter an invite code to use VantraRun.');
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
  const NO_ACCESS = { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } };
  let open; // the API with SUBSCRIPTIONS=on
  const on = (method, url, options = {}) => call(method, url, { ...options, origin: open.origin });
  const register = (body) => on('POST', '/api/auth/register', { body });
  const verify = (email, code) => on('POST', '/api/auth/verify-otp', { body: { email, otp_code: code } });

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
    assert.deepEqual(await call('POST', '/api/auth/register', { body }), { status: 400, data: { error: 'Enter your invite code.' } });
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
    assert.deepEqual(await call('POST', '/api/entities/Run/query', { token, body: {} }), NO_ACCESS);

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
    await signUpWith('first.on@example.com', used);
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
    assert.deepEqual(res, { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } });
    assert.equal((await db.query('select id from runs where created_by_id = $1', [lee.user.id])).length, 0);
    // and they cannot read runs either: the whole product is closed, not only the upload
    const mine = await call('POST', '/api/entities/Run/query', { token: lee.token, body: {} });
    assert.deepEqual(mine, { status: 403, data: { error: 'Subscribe or enter an invite code to use VantraRun.' } });
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
