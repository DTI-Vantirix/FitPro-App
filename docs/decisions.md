# Decisions, open questions, and what's left

Baseline: the November 19, 2026 developer handoff, and the Base44 repo
`DTI-Vantirix/Fit-Pro` at commit `2586f9b` (Nov 13, 2026).

## Decisions

**2026-11-20 — Leave Base44; build the app, API and database ourselves.**
Own the code and data, run everything locally, choose hosting later. Replaces the
handoff's "no new backend" boundary. The Base44 repo is left untouched (it syncs
live to the Base44 Builder) until we switch over.

**Keep the web UI and the Base44 data shapes.** The API mirrors the Base44 SDK
surface, so the 20 pages work unchanged and records look the same. Lowest-risk
migration; refactoring the UI can come later, one page at a time.

**Postgres, one table per entity, real foreign keys.** Typed columns instead of a
JSON blob per record, so the data is queryable, indexed and safe to delete per user.

**Keep the entity access rules exactly as they were.** Same `rls` JSON, now
enforced by the API and covered by tests.

**Plain Node, one dependency.** No framework or ORM; easy to read, few upgrades.

**Keep the Expo shell; same ingest contract.** The handoff's Expo/React Native shell
stays (not Capacitor). Only its base URL and sign-in change. See
`docs/native-contract.md`.

**Health-sync upsert is atomic.** A unique index on `(user, source, external_id)`
plus `INSERT ... ON CONFLICT` replaces the old find-then-write, so two concurrent
syncs can't duplicate a run. Dedupe is per user (the old code would have matched
another user's record when an admin synced).

**Invite codes:** generated with a cryptographic RNG (was `Math.random`), claimed
atomically, and redemption is rate limited (10 tries per 15 minutes per user).

**2026-11-25 — Sign-up requires an invite code.** The owner hands out the codes
(Settings → invite codes, admin only). `register` refuses to create an account
without a valid unused code; the code is claimed when the email is verified, so an
abandoned sign-up doesn't use it up. Accounts that already existed keep working and
can still redeem a code after signing in. Release is invite-only testing: TestFlight
internal (testers added to the owner's team) and Play internal testing.

**2026-11-27 — One access check, enforced on the server.** Stage 1 of subscriptions
(`docs/superpowers/specs/2026-11-27-subscriptions-design.md`). Before this, only
`ingestActivity` refused an account without an invite code; every other call relied on
the screens hiding things. Now:

- Access lives in one table, `entitlements`, with a row per source (invite code, free
  pass from the owner, and later Stripe and Apple), and one function decides
  (`server/src/access.js`). Admins pass by role and need no row.
- Every product call (entities, uploads, every function except `inviteAccess`) answers
  `403 "Enter an invite code to use VantraRun."` without access (with `SUBSCRIPTIONS`
  on: `"Subscribe or enter an invite code to use VantraRun."`; the message only names
  what is on offer). The
  account itself stays reachable: sign in and out, `/api/auth/me`, password change and
  reset, account deletion (the app stores require it for people who have not paid),
  redeeming a code and reading the access status.
- `ingestActivity`'s refusal keeps its 403 status but its message changed from
  `"Redeem your invite code before syncing activities."`. The phone sorts replies by
  status only (`native/src/run/queue.ts`): a 403 keeps the run queued for a later retry,
  so installed builds are not affected.
- A paid period that has ended still counts for 3 days (`GRACE_DAYS`), so a late
  renewal notice never locks out a payer. Nothing writes paid rows yet.
- Existing testers needed no action: the migration copied redeemed invite codes over.
- The owner can see everyone's access and why, and give or take back a free pass by
  email (Settings → Who has access, the `adminAccess` function). A free pass can only be
  given to an email that already has an account; for anyone else, send an invite code.
- `access_grants` is kept and still written (the invite-code screen counts athletes
  from it) but is history only. Taking back an invite pass does not free the code.
- `trial_used_at` was added to `users` for stage 2 and is not read or written yet. It
  is not in `User.json`: that file lists what a client may write, and this is not one.

**2026-11-27 — The `SUBSCRIPTIONS` switch, off by default.** `SUBSCRIPTIONS=on` makes the
invite code optional at sign-up: an account made without one is verified, can sign in,
and has no access until it redeems a code (or, from stage 2, subscribes). Anything
other than exactly `on` is off, and off behaves as before, with the same messages.
`GET /api/auth/options` and the `inviteAccess` status report the switch so the screens
can follow it. It must stay off on the live site until payments are built and tested:
turned on today it would let anyone create an account that can do nothing, with no way
to pay. The website's "Invite only" gate is unchanged; the paywall is stage 2.

**2026-11-25 — Gym hidden for now.** The owner wants the first release to be a
run coach, with gym logging built back up later. The website no longer shows the
gym log, gym stops on routes and runs, workout posts or the `workouts` challenge
metric. Nothing was deleted: the `workouts` table, the `workout` ingest kind, old
data and the gym source files (`web/src/pages/Workouts.jsx`,
`web/src/components/workout/`, `web/src/lib/exercises.js`) are all still there.

**2026-11-25 — Checks rerun on every change.** `npm run check` runs the API
tests, the web lint and the Playwright browser flows (`e2e/`, admin and runner);
`npm run check:watch` reruns them whenever a source file changes; the GitHub
workflow `.github/workflows/checks.yml` reruns them on every push and pull request.

**2026-11-25 — Hosting: Render, Virginia, one container.** The API serves the built
website from the same process (`Dockerfile`), described with its Postgres database
in `render.yaml`. Smallest paid plans (about $13 a month at the listed prices that day).
Chosen over Fly.io for less upkeep: deploys from GitHub after the checks pass, HTTPS
and the database are managed. The environment starts empty; nothing is copied from a
development database. Steps for the owner: `docs/launch-checklist.md`.

**2026-11-25 — Uploads: disk by default, any S3-compatible bucket by configuration.**
`server/src/storage.js` signs requests itself (AWS Signature V4, checked against AWS's
published examples), so the server still has one dependency. The bucket stays private;
files are read back through the API.

**2026-11-25 — Error monitoring in our own database.** The phone app posts crashes to
`POST /api/client-errors`; the API records its own unexpected errors; admins read
them in Settings. A report is a message, a stack trace, the platform and the app
version. No monitoring SDK, so the no-analytics rule holds.

**2026-11-25 — The app is VantraRun, `com.vantrarun.app`.** Name and id given by the
owner. The Expo slug and project id are unchanged (internal). The website and its
emails were renamed to VantraRun the same day at the owner's request; code names, the
database, storage keys and the `fitpro` run source are unchanged. Build numbers are
managed by EAS.

**2026-11-25 — Privacy policy: comprehensive, no fixed retention.** Owner's decision:
data is held until the person deletes it or their account. The page lists the
companies involved (Render, Resend, the routing and map providers), so it must be
updated if any of those change. The consent version was raised to `2026-11-25`, so
anyone who had accepted the earlier text is asked again.

## Not built yet (deliberately deferred)

| Feature | State now | Notes |
| --- | --- | --- |
| Google sign-in | Button shows "isn't set up yet" | Needs a Google OAuth client. Apple sign-in becomes **required** by App Review if Google is offered in the iOS app. |
| Two-step sign-in (MFA) | `/api/auth/mfa/*` answers 501; screens kept | TOTP is straightforward to add on this server. |
| Account deletion button | Web: done (Settings → Your data, asks for the password). Native: not yet | **Required by both app stores.** |
| File storage | Local disk (`server/uploads`) | Move to S3/R2 before deploying more than one server. |
| Rate limits | In memory, per process | Fine for one server; Redis if scaled out. |
| MCP / OAuth consent page | Removed (Base44 platform feature, wasn't routed) | |

## Open questions (from the handoff, still open)

1. ~~MVP release: invite-only TestFlight / Play internal testing, or public beta?~~
   Decided 2026-11-25: invite-only internal testing with 10 testers.
2. iOS first, Android first, or both? Is Google Health Connect in the first release?
3. Is real activity upload now approved? (The API is ready; the shell still runs
   on the fake adapter.) Deletion/"unsync" of synced activities?
4. ~~Should the **server** also require an accepted invite for `ingestActivity`?~~
   Decided 2026-11-25: yes. `ingestActivity` answers 403 without an accepted code.
   Extended 2026-11-27 to every product call (see "One access check" above).
5. Background sync: in scope? Needs its own design and permission model.
6. Health-data retention, export, and the privacy policy wording.
7. Hosting: which provider and region.

## Before the app stores: checklist

- [ ] Hosting chosen; Postgres provisioned with automated backups
- [ ] Production `JWT_SECRET`, `RESEND_API_KEY` (and a verified sending domain), `CORS_ORIGINS`, `APP_URL`
- [ ] HTTPS everywhere; `TRUST_PROXY=true` behind the host's proxy
- [ ] Uploads on object storage
- [ ] Account deletion button in the app (web and native)
- [ ] Privacy policy URL and health-data disclosures (App Store privacy labels, Play Data safety)
- [ ] Error monitoring (self-hosted or privacy-respecting; no third-party analytics in the shell)
- [ ] Self-host the Valhalla router or pick a provider with an SLA (the public one is best-effort)
- [ ] EAS builds, signing, HealthKit entitlement and `Info.plist` usage strings
- [ ] Device tests: sign-in, invite, consent, revoke, offline, error states on iOS and Android
