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
