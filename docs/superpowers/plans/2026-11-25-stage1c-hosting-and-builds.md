# Stage 1C — Hosting and Store Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything in the repository that is needed to put the API and website on a managed host and to build VantraRun for TestFlight and Play internal testing, with a step-by-step list of the account actions only the owner can take.

**Architecture:** One container (API + built website) on Render in Virginia with managed Postgres, described by a `render.yaml` blueprint so the owner creates it with a few clicks. Uploads go through a small storage interface (disk by default, any S3-compatible bucket when configured). Routing gains an optional API key so a hosted Valhalla provider can replace the public best-effort server. Errors from the server and the phone app are recorded in our own database (no third-party SDK). The Expo app takes its permanent name and id and gains `preview` and `production` build profiles.

**Tech Stack:** Docker (node:22-alpine), Render blueprint, Postgres 16, plain Node (still one dependency: `pg`), AWS Signature V4 written against `node:crypto`, EAS Build.

**Spec:** `docs/superpowers/specs/2026-11-25-native-run-coach-design.md` sections 9.5 and 13.

## Global Constraints

- Hosting region: Northeast North America (owner). Render region `virginia`.
- The API also serves the built web app (`WEB_DIST`). Managed Postgres with backups.
- The hosted environment starts clean: nothing is copied from the local database or `server/uploads`.
- No third-party analytics, ad SDKs or session recording, in web or native. Error monitoring must respect that.
- Server keeps one runtime dependency (`pg`).
- Schema changes go in a new numbered migration; never edit an applied one.
- Access stays invite-only.
- App name **VantraRun**, bundle id / package **`com.vantrarun.app`** (owner, confirmed twice on the build board).
- **Nothing is created, registered, bought or submitted from this plan.** No hosting account, no Apple or Google registration, no build that signs with the owner's credentials, no email-provider or map-key signup. Each is listed in `docs/launch-checklist.md` and posted as a flag.
- `npm run check`, native `npm run check` and CI stay green.

## Decisions the spec left to the builder

| Decision | Value | Why |
| --- | --- | --- |
| Host | Render, blueprint `render.yaml` | least upkeep for a non-developer owner: deploys from GitHub, HTTPS and managed Postgres included |
| Plans | web `0.5c-512mb`, Postgres `0.1c-256mb`, 1 GB disk | smallest paid plans; about $13 a month at Render's listed prices on 2026-11-25 (web $7, database $6, disk $0.25/GB). Free plans sleep and the free database expires, so they are not used |
| Uploads | disk on the Render persistent disk by default; S3-compatible bucket when `S3_*` variables are set | works on day one with nothing more to sign up for; object storage is a config change, not a code change |
| Routing | `ROUTER_URL` + optional `ROUTER_API_KEY` (sent as `api_key`, the form Stadia Maps' hosted Valhalla uses) | the public server stays the default until the owner has a key |
| Error monitoring | table `client_errors`; the server records its own unexpected errors, the phone app posts crashes to `POST /api/client-errors`; admins read them in Settings | no third party sees anything |
| First admin | `ADMIN_EMAIL` + `ADMIN_PASSWORD` environment variables create the admin once at start-up if that email has no account | the owner cannot run a script on the host |
| Android map key | `GOOGLE_MAPS_ANDROID_KEY` read by `native/app.config.js` at build time | the key never enters the repository |
| App version | `1.0.0`; build numbers managed by EAS (`appVersionSource: remote`, `autoIncrement`) | |
| Expo slug / project id | unchanged (`fitpro-native-spike`, existing project id) | internal names; changing them would orphan the existing Expo project |

## Review Focus

1. **Signature V4 is wrong by one byte** — every upload fails only in production. Test against AWS's published example signature (Task 2).
2. **A bucket key or admin password ends up in a log or an error report** — error reports store message and stack only; storage errors never include headers (Tasks 2 and 4 tests).
3. **The error endpoint is used to fill the database** — rate limit per user, field length caps, unauthenticated requests refused (Task 4 tests).
4. **Admin bootstrap resets or promotes an existing account** — it must only ever create; an existing email is left exactly as it is (Task 1 test).
5. **The container starts but serves no website, or cannot write uploads** — CI builds the image, starts it against Postgres and checks `/api/health`, `/` and an upload (Task 1).

---

### Task 1: Container, blueprint, first admin

**Files:** Create `Dockerfile`, `.dockerignore`, `render.yaml`, `server/src/auth/bootstrap.js`, `scripts/smoke-image.mjs`. Modify `server/src/config.js` (`RENDER_EXTERNAL_URL` as the default for `APP_URL` and `PUBLIC_URL`; `trustProxy`), `server/src/index.js`, `.env.example`, `.github/workflows/checks.yml` (job `image`), `server/test/api.test.js`.

**Produces:** `export async function bootstrapAdmin(db, env): Promise<'created' | 'exists' | 'skipped'>` — `skipped` unless both variables are set and the password is at least 12 characters.

- [ ] Test first: no variables → `skipped`; valid pair → `created`, the account can log in, has role `admin`, is verified; second call → `exists`; an existing ordinary user with that email stays `user` with their old password; an 8-character password → `skipped` with no account.
- [ ] Implement; `npm test`.
- [ ] `Dockerfile` (two stages: build the web app, then server + `web/dist`, `NODE_ENV=production`, `WEB_DIST`, `UPLOAD_DIR=/data/uploads`); `render.yaml` (web service `vantrarun`, database `vantrarun-db`, both `virginia`, disk at `/data`, `healthCheckPath: /api/health`, `autoDeployTrigger: checksPass`, `JWT_SECRET` generated, secrets `sync: false`).
- [ ] `scripts/smoke-image.mjs <base-url>`: health is ok, `/` returns the website's HTML, `/privacy` returns HTML, an admin created by bootstrap can log in, upload a PNG and read it back. Run it locally against the built image and in the CI job.
- [ ] Commit.

### Task 2: Upload storage

**Files:** Create `server/src/storage.js`, `server/test/storage.test.js`. Modify `server/src/uploads.js`, `server/src/config.js`, `.env.example`.

**Produces:**
```js
export function signV4({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', now }): Record<string, string> // headers incl. Authorization
export function createStorage(config): { kind: 'disk' | 's3', put(name, buffer, contentType): Promise<void>, open(name): Promise<{ stream, size } | null> }
```
`config.storage = { s3: null | { endpoint, bucket, region, accessKeyId, secretAccessKey } }`; S3 is used only when endpoint, bucket and both keys are all set. Requests are path-style (`{endpoint}/{bucket}/{name}`), which R2, Backblaze B2, MinIO and AWS all accept.

- [ ] Tests first: `signV4` reproduces the signature in AWS's "GET Object" Signature V4 example; partial S3 settings fall back to disk; against a local fake S3 server, `put` then `open` round-trips bytes, a missing object is `null`, a 500 from the bucket throws an error whose message contains no credential; the existing upload API tests still pass on disk.
- [ ] Implement; commit.

### Task 3: Hosted routing key

**Files:** Modify `server/src/functions/snapRoute.js` (export `routerRequestUrl(config, payload)`), `server/src/functions/routeDirections.js`, `server/src/config.js`, `.env.example`, `server/test/directions.test.js`.

- [ ] Test first: without a key the URL is unchanged from today; with `routerApiKey` it ends `&api_key=<encoded key>`; a `ROUTER_URL` that already has a query string gets `&json=`.
- [ ] Implement; commit.

### Task 4: Error reports without a third party

**Files:** Create `server/migrations/004_client_errors.sql`, `server/src/errors.js`, `server/src/functions/adminClientErrors.js`, `web/src/components/admin/ErrorReportsCard.jsx`, `native/src/diagnostics/error-reports.ts`, `native/scripts/test-error-reports.mjs`. Modify `server/src/app.js`, `server/src/functions/index.js`, `web/src/pages/Settings.jsx`, `web/src/pages/Privacy.jsx`, `native/index.js`, `server/test/api.test.js`, `docs/architecture.md`.

**Produces:** `POST /api/client-errors { message, stack?, context?, platform?, app_version? }` → `201 { ok: true }` (signed-in users only; 20 an hour each; message 500, stack 4000, context 200, platform 20, version 40 characters). `adminClientErrors { action: 'list' | 'clear' }` (admins only; newest 100). The server records its own unexpected (500) errors with `platform: 'server'`. Native: `buildErrorReport(error, meta)` (pure) and `installErrorReporting()`.

- [ ] Tests first (API): anonymous → 401; a report is stored with the caller's id and truncated fields; the 21st in an hour → 429; a non-admin cannot list; an admin lists newest first and can clear; deleting the account deletes its reports. (Native): `buildErrorReport` truncates, never includes the access token, handles a non-Error throw.
- [ ] Implement; commit.

### Task 5: App identity and build profiles

**Files:** Modify `native/app.json` (name, scheme, version, bundle id, package, usage strings), `native/eas.json`, `native/scripts/check-boundaries.mjs`, user-visible "FitPro" text in `native/app/*.tsx` and `native/src/run/**`, `native/README.md`. Create `native/app.config.js`.

- [ ] `eas.json`: `development` (dev client, internal), `preview` (internal distribution, Android APK), `production` (store, auto-increment); `EXPO_PUBLIC_API_URL` per profile; `submit.production`.
- [ ] Boundary check: bundle id and package are `com.vantrarun.app`; no key in `app.json`; `preview` and `production` profiles exist and name an `https://` API URL.
- [ ] `npm run check` in `native`; `npx expo config --type introspect` shows the new id and name; `GOOGLE_MAPS_ANDROID_KEY=x npx expo config` shows the key applied; export both bundles; commit.

### Task 6: Owner runbook, docs, review, flags

**Files:** Create `docs/launch-checklist.md`. Modify `README.md` (Deploying), `docs/decisions.md`, `docs/architecture.md`.

- [ ] `docs/launch-checklist.md`: in order, each account action with what to click and what to paste where: merge to `main`; Render blueprint; Resend (email) key and sender domain; first admin sign-in and removing `ADMIN_PASSWORD`; invite codes; Apple (App Store Connect app, `eas build` and `eas submit`, TestFlight internal testers); Google (Play Console app, internal testing, Maps key); optional routing key and bucket; what to check after each.
- [ ] `npm run check`; push; pull request into `native-shell-wiring`; GitHub checks green; independent review; fixes; dashboard tasks, checks and flags.

## Not doable from here (flags)

Creating the Render services and paying for them; a Resend account and sender domain (without it no sign-up code can be emailed in production); Apple and Google app registration, signing and store upload; the Google Maps key; privacy-policy wording and data-retention period (owner decision, still open from the spec).
