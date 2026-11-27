# Architecture

```
 ┌──────────────┐     ┌──────────────┐
 │  web (Vite)  │     │ native (Expo)│
 │  React SPA   │     │ iOS/Android  │
 └──────┬───────┘     └──────┬───────┘
        │  HTTPS + JSON, Authorization: Bearer <token>
        └──────────┬─────────┘
            ┌──────▼───────┐        ┌───────────────┐
            │  server/     │───────▶│ Valhalla      │ route snapping
            │  Node API    │        │ (OSM, public) │
            │              │        └───────────────┘
            │              │        ┌───────────────┐
            │              │◀──────▶│ Stripe        │ website subscriptions:
            └──────┬───────┘        └───────────────┘ API calls out, webhooks in
                   │ SQL
            ┌──────▼───────┐        ┌───────────────┐
            │ Postgres 16  │        │ uploads/ dir  │ (object storage later)
            └──────────────┘        └───────────────┘
```

## What replaced each Base44 feature

| Base44 | Now | Where |
| --- | --- | --- |
| `base44.entities.X.*` | `/api/entities/X/*`, same methods and return shapes | `server/src/entities/` |
| Entity schemas + RLS rules | Same JSON files, enforced by the API | `server/entities/*.json`, `rules.js` |
| Entity storage (hosted, schemaless) | One Postgres table per entity | `server/migrations/` |
| `base44.functions.invoke(name)` | `POST /api/functions/:name`, same bodies | `server/src/functions/` |
| Email + password auth, email code | `/api/auth/*`, scrypt hashes, signed tokens | `server/src/auth/` |
| Password reset | Emailed one-time link | `server/src/auth/routes.js` |
| `UploadPublicFile` | `POST /api/uploads` to local disk | `server/src/uploads.js` |
| Google sign-in, MFA | **Not built yet** (buttons show a clear message) | see decisions.md |
| Hosting | Not chosen yet | see decisions.md |

The web app talks to the API through `web/src/api/client.js`, which has the same
surface as the Base44 SDK (`api.entities.Run.list(...)`, `api.auth.me()`,
`api.functions.invoke(...)`). Pages and components only changed their import.

## Server

Plain `node:http`, one runtime dependency (`pg`). No framework, so there is very
little to learn or upgrade.

- `src/app.js`: request handling, CORS, error responses (`{ "error": "..." }`
  everywhere, matching what the native contract promises).
- `src/auth/`: sign-up with an emailed 6-digit code, sign-in, password change
  and reset, account deletion. Passwords are hashed with scrypt. Access tokens
  are HS256 JWTs carrying the user id and a `token_version`; changing the password
  bumps the version, which signs out every other device.
- `src/entities/`: generic storage for every entity. `registry.js` reads the
  entity JSON (rules, required fields, defaults, enums) and the column types from
  the live database. `query.js` turns the app's Mongo-style filters (`$in`, `$gte`,
  `$or`, ...) into SQL. `service.js` applies the access rules.
- `src/functions/`: the six backend functions ported from
  `docs/reference/base44-functions/`, plus `routeDirections` (turn-by-turn
  directions for a saved route, from the same Valhalla router). Behaviour is the same; they now use SQL
  directly, and the invite claim and the health-data upsert are atomic.
  `adminClientErrors` lists the error reports below. `adminAccess` lists who has
  access and gives or takes back free passes (see "Who may use the product").
- `src/access.js`: the one place that answers "may this account use the product, and
  why". Everything else asks it.
- `src/billing/`: subscriptions bought on the website (see "Stripe" below).
  - `stripe.js`: the only code that talks to Stripe, over HTTPS with `fetch` (no SDK),
    with the API version pinned in `STRIPE_API_VERSION`. The app puts it on `ctx.stripe`;
    tests pass a fake with the same methods (`test/stripe-fake.js`).
  - `signature.js`: checks a webhook's `Stripe-Signature` header.
  - `plans.js`: the two plans, their prices and the trial length.
  - `sync.js`: turns a Stripe subscription into our `entitlements` row, and
    `syncCustomer`, which asks Stripe for a customer's subscriptions and writes what it says.
  - `webhook.js`: `POST /api/stripe/webhook`.
  - `queue.js`: one thing at a time per customer (and per account), inside the process.
    This, not a database lock, is what keeps billing work in order: nothing in the
    database is held while Stripe is being asked.
  - `account.js`: deleting an account that may have a Stripe customer (open checkouts
    expired, the customer deleted, then the account).
  - `reminders.js`: the email two days before a free trial ends, from an hourly sweep,
    and the start of billing's other background job, the daily check of subscriptions
    whose period has passed without word from Stripe (`syncOverdue` in `sync.js`).
- `src/functions/subscription.js`: what the screens call: `status`, `checkout`,
  `refresh`, `portal`, `resume`.
- `src/storage.js`: where uploads live. Local disk, or an S3-compatible bucket when the
  `S3_*` settings are present (requests signed here, no SDK).
- `src/lib/http.js`: the router, JSON helpers, the in-memory rate limiter and `clientIp`,
  the address a request is counted against. Behind a proxy that address comes from
  `X-Forwarded-For`; `TRUSTED_PROXY_HOPS` says which entry to believe, and the admin-only
  `requestInfo` function shows what arrives so the right value can be found on a host.
- `src/errors.js`: error reports kept in our own table (`client_errors`): crashes the
  phone app posts to `POST /api/client-errors`, and the API's own unexpected errors.
- `src/well-known.js`: the two public files that let a friend invite link
  (`/friends?add=<handle>`) open the phone app instead of the website:
  `GET /.well-known/apple-app-site-association` (iOS; app id from `IOS_APP_ID`) and
  `GET /.well-known/assetlinks.json` (Android; an empty list until `ANDROID_CERT_SHA256`
  is set). They are matched before the website's single-page fallback, and any other
  `/.well-known/` path is a 404 rather than the website's HTML.
- `src/auth/bootstrap.js`: creates the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
  on a host with no shell. It never changes an existing account.
- `migrations/`: numbered SQL files, applied in order by `npm run migrate` (and on
  API start unless `MIGRATE_ON_START=false`).

### Who may use the product

Having an account is not the same as having access. An account has access when its
role is admin, or it has a live row in `entitlements` (migration 005). There is one row
per source of access per account:

| `source` | written by | today |
| --- | --- | --- |
| `invite` | redeeming an invite code, at sign-up or afterwards | in use |
| `admin` | the owner granting free access by email (Settings → Who has access) | in use |
| `stripe` | a subscription bought on the website; the row is a copy of what Stripe says (see "Stripe" below) | in use when the Stripe settings are present |
| `apple` | a subscription bought in the iPhone app | not built yet (stage 3); the table and the check already allow for it |

A row is live when its `status` is `trial`, `active` or `grace` and it is not more than
three days past `expires_at` (`GRACE_DAYS`). Free passes have no expiry; a paid row
must have one (the table refuses a paid row without it, and one is never treated as live). The three days
are there so a renewal notice that arrives late never locks out someone who paid. With
more than one live row, access holds while any of them is good; the paid one is the
one reported. Admins need no row.

`src/access.js` holds all of it: `accessOf` (the full answer), `hasAccess`,
`requireAccess` (for routes) and `grantFree`. The server enforces it, not only the screens:

- **Closed without access** (`403 "Enter an invite code to use VantraRun."`, or
  `"Subscribe or enter an invite code to use VantraRun."` when `SUBSCRIPTIONS` is on):
  everything under `/api/entities/*`, `POST /api/uploads`, and every function except
  `inviteAccess` and `subscription`. The body also carries `"code": "no_access"`, which
  the website uses to show the gate when access ends in the middle of a session.
- **Open to any signed-in account**: everything under `/api/auth/*` (the account, sign-out,
  password change, deletion), the `inviteAccess` function (access status and redeeming
  a code), the `subscription` function (status, checkout and looking after a
  subscription) and `POST /api/client-errors`.
- **Open to everyone**: sign-in and sign-up, password reset, `/api/auth/options`,
  `/api/health`, the two `/.well-known/` files, uploaded media by its address, the
  website's own pages (the privacy policy and the terms among them), and
  `POST /api/stripe/webhook`, which accepts only a body signed with the webhook secret.

`access_grants` (one row per redeemed invite code) is still written, because the
invite-code screen reads it, but it no longer decides anything. Migration 005 copied
every existing row into `entitlements`, so testers kept access through the change.
Because a previous build writes `access_grants` only, the API repeats that copy every
time it starts (`syncInviteEntitlements`): a grant with no `invite` entitlement gets one,
and a row that exists is never changed. That covers a rollback or the old instance
serving during a deploy; people who redeem a code in that window have access again
at the new build's next start, not before.
Removing someone's invite pass revokes the entitlement and leaves the `access_grants`
row and the used code as history.

The `SUBSCRIPTIONS` setting (off by default) changes sign-up: off, an invite code
is required, as before; on, it is optional, and an account made without one is verified
but has no access until it subscribes or redeems a code. It stays off on the live site
until the payment test list in `docs/launch-checklist.md` has been run.

### Stripe (subscriptions bought on the website)

Stripe is the record of what was paid. Our `entitlements` row (source `stripe`,
`external_id` = the subscription id) is a copy of it, and there is one rule for keeping
the copy right: **ask Stripe, do not trust the notice.** Whenever something may have
changed, `syncCustomer` lists that customer's subscriptions at Stripe and writes what
it finds. It runs:

- for every webhook about a customer (the event's type and customer are read, nothing else);
- when the person comes back from Checkout or the portal (`subscription` → `refresh`);
- before a second checkout is sold, so someone who paid in another tab is let in instead;
- when an account that has a Stripe customer asks for its access status and is about
  to be told "no" (at most once in five minutes per account). The phone only ever
  calls `inviteAccess`, so this is what repairs a lost renewal notice for it;
- once a day, for subscriptions our table says are running but whose period has passed
  (at most 50 a run), which also catches an ending we never heard about;
- before a trial reminder is sent, so nobody who has just cancelled is told they are
  about to be charged.

Stripe is always asked first, with no transaction open, and the answer is then written
in a short transaction. Work for one customer is kept in order by `queue.js`.

So a repeated notice changes nothing, an old one arriving late cannot reopen access,
and a missing one is repaired the next time the person turns up. Event ids are kept
for 30 days (`stripe_events`) and a repeat answers `{ received: true, duplicate: true }`.
A failure while handling answers 500 and records nothing, so Stripe sends it again.

| Stripe status | Our row | `expires_at` |
| --- | --- | --- |
| `trialing` | `trial` | when the trial ends |
| `active` | `active` | end of the period paid for (read from the subscription's item) |
| `past_due` | `grace` | start of the unpaid period, so access lasts `GRACE_DAYS` (3) more and no longer; if Stripe gives no period start, the date the row already has is kept |
| `canceled`, `unpaid`, `incomplete_expired`, `paused` | `expired` | when Stripe ended it |
| `incomplete` | nothing is written | |

A charge refunded in full (`charge.refunded`) ends that subscription at once: it is
cancelled at Stripe and its row becomes `revoked` with the note `Refunded`. A revoked
row is never changed again. A partial refund changes nothing.

Settings and what they switch on:

| | needs |
| --- | --- |
| Checkout and the paywall (`config.selling`) | `SUBSCRIPTIONS=on` **and** all four `STRIPE_*` settings |
| The webhook, `refresh`, `portal`, `resume`, the status repair, the trial reminder, cancelling at Stripe when an account is deleted | the four `STRIPE_*` settings only |

With any of the four missing the server starts as usual, says so once in its log, and
the webhook address answers 404. An account that has a Stripe customer cannot be
deleted while the settings are missing or Stripe is unreachable (the person is asked
to try again), because the customer is deleted at Stripe first: that is what cancels
the subscription.

Nothing about a card is stored: only the customer id (`users.stripe_customer_id`),
subscription ids and event ids. The website loads nothing from Stripe; Checkout and
the portal are redirects to Stripe's own pages.

On the website, `AccessGate` shows the "Invite only" card while nothing is for sale and
`Paywall` when the server says it is selling. Back from Checkout (`/?checkout=success`)
the paywall calls `refresh` until the account is open, for up to 30 seconds.

### Access rules

Each entity's `rls` block decides who may read, create, update and delete its
records, e.g. "the owner or an admin" for runs, "anyone signed in" for challenges,
"public posts or your own" for posts. The rules are the ones the Base44 app used.

- Reads are scoped in SQL, so a list never returns a record you can't see.
- Creates, updates and deletes check the record first, and updates check it again
  afterwards, so nobody can hand a record to another user.
- Records you can't see answer `404`, not `403`, so ids can't be probed.
- `id`, `created_by_id`, `created_by`, `created_date` and `updated_date` are set by
  the server and ignored if a client sends them.

Backend functions run with full access, like Base44's service role, and do their
own checks (`adminInviteCodes`, `adminAccess` and `requestInfo` are admin-only, `subscription` only ever
acts on the caller's own Stripe customer, `challengeBoard` only returns the
one metric, `socialFeed` only friends' non-private posts).

### Database

One table per entity, columns named exactly as the entity fields so records keep
their shape. Every table has `id uuid`, `created_date`, `updated_date`,
`created_by_id` (foreign key to `users`, `on delete cascade`) and `created_by`.

Links between records are real foreign keys (memberships to challenges, runs to
routes, connections to users). Deleting a user deletes everything they own;
invite codes they redeemed keep their history but drop the user link.

Unique indexes back the rules the app relies on: one email per account, one
`@handle` per athlete, one membership per challenge per user, one grant per user, one
Stripe customer per account, one entitlement row per subscription,
and one run or workout per user per `(source, external_id)` for health sync.

## Web

Unchanged React app. Vite proxies `/api` and `/uploads` to the API in development.
For a deployed build either serve it from the API (`WEB_DIST`) or host it
separately and set `VITE_API_URL`.

## Native

See `native/README.md` and `docs/native-contract.md`. The shell signs in with
`/api/auth/login`, stores the token in `expo-secure-store`, checks invite and
consent, then sends health data to `ingestActivity`.
