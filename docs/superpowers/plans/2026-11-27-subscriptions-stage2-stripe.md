# Subscriptions stage 2: Stripe on the website: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person without access can subscribe on the website through Stripe (monthly or annual, 7 days free once), is let in within seconds, can cancel, resume and manage the subscription from Settings, and is never billed after deleting the account. Every gap stage 1 left open that is not about Apple is closed.

**Architecture:** Stripe is the record of what was paid; our `entitlements` row (source `stripe`, `external_id` = subscription id) is a copy of it. Every notice from Stripe, and every return from Stripe's pages, triggers the same step: ask Stripe for that customer's subscriptions and write what it says. The notice's own contents are not trusted for state, so repeated and out-of-order notices cannot do harm, and a missing notice is repaired the next time the person asks for their access. All calls to Stripe go through one module, `server/src/billing/stripe.js`, which tests replace with a fake. The website's "Invite only" gate becomes a paywall when the server says it is selling.

**Tech stack:** plain `node:http` server, `pg`, `fetch` to Stripe's HTTPS API, `node:crypto` for the webhook signature, numbered SQL migrations, `node --test`; React website; Playwright; Expo (one screen).

**Spec:** `docs/superpowers/specs/2026-11-27-subscriptions-design.md`

Stage 1 (`docs/superpowers/plans/2026-11-27-subscriptions-stage1-access.md`) is merged. Stage 3 (Apple in-app purchase and the phone paywall) gets its own plan. This stage ships alone: with `SUBSCRIPTIONS` off, or with no Stripe keys, nothing a tester sees changes.

## Decisions taken in this plan

- **No `stripe` package.** The server calls `https://api.stripe.com/v1/*` with `fetch` and checks the webhook signature with `node:crypto`. It keeps the server at one dependency, keeps the seam the tests fake in our hands, and matches how mail and storage are already done. What it costs: about 200 lines we own (form encoding with `a[b][c]` keys, error mapping, timeouts, the signature check); no automatic retries; and we must follow Stripe's API changes ourselves. The version is pinned in one constant (`STRIPE_API_VERSION`; on 2026-11-27 Stripe's changelog lists `2026-11-18.endive` as the latest) and every field read from a Stripe object goes through `server/src/billing/sync.js`, so a change of version touches two files. In the current version `current_period_end` is on the subscription's items, not on the subscription, and a charge has no `invoice` field; the builder confirms each field path against Stripe's reference for the pinned version before writing the mapper.
- **Selling needs the switch and the keys; looking after people who already pay needs only the keys.** Checkout and the paywall work only when `SUBSCRIPTIONS=on` and all four Stripe settings are present. The webhook, reconcile, the portal, resume and cancel-on-delete work whenever the keys are present, so turning the switch off later never strands or keeps billing someone who subscribed. Until someone has subscribed the two rules cannot be told apart.
- **Trial reminder: our own email, not Stripe's.** Stripe's reminder is sent 7 days before a trial ends, and at once when the trial is 7 days or shorter, so for our trial it would arrive at sign-up, not two days before the charge as the design says. Ours goes through the existing mail path (`server/src/lib/mail.js`), says the exact date, amount and how to cancel, and is sent by an hourly sweep that does not depend on a webhook arriving. Stripe's own trial email stays off so nobody gets two (see "For the owner" in Task 14).
- **A failed payment keeps access for the 3-day allowance only.** The row becomes `grace` with `expires_at` at the end of the period that was paid for; `isLive` already allows 3 days past that. No second allowance.
- **A full refund ends access at once and cancels the subscription at Stripe.** The row becomes `revoked` (never live, no allowance) with the note `Refunded`. Partial refunds change nothing.
- **Deleting an account deletes its Stripe customer first**, which Stripe documents as cancelling its subscriptions immediately. If Stripe cannot be reached the account is not deleted.
- **One Stripe customer per account**, id kept in `users.stripe_customer_id`. Nothing else from Stripe is stored except subscription ids and event ids.

## Global constraints

- `SUBSCRIPTIONS` stays off by default. The server starts cleanly with no Stripe settings, and never calls Stripe at start-up.
- New numbered migration only (`006_stripe.sql`); never edit an applied migration.
- No card data anywhere: only Stripe customer, subscription and event ids. No third-party analytics or scripts; the website loads nothing from Stripe (Checkout and the portal are redirects).
- Tests run with no network. Stripe is reached only through `server/src/billing/stripe.js`; tests pass a fake to `createApp`. Webhook tests sign their own payloads with a test secret.
- Access-rule changes need tests in the same commit. Never commit `server/.env`.
- A tester or anyone with a free pass is never asked for a card: checkout is refused for an account that already has access.
- The phone keeps working: `inviteAccess` keeps its shape (fields may be added, none removed), refusals keep status 403, and installed builds that send no password to `verify-otp` keep working while the switch is off.
- Money shown to people comes from one place per side: `server/src/billing/plans.js` and `web/src/lib/plans.js` ($4.99 a month, $49.99 a year, 7-day trial, 14-day annual refund window).
- Checks before done: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` from the repo root; `npm run check` in `native/`.

## Review focus

The five failures most likely to hurt a real person. Each has a named test in the task that owns it.

1. **The webhook arrives after the person returns from checkout, or never.** They paid and must get in. Owned by Task 4 (`a payer whose webhook never arrives is let in on return from checkout`) and shown in a browser in Task 13.
2. **The same notice twice, or notices out of order.** A late "trial started" after "cancelled" must not reopen access; a repeat must change nothing. Owned by Task 3 (`a repeated event changes nothing`, `an old notice arriving after cancellation does not reopen access`).
3. **A refund on an account that also holds a free pass.** The paid row ends at once; the free pass keeps the person in; without a pass, access ends at once and not after 3 days. Owned by Task 3 (`a refund ends the paid row and leaves a free pass standing`, `a refund without a free pass ends access immediately`).
4. **Subscribing twice in two tabs.** One customer, the first open checkout is expired when a second is made, a third attempt after paying is refused, and if two subscriptions still exist the owner sees both and refunding one leaves the other. Owned by Task 2 (`two checkouts at once share one Stripe customer and leave one open session`, `checkout is refused once a subscription exists at Stripe, even before its webhook`) and Task 3 (`two subscriptions on one account: refunding one leaves the other`).
5. **An account deleted while a subscription is live.** It must be cancelled at Stripe before the account goes, and the account must stay if Stripe cannot be reached. Owned by Task 5 (`deleting an account deletes its Stripe customer first`, `the account is kept when Stripe cannot be reached`).

## Stage 1 gaps (`docs/decisions.md`, "Known gaps before the switch is turned on")

| Gap | Closed by |
| --- | --- |
| 1. Who revoked a pass is not recorded | Task 7 |
| 2. `AccessGrant` writable by admins through the entity API | Task 7 |
| 3. No account deletion on the website for someone without access | Task 8 |
| 4. Open sign-up can be used to send mail | Task 7 |
| 5. The phone's "confirm your email" screen sends no password | Task 12 |

None of the five is Apple-specific, so none is left for stage 3.

---

### Task 1: the Stripe module, its settings and the signature check

**Files:**
- Create: `server/src/billing/stripe.js`, `server/src/billing/signature.js`, `server/src/billing/plans.js`
- Create: `server/test/stripe-fake.js` (test helper), `server/test/stripe.test.js` (pure tests)
- Modify: `server/src/config.js`, `server/src/index.js` (one start-up log line), `.env.example` (repo root; there is no `server/.env.example`)

**Interfaces:**
- `config.stripe = { secretKey, webhookSecret, prices: { monthly, annual }, ready }` from `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`; `ready` is true only when all four are non-empty. `config.selling = config.subscriptions && config.stripe.ready`.
- `plans.js`: `PLANS = { monthly: { amountCents: 499, interval: 'month', price: '$4.99', per: 'month' }, annual: { amountCents: 4999, interval: 'year', price: '$49.99', per: 'year' } }`, `TRIAL_DAYS = 7`, `planForPrice(config, priceId) -> 'monthly'|'annual'|null`.
- `signature.js`: `verifyStripeSignature(rawBody: Buffer, header: string, secret: string, { toleranceSec = 300, now = Date.now } = {}) -> boolean`. Header format `t=<unix seconds>,v1=<hex>[,v1=<hex>...]`; signed string is `` `${t}.${rawBody}` ``; HMAC-SHA256; every `v1` is compared with `crypto.timingSafeEqual`; other schemes are ignored.
- `stripe.js`: `STRIPE_API_VERSION`; `class StripeError extends Error { status, code }`; `encodeForm(object) -> string` (nested keys as `a[b][0]=...`); `createStripe(config, { fetch = globalThis.fetch } = {})` returning, each a `Promise`:
  - `createCustomer({ userId, email })` (sends `Idempotency-Key: customer-<userId>`, `metadata[user_id]`)
  - `deleteCustomer(customerId)` (a 404 from Stripe counts as done)
  - `retrievePrice(priceId)`
  - `listOpenCheckoutSessions(customerId)`, `expireCheckoutSession(sessionId)`
  - `createCheckoutSession({ customerId, userId, priceId, trialDays, successUrl, cancelUrl })` (`mode=subscription`, one line item, `client_reference_id`, `subscription_data[trial_period_days]` only when `trialDays > 0`, `subscription_data[metadata][user_id]`)
  - `listSubscriptions(customerId)` (`status=all`)
  - `setCancelAtPeriodEnd(subscriptionId, value: boolean)`
  - `cancelSubscription(subscriptionId)` (immediately; "already cancelled" counts as done)
  - `subscriptionIdForCharge(chargeId) -> string|null` (the one place that knows how the pinned version links a charge to its subscription; today through invoice payments)
  - `createPortalSession({ customerId, returnUrl, cancelSubscriptionId? })` (`flow_data[type]=subscription_cancel` when the id is given)
  Every call: `Authorization: Bearer <secretKey>`, `Stripe-Version`, 10 second timeout, non-2xx throws `StripeError`. Calling any method when `config.stripe.ready` is false throws `StripeError(503)`.
- `stripe-fake.js`: `createFakeStripe({ prices }) -> { ...same methods, calls: [], state: { customers, sessions, subscriptions }, completeCheckout(sessionId, { status = 'trialing' }), setSubscription(id, patch), failNext(methodName) }` and `signedEvent(secret, { id, type, object }, { at = Date.now() }) -> { body: string, header: string }`.
- Start-up log (never a throw): with the switch on and keys missing, `[billing] SUBSCRIPTIONS is on but a Stripe setting is missing (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL): nobody can subscribe and the gate shows the invite code only.` With keys present, `[billing] Stripe keys are for TEST mode.` or `LIVE mode.` (from the `sk_test_` / `sk_live_` prefix).

- [ ] **Step 1: Write the failing tests** in `server/test/stripe.test.js`
  - `loadConfig`: no Stripe settings gives `stripe.ready === false` and `selling === false` and does not throw, in production too; three of four set is still not ready; all four with `SUBSCRIPTIONS=on` gives `selling === true`; all four with the switch off gives `ready` true and `selling` false.
  - `verifyStripeSignature`: accepts a payload signed with the secret; refuses a changed body, a wrong secret, a missing header, a header with no `v1`, a timestamp 6 minutes old, and a timestamp 6 minutes ahead; accepts when the second of two `v1` values is the right one.
  - `encodeForm`: `{ a: { b: [1, 2] }, c: true }` becomes `a[b][0]=1&a[b][1]=2&c=true`; values are URL-encoded; `undefined` is left out.
  - `createStripe` with a stub `fetch`: `createCheckoutSession` posts to `/v1/checkout/sessions` with the price, the customer, `client_reference_id`, and a trial only when asked; sends the bearer key and the pinned version; a 402 answer throws `StripeError` with Stripe's `code`; `deleteCustomer` treats 404 as success; the secret key never appears in a thrown message.
  - `planForPrice` maps the two configured ids and returns `null` for any other.
- [ ] **Step 2: Run `npm test` and confirm they fail** (modules missing).
- [ ] **Step 3: Implement the three modules, the fake, the settings and the log line.** Add the four settings to `.env.example` with one comment line each, empty.
- [ ] **Step 4: `npm test` passes, including every existing test.**
- [ ] **Step 5: Commit** `feat(server): Stripe client, settings and webhook signature check`.

### Task 2: migration, subscription status and checkout

**Files:**
- Create: `server/migrations/006_stripe.sql`, `server/src/functions/subscription.js`, `server/src/billing/sync.js` (the status half; Task 3 adds the rest)
- Modify: `server/src/app.js` (`createApp({ db, config, registry, stripe = createStripe(config) })`, `stripe` put on `ctx`), `server/src/functions/index.js` (register `subscription`, add it to `OPEN`, pass `stripe` to functions)
- Test: `server/test/api.test.js` (new `describe('subscribing on the website')`; `startApp(overrides, { stripe } = {})` gains the second argument)

**Interfaces:**
- Migration `006_stripe.sql` (everything this stage adds to the schema, in one file):
  - `users.stripe_customer_id text`, unique where not null. Not added to `server/entities/User.json`, for the reason `trial_used_at` is not: that file lists what a client may write.
  - `stripe_events (id text primary key, type text not null, received_at timestamptz not null default now())`.
  - `entitlements.trial_reminder_sent_at timestamptz` (Task 6); `entitlements.revoked_by text`, `entitlements.revoked_at timestamptz` (Task 7).
- Function `subscription` (any signed-in account):
  - `{ action: 'status' }` -> `{ selling: boolean, trial_available: boolean, customer: boolean, subscription: { plan, status, expires_at, cancel_at_period_end } | null, duplicate: boolean }`. `subscription` is the account's newest `stripe` row that is not `expired` or `revoked` (so a `grace` row past its allowance still shows, and the paywall can say why). `duplicate` is true with two or more live `stripe` rows. Makes no call to Stripe.
  - `{ action: 'checkout', plan: 'monthly'|'annual' }` -> `{ url }`. Errors, in this order:
    - `503 Subscriptions are not available right now.` when `config.selling` is false, or when the configured price at Stripe does not match the plan (amount, `usd`, interval; checked once per process with `retrievePrice` and remembered; a mismatch is also written to the error reports so the owner sees it).
    - `400 Choose the monthly or the annual plan.`
    - `409 You already have access, so there is nothing to pay.` when `accessOf` is allowed for any reason other than a subscription.
    - `409 You already have a subscription. Manage it in Settings.` when a live `stripe` row exists, or when Stripe lists a subscription for the customer that is not ended (it is synced first, so the person is let in).
    - `502 We could not reach the payment provider. Try again in a moment.` on any `StripeError`.
    - Rate limit: 10 an hour per account.
  - Checkout steps, under a row lock on the user so two tabs go one after the other: create the customer if the account has none and store the id; list and expire the customer's open checkout sessions; create the session with `trialDays = 7` only when `users.trial_used_at` is empty; `successUrl = <appUrl>/?checkout=success`, `cancelUrl = <appUrl>/?checkout=cancelled`.
- `sync.js` (this task): `stripeRowOf(db, userId) -> row|null`, `ensureCustomer(tx, stripe, user) -> customerId`.

- [ ] **Step 1: Failing tests** (apps started with `startApp({ subscriptions: true, selling: true, stripe: {...test ids} }, { stripe: fake })`)
  - `status says whether the server is selling`: default app `selling: false`; switch on without keys `false`; with both `true`; a new account has `trial_available: true`, `customer: false`, `subscription: null`.
  - `checkout returns Stripe's address and asks for a 7-day trial once`: the fake records `trialDays: 7`, the configured monthly price, `client_reference_id` equal to the user id; `users.stripe_customer_id` is set; with `trial_used_at` set the next checkout has no trial.
  - `checkout is not offered while the switch is off or the keys are missing`: 503 with the message; the fake saw no call.
  - `a price at Stripe that does not match the plan stops checkout`: fake price of 599 gives 503 and no session.
  - `someone with an invite code or a free pass is never sent to checkout`: 409 with the message; no customer is created.
  - `two checkouts at once share one Stripe customer and leave one open session`: two `checkout` calls fired together; the fake holds one customer and one open session, the other expired.
  - `checkout is refused once a subscription exists at Stripe, even before its webhook`: `fake.completeCheckout(...)` with no webhook, then `checkout` gives 409, and the account's entity calls now succeed.
  - `a Stripe failure is a clear 502 and nothing is half-made`: `fake.failNext('createCheckoutSession')`; the message is ours, not Stripe's.
  - `the subscription function is open to an account without access, and closed to nobody signed in`: 200 for a legacy account, 401 without a token.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** The fallback `psql` test driver is not transactional (`server/test/psql-db.js`); the two-tabs test is skipped under it with a stated reason, as it needs real locks.
- [ ] **Step 4: `npm test` passes.**
- [ ] **Step 5: Commit** `feat(server): subscription status and Stripe Checkout`.

### Task 3: the webhook keeps the entitlement right

**Files:**
- Create: `server/src/billing/webhook.js`
- Modify: `server/src/billing/sync.js`, `server/src/lib/http.js` (`Router.add(method, pattern, handler, { raw = false } = {})`; `match` returns `raw`), `server/src/app.js` (does not read JSON for a raw route; calls `registerBillingRoutes(router)`)
- Test: `server/test/stripe.test.js` (the mapper), `server/test/api.test.js` (new `describe('Stripe webhook')`)

**Interfaces:**
- `POST /api/stripe/webhook`, no sign-in, raw body read with `readBody(req, 1 MB)`.
  - `404 Not found` when `config.stripe.ready` is false.
  - `400 Invalid signature.` when `verifyStripeSignature` fails; nothing is read from the body first.
  - `200 { received: true }`; `200 { received: true, duplicate: true }` for an event id already in `stripe_events`.
  - A failure while handling (Stripe unreachable, database error) answers 500 and records nothing in `stripe_events`, so Stripe sends it again.
- `sync.js`:
  - `entitlementFromSubscription(config, subscription, now = new Date()) -> { external_id, status, plan, expires_at, cancel_at_period_end, trial_started_at } | null`. Stripe status to ours: `trialing` -> `trial`; `active` -> `active`; `past_due` -> `grace` with `expires_at` at the start of the unpaid period; `canceled`, `unpaid`, `incomplete_expired`, `paused` -> `expired` with `expires_at` at `ended_at` (or `canceled_at`, or now); `incomplete` -> `null` (nothing written). `expires_at` otherwise is the item's `current_period_end` (top-level as a fallback). `plan` from `planForPrice`; an unknown price gives `plan: null` and a warning, never a refusal.
  - `syncCustomer(db, stripe, config, customerId) -> Promise<{ userId, rows } | null>`: finds the user by `stripe_customer_id` (`null` when there is none, for example a deleted account); then in one transaction takes `pg_advisory_xact_lock` on the customer id, lists the customer's subscriptions, and upserts each on `(source, external_id)`. A row that is `revoked` is never changed. `user_id` is never changed on conflict. Sets `users.trial_used_at = coalesce(trial_used_at, <trial start>)` when a subscription has a trial.
  - `handleStripeEvent(db, stripe, config, event) -> Promise<'handled'|'ignored'|'duplicate'>`: inserts the event id (same transaction as the work), reads only `event.type` and `event.data.object.customer` (and for a refund `object.id` and `object.refunded`), then:
    - `checkout.session.completed`, `customer.subscription.created|updated|deleted|trial_will_end`, `invoice.paid`, `invoice.payment_failed`: `syncCustomer`.
    - `charge.refunded` with `refunded === true`: find the subscription with `subscriptionIdForCharge` (or, when Stripe cannot say and the account has exactly one `stripe` row that is not ended, that one); `cancelSubscription` at Stripe; set the row `revoked`, `note 'Refunded'`, `expires_at now`, `cancel_at_period_end false`; then `syncCustomer`. When it cannot tell which of two, it ends neither and writes an error report: `Refund received for <customer id> but the subscription could not be identified. Cancel it in Stripe.`
    - anything else: `'ignored'` (still recorded, still 200).
  - Rows in `stripe_events` older than 30 days are deleted when a new one is written.

  This covers the list in the design: checkout completed, trial started, renewal, payment failure (grace), cancel at period end, resume, final cancellation or expiry, refund.

- [ ] **Step 1: Failing tests.** Each webhook test sets the state in the fake, then posts an event made with `signedEvent`.
  - Mapper (pure): one case per Stripe status above; period end read from the item; `past_due` uses the period start; unknown price gives `plan: null`.
  - `an unsigned or wrongly signed notice is refused and changes nothing`: 400, no row, no `stripe_events` row; also a correct signature over a different body.
  - `the webhook is not there without the keys`: default app answers 404.
  - `checkout completed opens the account`: `trial` row, `plan 'monthly'`, `expires_at` 7 days out, `trial_used_at` set, entity calls succeed, `inviteAccess` status says `reason 'trial'`, `source 'stripe'`.
  - `renewal moves the end date and clears grace`: trial -> `active` with the new period end; `grace` -> `active`.
  - `a failed payment keeps access for three days and no longer`: row `grace`; allowed 2 days after the period ended, refused after 4 (set `expires_at` in the fake, as the stage 1 tests do with dates).
  - `cancel at period end, then resume`: flag true and access kept; flag false again.
  - `final cancellation ends access`: `expired`; entity calls 403.
  - `a refund without a free pass ends access immediately`: row `revoked`, note `Refunded`, the fake saw `cancelSubscription`, entity calls 403 straight away although the period had weeks left.
  - `a refund ends the paid row and leaves a free pass standing`: account with an invite code and a subscription; after the refund `inviteAccess` status is allowed with `reason 'invite'`.
  - `two subscriptions on one account: refunding one leaves the other`: both rows exist, `status.duplicate` true; refund of the first revokes only it; access holds with `reason 'subscription'`.
  - `a repeated event changes nothing`: same event id twice; second answer has `duplicate: true`; `updated_date` unchanged; the fake saw one list call.
  - `an old notice arriving after cancellation does not reopen access`: Stripe says cancelled, then a `customer.subscription.created` notice arrives; row stays `expired`. Same for `revoked` after a refund followed by `customer.subscription.updated`.
  - `a notice is asked for again when Stripe cannot be reached`: `fake.failNext('listSubscriptions')` gives 500 and no `stripe_events` row; the same event sent again is handled.
  - `a notice for a customer we do not know is accepted and ignored`: 200, nothing written.
  - `a partial refund changes nothing`.
  - `no card details are stored`: after a full flow, no column of `users`, `entitlements` or `stripe_events` for that account holds anything but ids beginning `cus_`, `sub_`, `evt_`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test` passes.**
- [ ] **Step 5: Commit** `feat(server): Stripe webhook, verified and safe to repeat`.

### Task 4: reconcile, the portal and resume

**Files:**
- Modify: `server/src/functions/subscription.js`, `server/src/functions/inviteAccess.js`, `server/src/billing/sync.js`
- Test: `server/test/api.test.js` (new `describe('when the webhook is late')`)

**Interfaces:**
- `subscription` gains (all need `config.stripe.ready`, else `503 Subscriptions are not available right now.`; all map `StripeError` to the 502 message):
  - `{ action: 'refresh' }` -> the `status` answer plus `allowed: boolean`. Runs `syncCustomer` for the account's own customer id; with no customer it only reads. Takes nothing from the caller that names a session or a subscription. Rate limit: 30 per 15 minutes per account.
  - `{ action: 'portal', flow?: 'cancel' }` -> `{ url }`; `returnUrl = <appUrl>/settings?billing=updated`; with `flow: 'cancel'` it opens Stripe's cancel confirmation for the account's subscription. `404 You do not have a subscription to manage.` with no customer.
  - `{ action: 'resume' }` -> the `status` answer; `setCancelAtPeriodEnd(id, false)` then `syncCustomer`. `400 Your subscription is not set to end, so there is nothing to resume.`
- `inviteAccess` `status`: when the account is not allowed, has a customer id and the keys are present, it runs `syncCustomer` once (at most once every 5 minutes per account, in memory) and answers from the result. A Stripe failure here is swallowed and the answer is the stored one. This is what protects a phone-only payer whose renewal notice was lost: the phone only ever calls `inviteAccess`. Response shape unchanged.

- [ ] **Step 1: Failing tests**
  - `a payer whose webhook never arrives is let in on return from checkout`: checkout, `fake.completeCheckout`, no webhook; `refresh` answers `allowed: true` with a `trial` subscription; entity calls succeed; `trial_used_at` is set.
  - `refresh for someone who abandoned checkout stays closed`: session never completed; `allowed: false`, no row.
  - `refresh cannot be pointed at someone else's subscription`: a body carrying another account's `subscription_id` or `customer` is ignored; the caller stays closed.
  - `a lost renewal is repaired when the phone asks for its status`: row expired 5 days ago, Stripe says `active`; `inviteAccess` status answers allowed and the row has the new end date; a second call within 5 minutes makes no Stripe call.
  - `the status check still answers when Stripe is down`: `failNext('listSubscriptions')`; 200 `allowed: false`.
  - `the portal link is made for the account's own customer`, `the cancel link names the account's subscription`, `no customer, no portal` (404 and message).
  - `resume clears the end date at Stripe and here`; `resume with nothing to resume` (400 and message).
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test` passes.**
- [ ] **Step 5: Commit** `feat(server): reconcile with Stripe, portal link and resume`.

### Task 5: a deleted account is never billed

**Files:**
- Modify: `server/src/auth/routes.js` (`DELETE /api/auth/me`)
- Test: `server/test/api.test.js` (extend `describe('your data')`)

**Interfaces:**
- `DELETE /api/auth/me`: after the password check, when the account has a `stripe_customer_id`: `deleteCustomer` first, then the user row. On a `StripeError`, or when the keys are missing, `502 We could not cancel your subscription, so your account was not deleted. Try again in a few minutes, or email info@dtisys.com.` and nothing is deleted. An account with no customer id is deleted exactly as today, with no Stripe call.

- [ ] **Step 1: Failing tests**
  - `deleting an account deletes its Stripe customer first`: the fake's `calls` show `deleteCustomer` before the row goes; the fake's subscription is cancelled; the user and its entitlements are gone.
  - `the account is kept when Stripe cannot be reached`: `failNext('deleteCustomer')`; 502 with the message; the user can still sign in; trying again succeeds.
  - `the account is kept when the keys have been removed`: an account with a customer id on an app with no keys gets the 502.
  - `a wrong password never reaches Stripe`: 401, no call.
  - `an account that never subscribed is deleted with no Stripe call`.
  - `the cancellation notice that follows a deleted account is accepted`: `customer.subscription.deleted` for the gone customer answers 200.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test` passes.**
- [ ] **Step 5: Commit** `fix(server): cancel at Stripe before an account is deleted`.

### Task 6: the trial-ending reminder

**Files:**
- Create: `server/src/billing/reminders.js`
- Modify: `server/src/index.js` (run once at start and every hour, `unref`'d, only when `config.stripe.ready`)
- Test: `server/test/api.test.js` (new `describe('trial reminder')`)

**Interfaces:**
- `sendTrialReminders({ db, config, now = new Date(), send = sendMail }) -> Promise<number>` (how many were sent). Picks `stripe` rows with `status 'trial'`, `cancel_at_period_end false`, `trial_reminder_sent_at` empty and `expires_at` between `now` and `now + 48 hours`; claims each by setting `trial_reminder_sent_at` in the same statement that selects it, then sends. If a mail key is set and the provider refuses the message, the claim is cleared so the next hour tries again.
- The email (plain text, like the others):
  - Subject: `Your VantraRun free trial ends on <Month D, YYYY>`
  - Body: `Your VantraRun free trial ends on <Month D, YYYY>. On that day your card will be charged <$4.99|$49.99> for the <monthly|annual> plan, and it renews every <month|year> at that price until you cancel.` / blank line / `To cancel before you are charged, sign in at <appUrl>/settings and choose "Cancel subscription". You keep access until the trial ends and pay nothing.` / blank line / `Questions: info@dtisys.com`

- [ ] **Step 1: Failing tests**
  - `a trial ending within two days gets one reminder`: sent once with the date, the amount for the plan and the settings address; a second sweep sends nothing.
  - `no reminder three days out, none after the trial has ended`.
  - `no reminder for a trial already cancelled`, `none for an active subscription`, `none for a free pass`.
  - `a refused message is tried again`: `send` answers `{ delivered: false }` with a mail key set; the claim is cleared; the next sweep sends.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test` passes.**
- [ ] **Step 5: Commit** `feat(server): email two days before a free trial ends`.

### Task 7: stage 1 gaps on the server

**Files:**
- Modify: `server/src/functions/adminAccess.js`, `server/src/access.js` (`grantFree` clears `revoked_by` and `revoked_at` when it brings a pass back), `server/entities/AccessGrant.json`, `server/src/auth/routes.js`, `server/src/config.js`, `server/src/app.js` (pass `config` to `registerAuthRoutes`)
- Test: `server/test/api.test.js`

**Interfaces:**
- **Gap 1.** `adminAccess` `revoke` also sets `revoked_by = <admin email>` and `revoked_at = now()`. Each entitlement in `list` gains `revoked_by`, `revoked_at`, `cancel_at_period_end` and, for paid rows, `external_id` (the subscription id, so the owner can find it in Stripe; admins only).
- **Gap 2.** `AccessGrant.json`: `create`, `update` and `delete` become a rule nobody passes; `read` is unchanged. The server's own writes (`claimInvite`) do not go through the entity API and are unaffected. The builder checks that `server/src/entities/registry.js` accepts the rule form chosen (`rules.js` treats a rule that is not an object as "nobody").
- **Gap 4.** No challenge service is added (it would be a third party). Limits instead, the new ones applying only to a sign-up with no invite code while the switch is on:
  - per address: 3 verification emails an hour and 8 a day (today 6 an hour), counted across `register`, `resend-otp` and the sign-in that re-sends a code;
  - per network: 10 code-less sign-ups an hour (`Too many sign-ups from this network. Try again later.`);
  - across everyone: `config.signup.openMailsPerHour` (default 300) verification emails an hour for code-less sign-ups; beyond it `429 Sign-up is busy right now. Try again in an hour.` and one error report so the owner sees it;
  - a second code is not mailed to an address that was sent one in the last 60 seconds (the answer is the same `{ ok: true }`).
  Sign-up with an invite code, and everything while the switch is off, keeps today's limits and messages.

- [ ] **Step 1: Failing tests**
  - `a removed pass records who removed it and when`; `granting again clears that record`.
  - `nobody can write AccessGrant through the entity API`: an admin's create, update, delete, bulk create and `deleteMany` are refused; the admin can still list; a runner still reads only their own row; redeeming a code still writes the row.
  - `open sign-up mails one address at most three times an hour`, `at most ten code-less sign-ups an hour from one network` (the suite sends its own forwarded address, as the existing sign-up tests do), `the hourly ceiling for everyone holds` (app started with `signup: { openMailsPerHour: 3 }`), `a second code within a minute is not mailed`.
  - `sign-up with an invite code keeps the old limits`, `with the switch off nothing changed`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** Existing tests that write `AccessGrant` through the API are changed to assert the refusal or to insert directly, one by one; none is deleted without a replacement.
- [ ] **Step 4: `npm test` and `npm run e2e` pass.**
- [ ] **Step 5: Commit** `fix(server): record who revoked, lock AccessGrant, tighten open sign-up`.

### Task 8: the website paywall and the mid-session refusal

**Files:**
- Create: `web/src/components/access/Paywall.jsx`, `web/src/components/access/InviteCodeForm.jsx` (the code field and button lifted out of the gate, same markup and messages), `web/src/components/privacy/DeleteAccountDialog.jsx` (lifted out of `DataControls.jsx`, same copy), `web/src/lib/plans.js`
- Modify: `web/src/components/access/AccessGate.jsx`, `web/src/components/privacy/DataControls.jsx`, `web/src/api/client.js`, `server/src/access.js` (`requireAccess` adds `code: 'no_access'` to the 403 body), `docs/native-contract.md` (the added field)
- Test: `server/test/api.test.js` (the 403 body), browser tests in Task 13

**Interfaces:**
- Server: the access refusal body becomes `{ error: <same message>, code: 'no_access' }`. Status and message unchanged; the phone sorts by status only.
- `client.js`: in `request`, a 403 whose body has `code === 'no_access'` dispatches `window` event `vantrarun:no-access` before throwing as now. Exports `NO_ACCESS_EVENT`. No other 403 (`Admins only`, unverified email) triggers it.
- `AccessGate.jsx`: listens for the event while `allowed`; on it, asks `inviteAccess` status again and, if not allowed, shows the gate. When blocked: `status.subscriptions` false shows today's "Invite only" card, unchanged; true renders `<Paywall>`. `Paywall` asks `subscription` status and falls back to the same "Invite only" card when `selling` is false.
- `plans.js`: `PLANS` (id, name, price, per), `ANNUAL_SAVING = '$9.89'` (12 x $4.99 = $59.88, less $49.99), `TRIAL_DAYS = 7`, `REFUND_DAYS = 14`, `SUPPORT_EMAIL = 'info@dtisys.com'`.
- Paywall copy, exactly:
  - Heading: `Start with 7 days free` (trial available) or `Subscribe to VantraRun` (trial used).
  - Under it: `VantraRun coaches each run against your own five zones, with routes, history and challenges.`
  - Plan choices (annual selected first): `Annual` / `$49.99 a year` / badge `Save $9.89 a year`; `Monthly` / `$4.99 a month`.
  - Terms, directly above the button, for the selected plan: `7 days free, then $4.99 a month.` or `7 days free, then $49.99 a year.`; with the trial used: `$4.99 a month, charged today.` or `$49.99 a year, charged today.`
  - `Renews automatically until you cancel. Cancel any time in Settings, under Subscription; you keep access to the end of the period you paid for.`
  - With a trial: `Cancel before the trial ends and you pay nothing. We email you two days before it ends.`
  - `Monthly payments are not refundable. An annual payment is refunded in full if you ask within 14 days of the charge: email info@dtisys.com.`
  - Button: `Subscribe` (busy: `Opening checkout…`).
  - Under the button: `By subscribing you agree to the Terms of use and the Privacy policy. Payment is taken by Stripe; VantraRun never sees your card number.` with links to `/terms` and `/privacy`.
  - Bottom: a button `I have an invite code` that opens `InviteCodeForm`.
  - Footer: the account's email, `Sign out`, `Delete account` (opens `DeleteAccountDialog`).
  - When `subscription.status` is `grace` and the account is not allowed: heading `Your last payment did not go through`, text `Update your card to get back in. You have not been charged.`, button `Update payment details` (portal), and no plan choices.
- Return from Stripe: on `?checkout=success` the paywall shows `Confirming your subscription…` and calls `refresh` at once and then every 2 seconds for up to 30 seconds; when `allowed` it removes the query from the address and opens the app. After 30 seconds: `We could not confirm your payment yet. If you finished checkout, wait a minute and press Check again. You will not be charged twice.` with a `Check again` button. On `?checkout=cancelled`: the paywall with `Checkout was cancelled. Nothing was charged.`
- Errors from `checkout` are shown as the server worded them. A 409 "already have a subscription" runs `refresh` and opens the app if allowed.
- Gap 3: the delete dialog on the paywall is the same one as in Settings. Its description gains one sentence in both places: `A subscription bought on the website is cancelled and you are not charged again.` The separate "Delete all training data" control is not offered on the paywall: deleting the account removes that data, and the wipe calls are refused without access.

- [ ] **Step 1: Failing test** in `server/test/api.test.js`: the refusal body is `{ error, code: 'no_access' }` on an entity call, an upload and a function; `Admins only` carries no `code`. Update the stage 1 assertions that compare the whole body.
- [ ] **Step 2: Run and confirm it fails.**
- [ ] **Step 3: Implement the server change, then the website.** With the switch off the gate must render exactly as today (the existing browser tests are the check).
- [ ] **Step 4: `npm test`, `npm run lint`, `npm run build`, `npm run e2e` pass.**
- [ ] **Step 5: Commit** `feat(web): paywall with Stripe checkout, and a way out of a mid-session refusal`.

### Task 9: the Subscription card in Settings

**Files:**
- Create: `web/src/components/settings/SubscriptionCard.jsx`
- Modify: `web/src/pages/Settings.jsx` (after `<AccountCard />`)
- Test: browser tests in Task 13

**Interfaces:**
- Shown only when `subscription` status has a `subscription`. Hidden for admins, invite codes and free passes with no Stripe subscription. On `?billing=updated` (return from the portal) it calls `refresh` first.
- Copy, by state:
  - Title `Subscription`; plan line `Monthly plan, $4.99 a month` or `Annual plan, $49.99 a year`.
  - `trial`: `Free trial. Ends on <date>, then <price> a <month|year>.`
  - `active`: `Renews on <date>.`
  - cancelled (`cancel_at_period_end`): `Ends on <date>` and, during a trial, `You will not be charged.`; button `Resume`. After resuming: `Your subscription continues.`
  - `grace`: `Your last payment did not go through. Update your card to keep access.`; button `Update payment details`.
  - Always: button `Manage subscription` (portal: card, invoices). When not cancelled: link `Cancel subscription` (portal cancel flow, so cancelling is two taps: this link, then Stripe's confirmation).
  - `duplicate`: `You have two subscriptions. Email info@dtisys.com and we will refund one.`
  - Under the card, small: `Monthly payments are not refundable. Annual: full refund within 14 days of the charge, on request to info@dtisys.com.` with a link to `/terms`.
- Dates use `toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })`.

- [ ] **Step 1: Write the browser tests listed in Task 13 for this card first if Task 13's server is already in place; otherwise build the card and have Task 13 cover it.**
- [ ] **Step 2: Implement.**
- [ ] **Step 3: `npm run lint`, `npm run build`, `npm run e2e` pass.**
- [ ] **Step 4: Commit** `feat(web): Subscription card in Settings`.

### Task 10: Terms of use, and the privacy policy names the payment providers

**Files:**
- Create: `web/src/pages/Terms.jsx` (same layout as `web/src/pages/Privacy.jsx`)
- Modify: `web/src/App.jsx` (public route `/terms`), `web/src/pages/Privacy.jsx`, `web/src/lib/consent.js` (`POLICY_UPDATED`, `CONSENT_VERSION` set to the day this ships, and a new `TERMS_UPDATED`), `web/src/pages/Register.jsx` (one line under the form: `By creating an account you agree to the Terms of use and the Privacy policy.`)
- Test: browser tests in Task 13 (`/terms` and `/privacy` open signed out)

**Both pages need the owner's legal review before the switch is turned on.** Each file carries a comment at the top saying so, and Task 14 puts it in the launch checklist. Nothing about the review is shown to visitors.

**Interfaces:**
- Terms sections and their binding sentences:
  - `The service`: what VantraRun is; run by Dynamic Technology Integration; contact info@dtisys.com; sold in the United States.
  - `Your account`: one person per account; keep the password private; 13 or older.
  - `Subscription and free trial`: `VantraRun costs $4.99 a month or $49.99 a year when bought on the website.` `A new subscription starts with 7 days free, once per person. A payment card is needed to start the trial.` `If you do not cancel before the trial ends, the plan you chose is charged on the day it ends.` `We email you two days before the trial ends.`
  - `Automatic renewal`: `Your subscription renews automatically at the same price every month or every year until you cancel.` `If a payment fails we try again; access ends three days after the period you paid for if no payment succeeds.`
  - `Cancelling`: `You can cancel at any time in Settings, under Subscription. Access continues to the end of the period you have paid for and you are not charged again.` `A subscription you have cancelled can be resumed until that date.`
  - `Refunds`: `Monthly payments are not refundable once charged.` `An annual payment is refunded in full if you ask within 14 days of the charge, by emailing info@dtisys.com from the address on your account. Access ends when the refund is made.`
  - `Purchases made in the iPhone app`: `Subscriptions bought in the iPhone app are billed by Apple, at the price shown there. Apple handles cancellations and refunds for those purchases through your Apple account; we cannot grant or refuse them.`
  - `Invite codes and free access`: free access can be given and withdrawn by us; no payment details are asked for.
  - `Deleting your account`: cancels a website subscription; time left is not refunded except as under Refunds.
  - `Not medical advice` (the sentence already on the privacy page), `Acceptable use`, `Changes to the price or these terms` (notice by email at least 30 days before a price change takes effect at renewal), `Liability`, `Governing law` (left for the owner's lawyer: state to be named), `Contact`.
- Privacy changes:
  - `Who this covers`: drop "is in invite-only testing".
  - `What we collect`, new paragraph: `Subscription: whether you have one, the plan, when it renews or ends, and the reference numbers the payment provider gives us for you and your subscription. We never receive or store your card number.`
  - `How we use it`: mail now includes `a reminder before a free trial ends`.
  - `Companies that help run the service`, new paragraph: `Payments: subscriptions bought on the website are paid through Stripe, which receives your email address and the payment details you enter on its checkout page. Subscriptions bought in the iPhone app are paid through Apple with your Apple account. Each tells us only whether your subscription is active.`
  - `How long we keep it`: `Deleting your account also deletes your customer record at Stripe and cancels a website subscription. Stripe and Apple keep their own records of past payments as the law requires of them.`
  - `Your choices`: account deletion is also on the subscription screen for someone who has not subscribed.

- [ ] **Step 1: Implement the page, the route and the privacy edits.**
- [ ] **Step 2: `npm run lint`, `npm run build`, `npm run e2e` pass** (the consent screen reappears for existing e2e accounts only if a spec signs in after the version change; adjust helpers, not assertions).
- [ ] **Step 3: Commit** `feat(web): Terms of use, and the privacy policy names Stripe and Apple`.

### Task 11: the owner sees Stripe subscriptions in plain words

**Files:**
- Modify: `web/src/components/admin/AccessCard.jsx`
- Test: `e2e/01-admin.spec.mjs` is unchanged; the new labels are checked in Task 13's spec

**Interfaces:**
- Uses the fields Task 7 added. Labels: `Subscribed (monthly)` / `Subscribed (annual)`; `Trial (monthly)` / `Trial (annual)` with `Trial ends <date>`; `Renews <date>`; cancelled: `Ends <date>`; `grace`: `Payment failed, access until <date>`; a `revoked` Stripe row with note `Refunded`: `Refunded <date>`; `expired`: `Ended <date>`.
- A person with two live paid rows shows `Two subscriptions: refund one in Stripe`.
- A paid row shows its subscription id in small type (to search for in Stripe). A removed free pass shows `Free access removed by <email> on <date>`.
- The existing sentence stays: `Paid subscriptions are cancelled with the payment provider.` No button changes a paid row.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: `npm run lint`, `npm run build`, `npm run e2e` pass.**
- [ ] **Step 3: Commit** `feat(web): Stripe subscriptions in the admin access list`.

### Task 12: the phone's confirm screen asks for the password

**Files:**
- Modify: `native/app/signup.tsx`
- Test: `native` checks (`npm run check` in `native/`); the server rule is already tested (`with subscriptions on the password is required`)

**Interfaces:**
- Gap 5. When the code step is reached from sign-in (`verify=1`, so no password is in hand), the screen shows a `Password` field above the code with the help text `Enter the password you chose when you signed up.`, and `Confirm` stays disabled until it has 8 or more characters. The password is sent with the code through the existing `verifyEmailCode(email, code, password)`. Reached from sign-up, the screen is unchanged.
- Nothing else on the phone changes in this stage. Its invite screen still says "invite-only" to an account without access; a person who subscribes on the website is let in by the existing `allowed` check. The phone paywall is stage 3.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: `npm run check` in `native/` passes.**
- [ ] **Step 3: Commit** `fix(native): confirming an email from sign-in sends the password`.

### Task 13: browser tests against a second server with subscriptions on

**Files:**
- Modify: `e2e/start-server.mjs`, `e2e/fixtures.mjs`, `playwright.config.mjs`
- Create: `e2e/05-subscribe.spec.mjs`

**How:** the existing server and its four specs are untouched and keep `SUBSCRIPTIONS: 'off'`. `playwright.config.mjs` changes `webServer` to a list of two; the second entry runs `node e2e/start-server.mjs subscriptions`. In that mode the script uses port `PORT + 1` and the database `fitpro_e2e_subs` (the "must contain e2e" guard still applies), sets `SUBSCRIPTIONS: 'on'` and test Stripe ids, and, instead of importing `server/src/index.js`, builds the app itself with `createApp({ db, config, registry, stripe: createFakeStripe(...) })` from `server/test/stripe-fake.js`. It answers three test-only addresses in front of the app: `/__stripe/checkout?session=...` (marks the fake session paid and redirects to the success address, sending no webhook), `/__stripe/portal?...` (applies cancel, then redirects to the return address) and `POST /__stripe/control` (lets a spec set a subscription's state and send a signed event). No production file learns about any of this. `fixtures.mjs` exports `SUBS_BASE_URL`; the spec starts with `test.use({ baseURL: SUBS_BASE_URL })`. The second server does not build the website again; it serves the same `web/dist`.

- [ ] **Step 1: Write the spec (it fails until the second server exists)**
  - `sign-up without a code lands on the paywall, not in the app`: the heading, both prices, `Save $9.89 a year`, `7 days free, then $49.99 a year.`, the renewal, cancel and refund sentences, links to `/terms` and `/privacy` that open while signed out, `Sign out`, `Delete account`; no app navigation.
  - `subscribing opens the app although no webhook arrives`: choose Monthly, `Subscribe`, the fake checkout returns, `Confirming your subscription…`, then the consent screen and the app.
  - `Settings shows the trial, cancelling shows "Ends on" with Resume, and Resume puts it back`.
  - `the owner sees the subscriber as "Trial (monthly)"`.
  - `a refund in the middle of a session sends the person to the paywall`: with the app open, the control address refunds; the next navigation shows the paywall and no error toast or broken screen (`watchForTrouble` stays empty of 5xx).
  - `an invite code entered on the paywall opens the app with no card asked for`.
  - `a person can delete their account from the paywall`.
  - `cancelled checkout says nothing was charged`.
- [ ] **Step 2: Run `npm run e2e` and confirm the new spec fails for the right reason.**
- [ ] **Step 3: Implement the second server mode.**
- [ ] **Step 4: `npm run e2e` passes, both servers; `npm run check` passes.** `.github/workflows/checks.yml` needs no change: the script creates its database on first use.
- [ ] **Step 5: Commit** `test(e2e): subscribe, cancel, refund and delete against a second server`.

### Task 14: documents and hosting settings

**Files:**
- Modify: `docs/architecture.md`, `docs/decisions.md`, `docs/launch-checklist.md`, `docs/native-contract.md`, `render.yaml`, `README.md` (only if it describes the gate), `.env.example` (check Task 1's entries read well)

- [ ] **Step 1: Update the documents; no behaviour change.**
  - `architecture.md`: `src/billing/` (the five files and what each does), the `subscription` function, `POST /api/stripe/webhook`, the `stripe` row in "Who may use the product" (now "in use"), the status mapping table, "ask Stripe, do not trust the notice", what is open without access (`subscription` joins `inviteAccess`), and the diagram gains Stripe.
  - `decisions.md`: a dated entry for each item under "Decisions taken in this plan"; the "Known gaps" list rewritten as closed, each with its commit; what is not handled (card disputes, plan switching, partial refunds, sales tax) and why.
  - `native-contract.md`: the `code: 'no_access'` field; `inviteAccess` status may now ask Stripe and so can take a little longer; nothing removed.
  - `render.yaml`: four entries with `sync: false`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`. `SUBSCRIPTIONS` stays out of the file, set by hand when the time comes.
  - `launch-checklist.md`: a new step, "Payments (Stripe)", test mode first, for the owner:
    1. Create the Stripe account for the company and finish its business details and bank account.
    2. Stay in **test mode**. Product catalogue: one product `VantraRun`, two recurring prices in USD: $4.99 monthly, $49.99 yearly. Copy both price ids (`price_...`).
    3. Developers, API keys: copy the secret key (`sk_test_...`).
    4. Developers, Webhooks: add an endpoint `https://<site>/api/stripe/webhook` with these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`. Copy its signing secret (`whsec_...`).
    5. Settings, Billing, Customer portal: allow updating the payment method and viewing invoices; allow cancelling, **at the end of the billing period**; switch plan changes off; set the links to `https://<site>/terms` and `https://<site>/privacy`.
    6. Settings, Billing, Subscriptions and emails: leave Stripe's free-trial reminder email **off** (VantraRun sends its own two days before); set failed-payment retries as you prefer and "if all retries fail" to **cancel the subscription**.
    7. Render, the service, Environment: add the four `STRIPE_*` values by hand (an existing service is not asked for new `sync: false` values). Leave `SUBSCRIPTIONS` unset. The log shows `[billing] Stripe keys are for TEST mode.`
    8. Set `SUBSCRIPTIONS=on` on a site that is not yet public, and run the test list: subscribe with Stripe's test card, see the app open; cancel and resume in Settings; refund the annual charge in Stripe's dashboard and see access end; delete an account and see its customer gone in Stripe; check Settings, Who has access.
    9. Going live: repeat steps 2 to 5 in live mode (live prices, live key, a live webhook endpoint with its own secret), replace the four values, and only then set `SUBSCRIPTIONS=on`. Never turn the switch off as a way to stop billing: it stops new sales only.
    Also: "Decisions still yours" gains the legal review of `/terms` and `/privacy`, sales tax, and whether Stripe's own trial email should also be on; "what to check" gains `<site>/api/auth/options` showing `"subscriptions":true` and a webhook delivery marked succeeded in Stripe.
- [ ] **Step 2: Commit** `docs: Stripe subscriptions, owner's set-up steps and hosting settings`.

---

## Checked against Stripe's own planner (27 November 2026)

Stripe's implementation planner was run for this business in the sandbox. Its recommendation matches this plan: Stripe-hosted Checkout in subscription mode, flat-rate recurring prices, a free trial with the card on file, the hosted customer portal, and the same webhook events this plan listens to.

Points it adds, for the builder:

- **Payment methods:** do not send `payment_method_types` on the Checkout Session; let Stripe choose them from the dashboard settings.
- **Billing mode:** Stripe now recommends "flexible" billing mode for new subscriptions. Check whether Checkout accepts it under `subscription_data` in the pinned API version and use it if so; record the answer in `docs/decisions.md`.
- **Failed payments:** Stripe's Smart Retries and failed-payment emails are dashboard settings (Billing, Revenue recovery). The retry window chosen there should not be longer than the access allowed after a failed payment, or a person could be charged after losing access. Add both settings to the launch checklist.
- **Tax:** switch on Stripe Tax threshold monitoring (free) so the owner is warned when a state's sales-tax threshold is near. Collection stays off.

Points where this plan knowingly differs:

- Stripe prefers its SDK; this plan calls the HTTPS API directly (decision 1).
- Stripe's trial example uses its newer "trial offers" with Accounts v2 customers and subscriptions created directly. That path does not go through hosted Checkout, so this plan keeps the trial on the Checkout Session.
- Stripe offers "Managed Payments" (Stripe as the seller of record, handling tax and fraud for a higher fee). Not chosen; it is the owner's call and can be revisited.
