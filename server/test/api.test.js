// End-to-end API tests against a real Postgres database.
//   TEST_DATABASE_URL=postgres://fitpro:fitpro@localhost:5432/fitpro_test npm test
// The test database is wiped at the start of every run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
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
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-uploads-'));

async function call(method, url, { body, token, headers = {}, raw } = {}) {
  const res = await fetch(base + url, {
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

// An account from before sign-up needed a code: verified, but no accepted invite.
async function legacyUser(email) {
  const account = await signUp(email);
  await db.query('delete from access_grants where user_id = $1 returning id', [account.user.id]);
  return account;
}

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
  const config = { ...loadConfig({ NODE_ENV: 'test' }), uploadDir, routerUrl: 'off' };
  const registry = await loadRegistry(db);
  server = http.createServer(createApp({ db, config, registry }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log = () => {}; // silence request logs
});

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

    assert.deepEqual((await call('POST', '/api/functions/inviteAccess', { token: nina.token, body: { action: 'status' } })).data, { allowed: false });
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

    assert.deepEqual((await call('POST', '/api/functions/inviteAccess', { token: admin.token, body: {} })).data, { allowed: true, admin: true });
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
    assert.deepEqual(status.data, { allowed: true });
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
    assert.deepEqual(res, { status: 403, data: { error: 'Redeem your invite code before syncing activities.' } });
    const mine = await call('POST', '/api/entities/Run/query', { token: lee.token, body: {} });
    assert.equal(mine.data.items.length, 0);
  });

  test('admins upload without a code', async () => {
    await db.query('delete from access_grants where user_id = $1 returning id', [admin.user.id]);
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
            + (select count(*) from access_grants where user_id = $1)::int as n`,
      [alice.user.id]
    );
    assert.equal(n, 0, 'everything the user owned is gone');
    const [code] = await db.query(`select status, used_by_id from invite_codes where used_by_email = 'alice@example.com'`, []);
    assert.equal(code.status, 'used');
    assert.equal(code.used_by_id ?? null, null, 'invite history keeps the code but forgets the user');
  });
});
