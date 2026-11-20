# FitPro — native ingestion contract

Source of truth for anything that sends health data into FitPro. Implemented by
`server/src/functions/ingestActivity.js` and covered by `server/test/api.test.js`. If
code disagrees with this file, the code is wrong.

> Moved off Base44 on 2026-11-20. Request and response bodies are unchanged; only the
> URL and the way you sign in changed (see Endpoint).

---

## Endpoint

```
POST {API_URL}/api/functions/ingestActivity
Authorization: Bearer <access_token>
Content-Type: application/json
```

`API_URL` is the FitPro API: `http://<your-computer's-LAN-IP>:4000` in development (a
phone can't reach `localhost` on your computer), and the deployed API URL later. Keep it in
app config (`app.config.js` / `EXPO_PUBLIC_API_URL`), never hard-coded.

**Authentication is required.** Without a valid user token the API returns
`401 {"error":"Unauthorized"}`.

### Getting a token

```
POST {API_URL}/api/auth/login
{ "email": "...", "password": "..." }
-> 200 { "access_token": "...", "user": { "id", "email", "role", ... } }
-> 401 { "error": "Invalid email or password." }
-> 403 { "error": "Verify your email first...", "needs_verification": true }
```

Sign-up is `POST /api/auth/register` then `POST /api/auth/verify-otp` with the emailed
6-digit code, which also returns `{ access_token, user }`.

Store the token in `expo-secure-store` and send it on every request. Tokens last 30 days
by default. Any `401` means the token is no longer valid (expired, password changed,
account deleted): clear it and send the user to sign-in. `GET /api/auth/me` checks a
token and returns the user.

### Invite and consent checks

- Invite status: `POST /api/functions/inviteAccess` with `{ "action": "status" }` ->
  `{ "allowed": true|false, "admin"?: true }`. Redeem with
  `{ "action": "redeem", "code": "FP-XXXX-XXXX" }` -> `{ "allowed": true }` or
  `{ "allowed": false, "error": "..." }` (still HTTP 200).
- Consent: the user object's `consent_version` / `consent_accepted_at`. Record acceptance
  with `PUT /api/auth/me { "consent_version": "...", "consent_accepted_at": "<ISO>" }`.

Fail closed: if either check can't be completed (network error, 5xx), treat the user as
not allowed.

---

## Shared shape

| field         | type   | required | notes                                                        |
| ------------- | ------ | -------- | ------------------------------------------------------------ |
| `kind`        | string | no       | `"run"` or `"workout"`. Defaults to `"run"`. Anything else → 400 |
| `external_id` | string | **yes**  | Trimmed, max 200 chars. Platform's own event/workout id      |
| `source`      | string | no       | Max 40 chars. Defaults to `"manual"`                          |
| `notes`       | string | no       | Max 2000 chars                                                |

`source` values in use: `apple`, `health_connect`, `garmin`, `manual`.

### Dedupe rule (critical)

Records are matched on **`external_id` + `source`** together, per user (a unique index
in the database enforces it, so two concurrent sends can't create a duplicate). Sending the same pair again
**updates** the existing record; it never duplicates. A new `external_id` creates a new
record. `external_id` must be stable per activity — use the platform's record UUID, not a
timestamp, and not a hash of the values (an edited activity must still match).

---

## kind: "run"

| field         | type   | required | limits / notes                                          |
| ------------- | ------ | -------- | ------------------------------------------------------- |
| `distance_mi` | number | **yes**  | `> 0` and `<= 500`. Strings are coerced.                 |
| `duration_sec`| number | **yes**  | `> 0` and `<= 259200` (72 h)                             |
| `started_at`  | string | no       | ISO date. Defaults to now. Invalid date → 400            |
| `route_name`  | string | no       | Max 120 chars. Defaults to `"Imported run"`              |
| `points`      | array  | no       | `[{lat, lng}]`, max 5000. Invalid/out-of-range dropped silently |
| `splits`      | array  | no       | `[{mile, pace_sec}]`, max 200. `mile` and `pace_sec` must be `> 0` |
| `avg_hr`      | number | no       | Rounded. Omit rather than sending `0` if unknown         |
| `max_hr`      | number | no       | Rounded                                                  |
| `hr_device`   | string | no       | Max 80 chars                                             |

Server computes `avg_pace_sec = round(duration_sec / distance_mi)`.

Response:

```json
{ "ok": true, "kind": "run", "action": "created",
  "run_id": "...", "source": "apple", "distance_mi": 5.12,
  "duration_sec": 2490, "avg_pace_sec": 486, "points": 412 }
```

`action` is `"created"` or `"updated"`. **Show this on screen during the spike** — it is
the proof the upsert works.

---

## kind: "workout"

| field          | type   | required | limits / notes                                        |
| -------------- | ------ | -------- | ------------------------------------------------------ |
| `exercises`    | array  | **yes**  | At least one exercise with a name and one valid set    |
| `name`         | string | no       | Max 120 chars. Defaults to `"Imported workout"`        |
| `performed_at` | string | no       | ISO date, falls back to `started_at`, then now         |
| `duration_min` | number | no       | `> 0` and `<= 720`                                     |

Exercise shape:

```json
{ "name": "Bench press",        // required, max 80 chars
  "muscle": "chest",            // optional, max 40 chars
  "sets": [ { "reps": 8, "weight": 185 } ] }
```

Set rules — a set is **dropped silently** if it breaks any of these:

- `reps` and `weight` must both be present and numeric
- `reps` `> 0` and `<= 1000`
- `weight` `>= 0` and `<= 2000`
- max 40 sets per exercise, max 60 exercises per workout

An exercise with no surviving sets is dropped. **If nothing survives, the whole request
fails with 400** — so a bodyweight-only session must still send `weight: 0`, not omit it.

Server computes `set_count` and `total_volume` (sum of `reps × weight`). **Do not send
them** — they are recalculated and any value you send is overwritten.

Response:

```json
{ "ok": true, "kind": "workout", "action": "created",
  "workout_id": "...", "source": "apple", "name": "Push A",
  "set_count": 5, "total_volume": 5935, "exercises": 2 }
```

---

## Error responses

All errors are `{ "error": "<message>" }` with the message written for a human:

| status | cause                                                            |
| ------ | ---------------------------------------------------------------- |
| 400    | missing `external_id`, bad `distance_mi`/`duration_sec`, invalid `started_at`/`performed_at`, no usable exercises, unknown `kind` |
| 401    | no app-user session                                              |
| 500    | unexpected — surface the message, do not retry in a loop          |

The shell should surface 400s verbatim next to the affected activity. A 400 means the
payload is wrong and re-sending it will fail again.

---

## Hard boundaries

1. **`ingestActivity` is the only write path for health data.** The phone never writes
   runs or workouts through the generic `/api/entities` routes.
2. **Native code lives in `/native`** and talks to the server only over HTTP. It never
   imports from `server/` or `web/`.
3. **Health permissions come last.** Sign-in, accepted consent and an accepted invite
   code must all pass before any HealthKit / Health Connect permission prompt.
4. **No third-party analytics, ad SDKs or session recording** anywhere in the shell.
5. **No invented fields.** If something is missing from this file, stop and ask. Changing
   this contract means changing `server/src/functions/ingestActivity.js`, its tests in
   `server/test/api.test.js`, and this file in the same commit.

---

## Response fields the shell may rely on

Only the fields documented above. Treat anything else in the response as opaque.

## Known gaps (ask before assuming)

- Runs carry no per-point timestamps or elevation — `points` is `{lat, lng}` only.
- Splits are whole miles only (`mile` is rounded), so sub-mile splits cannot be expressed.
- Strength sets have no RPE, rest time or set type (warmup/failure).
- There is no delete or "unsync" endpoint. Re-syncing deletes nothing.