# Subscriptions stage 1: access on the server — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One server-side record of who has access and why, enforced on every product API call, with sign-up openable without an invite code behind a switch that stays off.

**Architecture:** A new `entitlements` table holds every source of access (invite code, admin grant, and later Stripe and Apple). `server/src/access.js` is the only place that answers "may this account use the product". Entity routes, uploads and every function except the access function refuse accounts without access. A `SUBSCRIPTIONS` setting (default off) makes the invite code optional at sign-up; nothing about payments is built in this stage.

**Tech stack:** plain `node:http` server, `pg`, numbered SQL migrations, `node --test`; React website; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-subscriptions-design.md`

Stages 2 (Stripe checkout and website paywall) and 3 (Apple in-app purchase) get their own plans. This stage ships alone: with the switch off, behaviour for testers is unchanged except that the server now enforces access.

## Global constraints

- `SUBSCRIPTIONS` defaults to off. With it off, sign-up needs an invite code exactly as today (same messages).
- New numbered migration only (`005_*.sql`); never edit an applied migration.
- Access-rule changes need tests in the same commit. Never commit `server/.env`.
- No third-party services or analytics.
- Every existing tester and admin keeps access with no action: redeemed invite codes are carried over by the migration.
- A person without access must still be able to: sign in, sign out, read `/api/auth/me`, change or reset their password, delete their account, redeem an invite code, and read their access status.
- Checks before done: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` from the repo root; `npm run check` in `native/`.

## Review focus

1. A run upload retried by the phone after access lapses: it must get a clear 403 and stay queued, not be dropped (the phone already treats 403 from `ingestActivity` this way; the message changes, the status must not).
2. An admin created with `ADMIN_EMAIL`/`ADMIN_PASSWORD` or `create-admin` has no entitlement row: admins must pass by role alone.
3. An entitlement with `expires_at` just past: allowed for the grace allowance (3 days), refused after it.
4. Two entitlements on one account (invite + a later paid one): access holds while either is good, and revoking the free one does not remove the other.
5. Bulk and `updateMany` / `deleteMany` entity routes: refused without access, like the single-record routes.

---

### Task 1: entitlements table and the access check

**Files:**
- Create: `server/migrations/005_entitlements.sql`
- Create: `server/src/access.js`
- Modify: `server/src/functions/inviteAccess.js` (use `access.js`; `claimInvite` also writes an entitlement)
- Modify: `server/src/config.js` (add `subscriptions: env.SUBSCRIPTIONS === 'on'`)
- Test: `server/test/access.test.js` (pure parts), `server/test/api.test.js` (new `describe('access')`)

**Interfaces:**
- Produces: table `entitlements (id uuid pk, user_id uuid not null references users on delete cascade, source text check in ('stripe','apple','invite','admin'), status text check in ('trial','active','grace','expired','revoked'), plan text, expires_at timestamptz, cancel_at_period_end boolean not null default false, external_id text, granted_by text, note text, created_date, updated_date)`; unique index on `(source, external_id)` where `external_id` is not null; unique index on `(user_id, source)` where `source in ('invite','admin')`; column `users.trial_used_at timestamptz`.
- Produces: `GRACE_DAYS = 3`; `isLive(row, now = new Date()) -> boolean`; `accessOf(db, user) -> Promise<{ allowed, admin, reason: 'admin'|'subscription'|'trial'|'invite'|'granted'|null, source, plan, expires_at, cancel_at_period_end }>` (the best live row wins: paid before free); `hasAccess(db, user) -> Promise<boolean>`; `grantFree(tx, { userId, source: 'invite'|'admin', grantedBy, note }) -> Promise<row>` (idempotent per user and source; reactivates a revoked row).
- The migration copies every `access_grants` row into `entitlements` as `source 'invite'`, `status 'active'`, `granted_by = code`.

- [ ] **Step 1: Write the failing tests**
  - `isLive`: `active` with no expiry is live; `active` expiring tomorrow is live; expired 2 days ago is live (grace); expired 4 days ago is not; `revoked` and `expired` are never live; `trial` and `grace` follow the same date rule.
  - API: an account that signed up with a code has `accessOf(...).reason === 'invite'`; an admin has `reason 'admin'` with no row; a legacy account (verified, no grant) is not allowed; after redeeming a code it is.
  - Migration: a row inserted into `access_grants` before migrating appears in `entitlements` afterwards (test by running the backfill statement twice: it must not duplicate).
- [ ] **Step 2: Run `npm test` and confirm they fail** (module or table missing).
- [ ] **Step 3: Write the migration and `access.js`; make `inviteAccess.js` import `hasAccess` from it and have `claimInvite` call `grantFree`.** `access_grants` keeps being written, since the invite-code admin screen reads it.
- [ ] **Step 4: `npm test` passes, including every existing test.**
- [ ] **Step 5: Commit** `feat(server): entitlements and a single access check`.

### Task 2: the server refuses product calls without access

**Files:**
- Modify: `server/src/entities/routes.js`, `server/src/functions/index.js`, `server/src/uploads.js`
- Modify: `server/src/functions/ingestActivity.js` (drop its own check; keep its 403 status)
- Modify: `server/src/functions/inviteAccess.js` (`status` returns the `accessOf` fields plus `subscriptions: boolean`)
- Test: `server/test/api.test.js`

**Interfaces:**
- Consumes: `accessOf`, `hasAccess`.
- Produces: `requireAccess(ctx) -> Promise<user>` exported from `server/src/access.js`: `requireUser`, then `403 { error: 'Subscribe or enter an invite code to use VantraRun.' }` when not allowed.
- Open without access: all `/api/auth/*` routes, the function `inviteAccess`, the two `/.well-known/*` routes, health, privacy and static files. Everything under `/api/entities/*`, `POST /api/uploads`, and every other function needs access.
- `inviteAccess` `status` response: `{ allowed, admin?, reason, source, plan, expires_at, cancel_at_period_end, subscriptions }`. Existing callers read only `allowed` and `admin`.

- [ ] **Step 1: Failing tests.** A legacy account gets 403 with that message from: entity list, query, get, create, update, delete, bulk create, bulk update, `updateMany`, `deleteMany`; from `POST /api/uploads`; from `snapRoute`, `socialFeed`, `challengeBoard`, `routeDirections`, `ingestActivity`. The same account gets 200 from `inviteAccess` status and redeem, `/api/auth/me`, change password, and account deletion. After redeeming, the entity calls succeed. An account whose only entitlement expired 4 days ago gets 403; expired 2 days ago gets 200.
- [ ] **Step 2: Run and confirm they fail** (today these calls succeed).
- [ ] **Step 3: Implement `requireAccess` and use it in the three route files.** Find every existing test that used a no-access account on an entity route and decide per test: give the account a code, or assert the 403. Do not weaken any assertion about what a person may see.
- [ ] **Step 4: `npm test` and `npm run e2e` pass.**
- [ ] **Step 5: Commit** `feat(server): enforce access on entities, uploads and functions`.

### Task 3: sign-up without a code, behind the switch

**Files:**
- Modify: `server/src/auth/routes.js` (register), the handler behind `GET /api/auth/options`
- Modify: `web/src/pages/Register.jsx`, `web/src/api/client.js` if the options call needs it
- Test: `server/test/api.test.js`, `e2e/02-runner.spec.mjs` (unchanged behaviour with the switch off)

**Interfaces:**
- `GET /api/auth/options` adds `subscriptions: boolean` next to `auth_config`.
- Register with `config.subscriptions` on: `invite_code` is optional; when given it is validated and held exactly as today; when empty the account is created with no pending code and, once verified, has no access. With it off: unchanged (`400 Enter your invite code.`).

- [ ] **Step 1: Failing tests** with a second app instance built with `subscriptions: true` (follow how the suite builds its app; add a small helper): sign-up with no code succeeds, verification signs in, `inviteAccess` status is `{ allowed: false, subscriptions: true }`, entity calls are 403, redeeming a code then opens them; sign-up with a bad code is still refused; options reports `subscriptions: true`. With the default app: options reports `false` and the no-code sign-up is still refused.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** On the website, `Register.jsx` reads the options: with subscriptions off the form is unchanged; with them on the invite code field is not required and its help text reads "Have an invite code? Enter it here. Otherwise leave this empty."
- [ ] **Step 4: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` pass.**
- [ ] **Step 5: Commit** `feat: sign-up without an invite code when subscriptions are on`.

### Task 4: the owner sees and controls access

**Files:**
- Create: `server/src/functions/adminAccess.js`; register it in `server/src/functions/index.js`
- Create: `web/src/components/admin/AccessCard.jsx`; show it in `web/src/pages/Settings.jsx` beside the invite codes card (admins only, as that card is)
- Test: `server/test/api.test.js`, `e2e/01-admin.spec.mjs`

**Interfaces:**
- `adminAccess` (admins only, `403 Admins only` otherwise):
  - `{ action: 'list', search?: string }` -> `{ people: [{ user_id, email, full_name, role, allowed, reason, source, plan, expires_at, cancel_at_period_end, entitlements: [{ id, source, status, plan, expires_at, granted_by, note, created_date }] }] }`, newest accounts first, at most 200, `search` matching part of the email.
  - `{ action: 'grant', email, note? }` -> `{ ok: true, entitlement }`; `404 No account with that email yet. Send them an invite code instead.`; granting twice is harmless.
  - `{ action: 'revoke', entitlement_id }` -> `{ ok: true }`; only `invite` and `admin` rows (`400 Paid subscriptions are cancelled with the payment provider.` for others); sets `status 'revoked'`.
- `AccessCard`: a table of people with a plain-language reason ("Admin", "Invite code", "Granted by you", "Subscribed (monthly)", "Trial", "No access"), a search box, "Grant free access" by email with an optional note, and "Remove" on free passes with a confirmation.

- [ ] **Step 1: Failing tests.** Non-admin is refused; list shows an invited runner as `invite` and a legacy account as not allowed; grant opens a legacy account's entity calls; revoke closes them again; revoking a free pass leaves another live entitlement's access intact (insert a `stripe` row directly in the test); unknown email is 404. Browser test: the admin sees the card, the runner from the earlier spec listed as "Invite code", and a runner does not see the card.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: All checks in Global constraints pass.**
- [ ] **Step 5: Commit** `feat: admin view of who has access, with free grants`.

### Task 5: documents

**Files:**
- Modify: `docs/architecture.md`, `docs/decisions.md`, `docs/native-contract.md` (the 403 message and the `inviteAccess` status fields), `docs/launch-checklist.md` (the `SUBSCRIPTIONS` setting, off by default), `README.md` if it lists settings.

- [ ] **Step 1: Update the documents; no behaviour change.**
- [ ] **Step 2: Commit** `docs: access model and the subscriptions switch`.
