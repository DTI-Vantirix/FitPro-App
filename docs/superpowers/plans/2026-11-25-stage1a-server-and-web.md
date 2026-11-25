# Stage 1A — Server and Web Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API and website ready for the native run coach: sign-up needs the owner's code, the server accepts runs recorded by FitPro itself with heart-rate stats, serves turn directions for a saved route, and gym is hidden on the website.

**Architecture:** All changes extend what exists: new numbered migrations, new optional fields on the single `ingestActivity` write path, one new backend function, and UI removals in the web app. Nothing is deleted from the database. The native app (Plan 1B) and hosting/store builds (Plan 1C) build on the interfaces this plan produces.

**Tech Stack:** Node 20+ (`node:http`, `pg`), Postgres 16, `node:test`; React + Vite web app.

**Spec:** `docs/superpowers/specs/2026-11-25-native-run-coach-design.md`

**Plan sequence:** 1A (this) → 1B native run core → 1C hosting, EAS builds, tester rollout. 1B and 1C are written after 1A lands, against the interfaces below.

## Global Constraints

- Schema changes go in a **new** numbered file in `server/migrations/`; never edit `001_init.sql`.
- A new column needs the matching property in `server/entities/<Entity>.json`; the API refuses to start if they disagree.
- Changing `ingestActivity` means changing `docs/native-contract.md` and the tests in `server/test/api.test.js` **in the same commit**.
- Access-rule changes need a test showing who can and can't see the record.
- All API errors are `{ "error": "<message>" }`, written for a human.
- No third-party analytics, ad SDKs or session recording.
- Gym is **hidden, not deleted**: keep the `workouts` table, the `workout` ingest kind, existing data, and the gym source files.
- An optional field on a FitPro-recorded run must never cause the upload to be rejected (runs are queued offline and retried); invalid optional values are dropped.
- Never commit `server/.env`.
- Checks before finishing any task: `npm test`, `npm run lint`, `npm run build` (repo root). `npm test` needs the Docker database up (`npm run db:up`) and `TEST_DATABASE_URL` from `server/.env`.

## Review Focus

1. A person registers with a code and never verifies their email → the code is still available for someone else. (Task 1)
2. A code typed in lower case or with spaces around it at sign-up → accepted. (Task 1)
3. An account created before this change, verified but with no accepted code → can still sign in and redeem a code afterwards. (Task 1)
4. A FitPro run uploaded twice (retry after a dropped connection), or referencing a route that was deleted while the run sat in the offline queue → one saved run, route link dropped, no error. (Task 3)
5. The watch's copy of a run is imported **before** FitPro's own upload arrives → FitPro's upload still succeeds; both records exist (documented gap, not silently merged). (Task 4)

---

### Task 1: Sign-up requires the owner's code

**Files:**
- Create: `server/migrations/002_signup_invite.sql`
- Modify: `server/src/auth/routes.js` (register, verify-otp), `server/src/functions/inviteAccess.js`, `server/test/api.test.js`, `docs/native-contract.md` (sign-up paragraph), `docs/decisions.md`
- Modify: `web/src/pages/Register.jsx`, `web/src/api/client.js` (register call)

**Interfaces:**
- Produces: `POST /api/auth/register` body `{ email, password, full_name?, invite_code }`.
- Produces: in `inviteAccess.js`, `export async function hasAccess(db, user): Promise<boolean>` (admin or has a grant) and `export async function claimInvite(tx, user, code): Promise<boolean>` (atomic claim + grant; `false` when the code is no longer available). The existing `redeem` action is refactored to use `claimInvite`.

Behaviour to implement:
- Migration: `alter table users add column pending_invite_code text;` If the API refuses to start because of the new column, treat it the way `password_hash` is treated (not exposed by `publicUser`).
- Register: normalise the code with `trim().toUpperCase()`. Missing → `400 "Enter your invite code."`. Not found → `400 "That code is not recognised."`. Status not `available` → `400 "That code has already been used."`. Otherwise store it in `pending_invite_code` (also on the "unfinished sign-up, start over" path). The code is **not** claimed at register.
- Verify-otp: in one transaction, if the user has no grant and has a `pending_invite_code`, call `claimInvite`; on `false` roll back and answer `409 "That invite code was just used by someone else. Ask for a new one."`; on success set `email_verified_at` and clear `pending_invite_code`. A user with no pending code (legacy account) verifies as before.
- Web: add a required "Invite code" field to the register form and send it as `invite_code`; show the server's error message under the field.

- [ ] **Step 1: Update the test helper so every existing test still signs up**

In `server/test/api.test.js` add `mintCode()` (inserts an `available` row into `invite_codes` with a unique `FP-XXXX-XXXX` code and returns the code) and make `signUp(email, password)` pass `invite_code: await mintCode()`. Add `legacyUser(email)` = `signUp` then `delete from access_grants where user_id = $1`, for tests that need an account with no accepted code. Switch the `invite access` describe to two `legacyUser` accounts, and rewrite its absolute `stats` / `grants.length` assertions as before/after differences.

- [ ] **Step 2: Write the failing tests** (new `describe('sign-up needs a code')`)

```js
test('no code, unknown code and used code are refused', async () => {
  const body = { email: 'erin@example.com', password: 'longenough1' };
  assert.equal((await call('POST', '/api/auth/register', { body })).data.error, 'Enter your invite code.');
  assert.equal((await call('POST', '/api/auth/register', { body: { ...body, invite_code: 'FP-NOPE-NOPE' } })).data.error, 'That code is not recognised.');
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
  assert.deepEqual(row, { status: 'used', used_by_email: 'gina@example.com' });
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

test('an older account with no code can still sign in and redeem one', async () => {
  const kim = await legacyUser('kim@example.com');
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'kim@example.com', password: 'correct-horse-1' } })).status, 200);
  const res = await call('POST', '/api/functions/inviteAccess', { token: kim.token, body: { action: 'redeem', code: await mintCode() } });
  assert.deepEqual(res.data, { allowed: true });
});
```

`signUpWith(email, code)` is `signUp` with an explicit code.

- [ ] **Step 3: Run `npm test`** — expected: the five new tests FAIL (register ignores `invite_code`).
- [ ] **Step 4: Implement** the migration, `hasAccess`, `claimInvite`, and the register / verify-otp changes described above.
- [ ] **Step 5: Run `npm test`** — expected: all pass.
- [ ] **Step 6: Web register form.** Add the field and pass `invite_code` through `web/src/api/client.js`. Run `npm run lint` and `npm run build` — expected: both clean.
- [ ] **Step 7: Docs.** In `docs/native-contract.md` change the sign-up sentence to include `invite_code`; in `docs/decisions.md` record "2026-11-25 — Sign-up requires an invite code" and close open question 1 (invite-only testing).
- [ ] **Step 8: Commit** — `feat: require an invite code at sign-up`

---

### Task 2: The server refuses activity uploads without an accepted code

**Files:**
- Modify: `server/src/functions/ingestActivity.js`, `server/test/api.test.js`, `docs/native-contract.md`, `docs/decisions.md`

**Interfaces:**
- Consumes: `hasAccess(db, user)` from Task 1.
- Produces: `ingestActivity` answers `403 { "error": "Redeem your invite code before syncing activities." }` for a non-admin with no grant.

- [ ] **Step 1: Write the failing test**

```js
test('no accepted invite code -> 403, nothing stored', async () => {
  const lee = await legacyUser('lee@example.com');
  const res = await call('POST', '/api/functions/ingestActivity', { token: lee.token, body: run });
  assert.deepEqual(res, { status: 403, data: { error: 'Redeem your invite code before syncing activities.' } });
  const mine = await call('POST', '/api/entities/Run/query', { token: lee.token, body: {} });
  assert.equal(mine.data.items.length, 0);
});
```

- [ ] **Step 2: Run `npm test`** — expected: FAIL with status 200.
- [ ] **Step 3: Implement** the check at the top of the default export in `ingestActivity.js`.
- [ ] **Step 4: Run `npm test`** — expected: all pass.
- [ ] **Step 5: Docs.** Add the 403 row to the contract's error table; close open question 4 in `docs/decisions.md`.
- [ ] **Step 6: Commit** — `feat: enforce the invite gate on ingestActivity`

---

### Task 3: Runs recorded by FitPro carry their zone and heart-rate stats

**Files:**
- Create: `server/migrations/003_run_heart_rate.sql`
- Modify: `server/entities/Run.json`, `server/src/functions/ingestActivity.js`, `server/test/api.test.js`, `docs/native-contract.md`

**Interfaces:**
- Produces: `runs` columns `min_hr`, `hr_target_min`, `hr_target_max`, `hr_in_zone_pct` (all `double precision`, nullable), with matching `Run.json` properties.
- Produces: `ingestActivity` `kind: "run"` accepts `source: "fitpro"` and these optional fields:

| field | rule (anything outside the rule is dropped, never a 400) |
| --- | --- |
| `route_id` | must be a route the caller owns |
| `target_zone_name` | string, max 80 chars |
| `target_fast_sec`, `target_slow_sec` | both `> 0` and `fast <= slow`; otherwise both dropped |
| `in_zone_pct`, `hr_in_zone_pct` | `0..100`, rounded to a whole number |
| `min_hr`, `hr_target_min`, `hr_target_max` | bpm `20..260`, rounded |

`route_name` defaults to `"Free run"` when `source` is `fitpro`. `external_id` for a FitPro run is an id the phone generates when the run starts.

- [ ] **Step 1: Write the failing tests**

```js
const liveRun = {
  kind: 'run', source: 'fitpro', external_id: 'fp-run-0001',
  distance_mi: 3.1, duration_sec: 1600, started_at: '2026-11-20T12:00:00Z',
  target_zone_name: 'Zone 2', target_fast_sec: 495, target_slow_sec: 540,
  in_zone_pct: 71.6, min_hr: 98.4, avg_hr: 141, max_hr: 163,
  hr_target_min: 125, hr_target_max: 145, hr_in_zone_pct: 64,
};

test('a FitPro run stores its zone and heart-rate stats', async () => {
  const route = await call('POST', '/api/entities/Route', { token: alice.token, body: { name: 'River loop' } });
  const res = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: { ...liveRun, route_id: route.data.id } });
  assert.equal(res.data.action, 'created');
  const stored = (await call('GET', `/api/entities/Run/${res.data.run_id}`, { token: alice.token })).data;
  assert.equal(stored.route_id, route.data.id);
  assert.equal(stored.route_name, 'Free run');
  assert.deepEqual(
    [stored.target_zone_name, stored.target_fast_sec, stored.target_slow_sec, stored.in_zone_pct],
    ['Zone 2', 495, 540, 72]);
  assert.deepEqual(
    [stored.min_hr, stored.max_hr, stored.hr_target_min, stored.hr_target_max, stored.hr_in_zone_pct],
    [98, 163, 125, 145, 64]);
});

test('a retried FitPro upload updates the same run', async () => {
  const again = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: liveRun });
  assert.equal(again.data.action, 'updated');
});

test('bad optional values are dropped, never rejected', async () => {
  const bobRoute = await call('POST', '/api/entities/Route', { token: bob.token, body: { name: 'Not yours' } });
  const res = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: {
    ...liveRun, external_id: 'fp-run-0002', started_at: '2026-11-21T12:00:00Z',
    route_id: bobRoute.data.id, target_fast_sec: 600, target_slow_sec: 500,
    in_zone_pct: 140, min_hr: 5, hr_target_max: 999,
  } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const stored = (await call('GET', `/api/entities/Run/${res.data.run_id}`, { token: alice.token })).data;
  for (const f of ['route_id', 'target_fast_sec', 'target_slow_sec', 'in_zone_pct', 'min_hr', 'hr_target_max']) {
    assert.equal(stored[f] ?? null, null, f);
  }
  assert.equal(stored.hr_target_min, 125);
});

test('a route deleted before the upload arrives does not block it', async () => {
  const res = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: {
    ...liveRun, external_id: 'fp-run-0003', started_at: '2026-11-22T12:00:00Z',
    route_id: '00000000-0000-4000-8000-000000000000',
  } });
  assert.equal(res.data.action, 'created');
});
```

- [ ] **Step 2: Run `npm test`** — expected: FAIL (fields not stored).
- [ ] **Step 3: Implement** the migration, the `Run.json` properties (and add `fitpro` to the `source` description), and the optional-field handling in `ingestRun`. A non-uuid `route_id` must be dropped before it reaches SQL.
- [ ] **Step 4: Run `npm test`** — expected: all pass.
- [ ] **Step 5: Contract doc.** Add `fitpro` to the source list, add the table above to `kind: "run"`, and state the "dropped, never rejected" rule.
- [ ] **Step 6: Commit** (code, tests and contract together) — `feat: accept FitPro-recorded runs with zone and heart-rate stats`

---

### Task 4: An imported copy of a FitPro run is skipped

**Files:**
- Modify: `server/src/functions/ingestActivity.js`, `server/test/api.test.js`, `docs/native-contract.md`

**Interfaces:**
- Produces: for a run whose `source` is not `fitpro`, when the caller has no record yet for that `(source, external_id)` and already has a run with source `fitpro` or `live` whose time span overlaps the incoming one by at least half of the shorter of the two, `ingestActivity` writes nothing and returns
  `{ "ok": true, "kind": "run", "action": "skipped", "reason": "overlaps_fitpro_run", "run_id": "<the FitPro run>", "source": "<incoming source>" }`.
  A run's span is `started_at` to `started_at + duration_sec`.

- [ ] **Step 1: Write the failing tests** (they rely on `fp-run-0001`, 2026-11-20 12:00:00Z for 1600 s, from Task 3)

```js
test("the watch's copy of a FitPro run is skipped", async () => {
  const res = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: {
    kind: 'run', source: 'apple', external_id: 'HK-DUP-1',
    distance_mi: 3.0, duration_sec: 1500, started_at: '2026-11-20T12:01:00Z' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.action, 'skipped');
  assert.equal(res.data.reason, 'overlaps_fitpro_run');
  const dup = await call('POST', '/api/entities/Run/query', { token: alice.token, body: { query: { external_id: 'HK-DUP-1' } } });
  assert.equal(dup.data.items.length, 0);
});

test('a run that only brushes a FitPro run is imported', async () => {
  const res = await call('POST', '/api/functions/ingestActivity', { token: alice.token, body: {
    kind: 'run', source: 'apple', external_id: 'HK-LATER-1',
    distance_mi: 2, duration_sec: 1200, started_at: '2026-11-20T12:25:00Z' } });
  assert.equal(res.data.action, 'created');
});

test("another person's FitPro run never causes a skip", async () => {
  const res = await call('POST', '/api/functions/ingestActivity', { token: bob.token, body: {
    kind: 'run', source: 'apple', external_id: 'HK-BOB-1',
    distance_mi: 3, duration_sec: 1500, started_at: '2026-11-20T12:01:00Z' } });
  assert.equal(res.data.action, 'created');
});

test('a FitPro upload that arrives after the import still saves', async () => {
  await call('POST', '/api/functions/ingestActivity', { token: bob.token, body: {
    kind: 'run', source: 'apple', external_id: 'HK-BOB-2',
    distance_mi: 3, duration_sec: 1500, started_at: '2026-11-23T12:00:00Z' } });
  const res = await call('POST', '/api/functions/ingestActivity', { token: bob.token, body: {
    ...liveRun, external_id: 'fp-run-bob-1', started_at: '2026-11-23T12:00:30Z' } });
  assert.equal(res.data.action, 'created');
});
```

Use whatever filter body the existing entity-query tests use if `{ query: {...} }` is not the shape.

- [ ] **Step 2: Run `npm test`** — expected: the first test FAILS with `created`.
- [ ] **Step 3: Implement** the overlap check in `ingestRun`, as one SQL query scoped to `created_by_id`.
- [ ] **Step 4: Run `npm test`** — expected: all pass.
- [ ] **Step 5: Contract doc.** Document the `skipped` response, and under Known gaps state that an import arriving *before* FitPro's own upload leaves two records.
- [ ] **Step 6: Commit** — `feat: skip imported copies of FitPro-recorded runs`

---

### Task 5: Turn directions for a saved route

**Files:**
- Create: `server/src/functions/routeDirections.js`, `server/test/directions.test.js`
- Modify: `server/src/functions/snapRoute.js` (export `decodePolyline`), `server/src/functions/index.js` (register `routeDirections`), `server/test/api.test.js`, `docs/architecture.md` (function list)

**Interfaces:**
- Produces: `POST /api/functions/routeDirections` body `{ "route_id": "<uuid>" }` →
  `{ "available": true, "maneuvers": [ { "index": 0, "instruction": "Turn left onto Elm Street.", "verbal": "Turn left onto Elm Street.", "type": 15, "lat": 40.7001, "lng": -74.0002, "at_mi": 0.42 } ] }`
  - `at_mi` is the distance from the start of the route to the point where the maneuver begins, to 3 decimals.
  - `{ "available": false, "maneuvers": [] }` when `config.routerUrl` is empty or `off`, the router fails or times out (9 s), or the route has fewer than two waypoints.
  - `404 { "error": "Route not found." }` for a missing id, a malformed id, or a route the caller does not own.
- Produces: `export function toManeuvers(trip): Maneuver[]` in `routeDirections.js`, a pure function over a Valhalla `trip` object.

Approach: ask the same Valhalla endpoint `snapRoute` uses, with the route's saved waypoints (`routes.points`; confirm in `web/src/pages/RouteBuilder.jsx` that `points` holds the tapped waypoints and `path` the snapped line), `costing: 'pedestrian'`, `units: 'miles'`, and turn-by-turn enabled instead of `directions_type: 'none'`. Each leg has `maneuvers[]` with `instruction`, `verbal_pre_transition_instruction`, `type`, `length` and `begin_shape_index`, and an encoded `shape`; **confirm these names against the Valhalla API reference before coding**. Drop the per-leg "start" and intermediate "destination" maneuvers so a multi-waypoint route reads as one journey with a single final arrival.

- [ ] **Step 1: Write the failing unit test** in `server/test/directions.test.js`

Build a two-leg `trip` fixture by hand: leg 1 shape of three points with maneuvers `[start (len 0.20, idx 0), left (len 0.30, idx 1), destination (len 0, idx 2)]`; leg 2 shape of two points with `[start (len 0.10, idx 0), destination (len 0, idx 1)]`.

```js
test('maneuvers are flattened across legs with running distance', () => {
  const out = toManeuvers(trip);
  assert.deepEqual(out.map((m) => m.at_mi), [0, 0.2, 0.6]);
  assert.deepEqual(out.map((m) => m.index), [0, 1, 2]);
  assert.deepEqual([out[1].lat, out[1].lng], [leg1Points[1].lat, leg1Points[1].lng]);
  assert.match(out[2].instruction, /arrive|destination/i);
});
test('an empty or malformed trip gives no maneuvers', () => {
  assert.deepEqual(toManeuvers(null), []);
  assert.deepEqual(toManeuvers({ legs: [{}] }), []);
});
```

(The three kept entries are: the first start, the left turn, and the final destination.)

- [ ] **Step 2: Write the failing API tests** in `server/test/api.test.js`

```js
test('routeDirections: router off -> not available; not your route -> 404', async () => {
  const route = await call('POST', '/api/entities/Route', { token: alice.token, body: {
    name: 'Two points', points: [{ lat: 40.70, lng: -74.00 }, { lat: 40.71, lng: -74.00 }] } });
  const mine = await call('POST', '/api/functions/routeDirections', { token: alice.token, body: { route_id: route.data.id } });
  assert.deepEqual(mine, { status: 200, data: { available: false, maneuvers: [] } });
  const theirs = await call('POST', '/api/functions/routeDirections', { token: bob.token, body: { route_id: route.data.id } });
  assert.deepEqual(theirs, { status: 404, data: { error: 'Route not found.' } });
  const junk = await call('POST', '/api/functions/routeDirections', { token: alice.token, body: { route_id: 'nope' } });
  assert.equal(junk.status, 404);
});
```

- [ ] **Step 3: Run `npm test`** — expected: FAIL (`Unknown function "routeDirections"`, `toManeuvers` not defined). If `server/package.json`'s test script names only `api.test.js`, widen it to run every file in `server/test/`.
- [ ] **Step 4: Implement** `routeDirections.js` and register it.
- [ ] **Step 5: Run `npm test`** — expected: all pass.
- [ ] **Step 6: Commit** — `feat: turn directions for saved routes`

---

### Task 6: Hide gym on the website

**Files (all under `web/src/`):**
- Modify: `App.jsx`, `components/layout/AppShell.jsx`, `pages/Home.jsx`, `pages/Analytics.jsx`, `pages/Feed.jsx`, `components/social/ShareComposer.jsx`, `components/social/SocialProfileCard.jsx`, `lib/shareCard.js`, `pages/Challenges.jsx`, `lib/challenges.js`, `components/challenges/ChallengeForm.jsx`, `pages/RouteBuilder.jsx`, `pages/Routes.jsx`, `components/routes/RouteCard.jsx`, `components/MapView.jsx`, `pages/LiveRun.jsx`, `components/run/RunSummary.jsx`, `pages/Privacy.jsx`, `components/privacy/DataControls.jsx`
- Leave in place, no longer referenced: `pages/Workouts.jsx`, `components/workout/*`, `components/run/LegsList.jsx`, `lib/exercises.js`

**Interfaces:** none consumed or produced; no server changes.

What "hidden" means, per area:
- **Navigation and routing:** no Workouts entry in the shell; `/workouts` redirects to `/`.
- **Home and Analytics:** no workout cards, totals or charts; run content only.
- **Routes and Live Run:** no gym stop in the route builder, route cards, map or live run; run summary shows no legs. Existing routes that have a `gym_stop` display as plain routes.
- **Feed:** workouts cannot be shared; posts with `kind: 'workout'` are not shown.
- **Challenges:** the `workouts` metric is not offered; existing challenges with that metric are not listed.
- **Privacy / Your data:** wording no longer advertises gym logging, but "wipe my training data" still removes stored workouts.

- [ ] **Step 1: Record the starting point.** Run `npm run lint` and `npm run build`; both must pass before any edit.
- [ ] **Step 2: Remove the UI** in the files above, area by area.
- [ ] **Step 3: Check nothing visible remains.** Search `web/src` (case-insensitive) for `gym` and `workout`; every remaining hit must be in an unreferenced file listed above, the data-wipe code, or the feed/challenge filters.
- [ ] **Step 4: Run `npm run lint` and `npm run build`** — expected: both clean. Run `npm test` — expected: unchanged, all pass.
- [ ] **Step 5: Look at it.** Start the API and web dev servers, sign in with the local dev admin, and confirm on Home, Routes, Route Builder, Live Run, Feed, Challenges and Analytics that no gym or workout control is visible and no page errors appear in the browser console.
- [ ] **Step 6: Docs.** Record "2026-11-25 — Gym hidden for now" in `docs/decisions.md`.
- [ ] **Step 7: Commit** — `feat(web): hide gym workouts for now`
