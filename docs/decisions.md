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
- `trial_used_at` was added to `users` for stage 2 (which now sets it when a subscription
  has had its trial, and reads it to decide whether checkout offers one). It is not in
  `User.json`: that file lists what a client may write, and this is not one.

**2026-11-27 — The `SUBSCRIPTIONS` switch, off by default.** `SUBSCRIPTIONS=on` makes the
invite code optional at sign-up: an account made without one is verified, can sign in,
and has no access until it redeems a code (or, from stage 2, subscribes). Anything
other than exactly `on` is off, and off behaves as before, with the same messages.
`GET /api/auth/options` and the `inviteAccess` status report the switch so the screens
can follow it. It must stay off on the live site until payments are built and tested:
turned on today it would let anyone create an account that can do nothing, with no way
to pay. The website's "Invite only" gate is unchanged; the paywall is stage 2.
(Stage 2 is built, see "Subscriptions stage 2" below: with the switch on and the four
Stripe settings present the gate becomes the paywall. The switch still stays off on the
live site until the test list in the launch checklist has been run.)

**Known gaps before the switch is turned on: all five closed in stage 2 (2026-11-27).**
They were left out of stage 1 on purpose. None was about Apple, so none waits for stage 3.

1. **Who revoked a pass is recorded** (commit `a4e32cf`). Removing a free pass stores the
   admin's email and the time (`entitlements.revoked_by`, `revoked_at`); the list in
   Settings shows "Free access removed by <email> on <date>". Granting the pass again
   clears the record.
2. **`AccessGrant` is read-only through the entity API** (`a4e32cf`). Its create, update
   and delete rules are `false`, which nobody passes, admins included. The server still
   writes the row itself when a code is redeemed.
3. **Account deletion is on the paywall** (`9e7d133`), with the same dialog as Settings,
   so someone who has not paid can delete their account on the website. The separate
   "delete all training data" control is not offered there: deleting the account removes
   that data, and the wipe calls are refused without access.
4. **Open sign-up is rationed** (`a4e32cf`). No challenge service was added (it would be
   a third party). For a sign-up with no invite code, while the switch is on: an address
   is mailed at most 3 verification codes an hour and 8 a day, counted across sign-up,
   "resend" and the sign-in that re-sends a code (read from the stored codes, so a
   restart does not reset it); a second code is not mailed within 60 seconds of the last
   (the answer is the same `{ ok: true }`); at most 10 such sign-ups an hour from one
   network; and at most `OPEN_SIGNUP_MAILS_PER_HOUR` (default 300) such emails an hour
   across everyone, beyond which sign-up answers "Sign-up is busy right now" and one
   error report tells the owner. Sign-up with an invite code, and everything while the
   switch is off, keeps the earlier limits and messages.
5. **The phone's "confirm your email" screen asks for the password** when it is reached
   from sign-in (`475410e`), and sends it with the code.

**2026-11-27 — The emailed code only confirms the password its owner chose.**
Registering again with an unverified address replaces the password and mails the
address a new code, so the owner could be led to confirm an account holding someone
else's password. `verify-otp` now takes the password with the code and checks it first;
a mismatch answers like a wrong code and leaves the code unused. It is required when
`SUBSCRIPTIONS` is on and optional while it is off, so phone builds already installed
keep working. The website and the phone's sign-up screen always send it.

**2026-11-27 — Subscriptions stage 2: Stripe on the website.** Plan:
`docs/superpowers/plans/2026-11-27-subscriptions-stage2-stripe.md`. A person without
access can subscribe through Stripe's hosted Checkout (monthly $4.99 or annual $49.99,
7 days free once), is let in within seconds, and can cancel, resume and manage the
subscription from Settings. With `SUBSCRIPTIONS` off, or with no Stripe settings,
nothing a tester sees changes. The decisions:

- **Stripe is the record; our row is a copy.** The `entitlements` row (source `stripe`,
  `external_id` = the subscription id) is rewritten from what Stripe says every time
  something may have changed: a webhook, a return from Checkout or the portal, a status
  check for an account that is locked out. A webhook's own contents are not trusted for
  state: only its type and the customer it names are read, and Stripe is then asked. So
  a repeated notice, one that arrives out of order and one that never arrives all end
  in the right state.
- **No `stripe` package.** The server calls `https://api.stripe.com/v1/*` with `fetch`
  and checks the webhook signature with `node:crypto`, like mail and storage already do.
  It keeps the server at one dependency and keeps the seam the tests fake in our hands.
  What it costs: about 200 lines we own (form encoding, error mapping, a 10-second
  timeout, the signature check), no automatic retries, and following Stripe's API
  changes ourselves. The version is pinned in one constant (`STRIPE_API_VERSION`,
  `2026-11-18.endive`), and every field read from a Stripe object is in
  `src/billing/stripe.js` or `src/billing/sync.js`.
- **Selling needs the switch and the keys; looking after people who already pay needs
  only the keys.** Checkout and the paywall work only with `SUBSCRIPTIONS=on` and all
  four `STRIPE_*` settings. The webhook, the status repair, the portal, resume and
  cancel-on-delete work whenever the keys are present, so turning the switch off later
  stops new sales and nothing else. Never remove the keys while anyone is subscribed.
- **The trial reminder is our own email, not Stripe's.** Stripe's reminder goes out 7
  days before a trial ends, which for a 7-day trial is the moment it starts. Ours goes
  two days before, through the existing mail path, with the date, the amount and how to
  cancel, from an hourly sweep that does not depend on a webhook. Stripe's own trial
  email stays off so nobody gets two. The date in the email is the day on a US Pacific
  calendar, so nobody in the contiguous states is charged before the day named.
- **A failed payment keeps access for the 3-day allowance only.** The row becomes
  `grace` with `expires_at` at the end of the period that was paid for (the start of the
  unpaid one); `isLive` already allows 3 days past that. No second allowance.
- **A full refund ends access at once and cancels the subscription at Stripe.** The row
  becomes `revoked` (never live, no allowance) with the note `Refunded`, and is never
  changed again whatever Stripe says later. A free pass on the same account is a
  different row and keeps the person in. Partial refunds change nothing.
- **Deleting an account deletes its Stripe customer first**, which Stripe documents as
  cancelling its subscriptions immediately. If Stripe cannot be reached, or the keys
  have been removed, the account is not deleted and the person is told to try again.
- **One Stripe customer per account**, id in `users.stripe_customer_id`. Nothing else
  from Stripe is stored except subscription ids and webhook event ids. No card data.
- **Nothing in the database is held while Stripe is asked.** Stripe is called first,
  with no transaction open; what it said is then written in a short transaction that
  holds the user's row (`FOR NO KEY UPDATE`). Order is kept by a queue inside the
  process (`src/billing/queue.js`): work for one customer, and checkout for one account,
  goes one at a time, so the answer read last is the one written last and two tabs
  share one customer. A slow Stripe therefore cannot use up database connections or
  block a person's other requests. (The first version held the row across the Stripe
  calls; a review on 2026-11-27 had that changed. The plan's advisory lock was never
  used.) The queue is per process: with more than one API instance, order across
  instances is not guaranteed, though each write is still a whole copy of what Stripe
  said and the next sync corrects a stale one.
- **The price at Stripe is checked before anyone is sent to checkout.** Both configured
  prices must be USD, 499 a month and 4999 a year. A mismatch stops checkout
  ("Subscriptions are not available right now.") and is written to the error reports.
- **A refusal for lack of access carries `"code": "no_access"`.** The website uses it to
  show the paywall when access ends in the middle of a session. Status and message are
  unchanged; the phone sorts replies by status only.

**Stripe details checked against docs.stripe.com on 2026-11-27**, for API version
`2026-11-18.endive` (the version shown in the reference's own examples that day):

1. *From a charge to its subscription.* The Charge object has no `invoice` field; it has
   `payment_intent` (https://docs.stripe.com/api/charges/object). Invoice payments can
   be listed by payment: `GET /v1/invoice_payments` with `payment[type]=payment_intent`
   and `payment[payment_intent]=<id>`; each has `invoice`
   (https://docs.stripe.com/api/invoice-payment/list). The Invoice object has no
   top-level `subscription`; it is `parent.subscription_details.subscription`, with
   `parent.type` `subscription_details` (https://docs.stripe.com/api/invoices/object).
   So: charge → payment intent → invoice payment → invoice → subscription, three
   requests, in `subscriptionIdForCharge` only.
2. *Trial days on a Checkout Session.* `subscription_data[trial_period_days]`, an
   integer of at least 1 (https://docs.stripe.com/api/checkout/sessions/create).
3. *Flexible billing mode through Checkout.* Accepted:
   `subscription_data[billing_mode][type]`, `classic` or `flexible`, and the reference
   says "If no value is passed, the default is `flexible`" (same page). We send
   `flexible` explicitly so the behaviour does not depend on that default. The same page
   lists `payment_method_types` as optional; it is not sent, so Stripe offers what the
   dashboard has switched on.

Also read there: `current_period_start` and `current_period_end` are on each
subscription item (`items.data[]`), not on the subscription
(https://docs.stripe.com/api/subscriptions/object).

Not checked against the reference, and isolated: the customer portal's cancel flow
(`flow_data[type]=subscription_cancel` with
`flow_data[subscription_cancel][subscription]`), the "open" filter when listing
Checkout Sessions, and whether cancelling at the end of the period in flexible billing
mode sets `cancel_at_period_end` or only a `cancel_at` date (the mapper treats either
as "ending"; `resume` posts `cancel_at_period_end=false`). Try all three in Stripe's
test mode before the switch is turned on (step 9 of the launch checklist does).

**Not handled in stage 2, on purpose.**

- *Card disputes (chargebacks).* Nothing listens for `charge.dispute.*`. Stripe emails
  the owner; access is ended by cancelling or refunding in Stripe. Worth adding once
  there are real payers.
- *Switching plan.* Not offered: the portal has plan changes switched off. A person
  cancels and subscribes again. It avoids proration rules nobody has decided.
- *Partial refunds.* They change nothing here; access continues.
- *Sales tax.* Not collected. Stripe Tax's threshold monitoring (free) should be on so
  the owner is warned when a state's threshold is near.
- *A second trial through Apple.* Stage 3; the design accepts it as a small leak.
- *Managed Payments* (Stripe as the seller of record) and Stripe's newer "trial
  offers": not used; see the end of the plan.

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
