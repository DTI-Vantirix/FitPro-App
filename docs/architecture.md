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
            └──────┬───────┘        └───────────────┘
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
- `src/functions/`: the six backend functions, ported from
  `docs/reference/base44-functions/`. Behaviour is the same; they now use SQL
  directly, and the invite claim and the health-data upsert are atomic.
- `migrations/`: numbered SQL files, applied in order by `npm run migrate` (and on
  API start unless `MIGRATE_ON_START=false`).

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
own checks (`adminInviteCodes` is admin-only, `challengeBoard` only returns the
one metric, `socialFeed` only friends' non-private posts).

### Database

One table per entity, columns named exactly as the entity fields so records keep
their shape. Every table has `id uuid`, `created_date`, `updated_date`,
`created_by_id` (foreign key to `users`, `on delete cascade`) and `created_by`.

Links between records are real foreign keys (memberships to challenges, runs to
routes, connections to users). Deleting a user deletes everything they own;
invite codes they redeemed keep their history but drop the user link.

Unique indexes back the rules the app relies on: one email per account, one
`@handle` per athlete, one membership per challenge per user, one grant per user,
and one run or workout per user per `(source, external_id)` for health sync.

## Web

Unchanged React app. Vite proxies `/api` and `/uploads` to the API in development.
For a deployed build either serve it from the API (`WEB_DIST`) or host it
separately and set `VITE_API_URL`.

## Native

See `native/README.md` and `docs/native-contract.md`. The shell signs in with
`/api/auth/login`, stores the token in `expo-secure-store`, checks invite and
consent, then sends health data to `ingestActivity`.
