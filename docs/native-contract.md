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

Sign-up is `POST /api/auth/register` with `{ email, password, full_name?, invite_code }`,
then `POST /api/auth/verify-otp` with the emailed 6-digit code, which also returns
`{ access_token, user }`. `invite_code` is required: FitPro is invite-only and the server
creates no account without a valid unused code (`400` with `"Enter your invite code."`,
`"That code is not recognised."` or `"That code has already been used."`). The code is
claimed when the email is verified, not at register; if someone else verified with the same
code first, `verify-otp` answers `409` and the person registers again with a new code.

That is the behaviour while the server's `SUBSCRIPTIONS` setting is off, which it is
today. `GET /api/auth/options` reports the setting as `"subscriptions": true|false`. When
it is on, `invite_code` is optional: left out (or empty), the account is created and
verified as usual but has no access until it subscribes or redeems a code. A code that
is given is checked and claimed exactly as above.

Store the token in `expo-secure-store` and send it on every request. Tokens last 30 days
by default. Any `401` means the token is no longer valid (expired, password changed,
account deleted): clear it and send the user to sign-in. `GET /api/auth/me` checks a
token and returns the user.

### Invite and consent checks

- Access status: `POST /api/functions/inviteAccess` with `{ "action": "status" }` ->

  ```
  {
    "allowed": true|false,
    "admin"?: true,                  // only present for admins
    "reason": "admin"|"subscription"|"trial"|"invite"|"granted"|null,
    "source": "stripe"|"apple"|"invite"|"admin"|null,
    "plan": "monthly"|"annual"|null,
    "expires_at": "<ISO>"|null,      // end of the paid period; null for free passes
    "cancel_at_period_end": true|false,
    "subscriptions": true|false      // the server's SUBSCRIPTIONS setting
  }
  ```

  `allowed` and `admin` are unchanged and are all the app reads today. The other
  fields were added on 2026-11-27 for the subscription screens; with no access every
  one of them is `null` (`cancel_at_period_end` is `false`). Ignore fields you do not know.
- Redeem with `{ "action": "redeem", "code": "FP-XXXX-XXXX" }` -> `{ "allowed": true }` or
  `{ "allowed": false, "error": "..." }` (still HTTP 200). Unchanged.

An account without access (no subscription, no invite code, no free pass; admins always
have access) can still sign in and out, read and update `/api/auth/me`, change or reset
its password, delete itself, report a crash, and call `inviteAccess`. **Every other
call** (all of `/api/entities/*`, `POST /api/uploads`, and every other function,
`ingestActivity` included) answers
`403 { "error": "Subscribe or enter an invite code to use VantraRun." }`. Before
2026-11-27 only `ingestActivity` refused, with a different message.
- Consent: the user object's `consent_version` / `consent_accepted_at`. Record acceptance
  with `PUT /api/auth/me { "consent_version": "...", "consent_accepted_at": "<ISO>" }`.

Fail closed: if either check can't be completed (network error, 5xx), treat the user as
not allowed.

### Other routes the app uses

The run experience reads and writes a few records besides runs. These are the same
routes the website uses; nothing here is new on the server. All need the bearer token.

| What | Route |
| ---- | ----- |
| The signed-in user | `GET /api/auth/me` -> `{ id, email, ... }` |
| Resend the sign-up code | `POST /api/auth/resend-otp { email }` |
| Delete the account | `DELETE /api/auth/me { password }` -> `{ ok: true, deleted: true }`; `401` when the password is wrong. Removes the user and every record they own |
| Profile | `POST /api/entities/Profile/query`, then `POST /api/entities/Profile` or `PUT /api/entities/Profile/:id`. Typed in, the app sends `{ hr_max }` or `{ hr_max, threshold_sec }`. Estimated from age, sex, height and weight it sends what the website's profile form sends: `{ age, sex, height_in, weight_lb, hr_max, vo2max, auto_threshold_sec }`, plus `threshold_sec` (the runner's own pace, else the estimate) when that pace changes. `sex` is `male` or `female`. The estimate is the website's `estimateZones`, ported to `native/src/run/zones.ts` and tested against its numbers. Unlike the website, the app rebuilds the five zones only when there are none or the threshold pace changed |
| Pace zones | `POST /api/entities/PaceZone/query`; first-time setup writes the five zones with `PUT` or `POST /api/entities/PaceZone/bulk` (and `DELETE /api/entities/PaceZone/:id` to clear a non-standard set), exactly as the website's onboarding does. The Pace zones screen rebuilds them the same way, and changes one zone's name and pace range with `PUT /api/entities/PaceZone/:id { name, fast_sec, slow_sec }` (the website's zone editor; nothing else about the zone is sent). It adds a zone of the runner's own with `POST /api/entities/PaceZone { name, fast_sec, slow_sec, color, sort_order }` (the record the website's editor creates: no `zone_number` and no heart-rate band, `color` one of the five ramp colours, `sort_order` the number of zones plus one) and deletes any zone with `DELETE /api/entities/PaceZone/:id` after a confirmation. A rebuild removes zones that were added, on the website too. The app also reads `intensity`, `purpose` and `feel` to show them |
| Saved routes | `POST /api/entities/Route/query` to list them. The route builder saves one with `POST /api/entities/Route { name, distance_mi, points: [{ lat, lng, offroad? }], path: [{ lat, lng }], target_zone_id, target_zone_name }` (`distance_mi` to 2 decimals; `path` is the snapped line, or the points when there is none; no zone is `""`), and the Routes tab removes one with `DELETE /api/entities/Route/:id`. Same records and fields as the website's builder |
| Road-following line while drawing a route | `POST /api/functions/snapRoute { points: [{ lat, lng, offroad? }] }` -> `{ snapped, path: [{ lat, lng }], distance_mi }`. 2 to 40 waypoints (`400` otherwise). A waypoint with `offroad: true` is joined to the one before by a straight line; the rest follow roads. `snapped: false` means a road section could not be routed and straight lines were used: the route still saves. The app sends one request per change and uses only the answer to the latest |
| The runner's runs (read only) | `POST /api/entities/Run/query { q, sort: "-started_at", limit }` (default 40, at most 200), the query the website's Home and Analytics pages make. The app reads `id`, `route_id`, `route_name`, `distance_mi`, `duration_sec`, `avg_pace_sec`, `started_at` (`created_date` when a run has no start time), `target_zone_name`, `in_zone_pct`, `avg_hr`, `source`, `external_id`. One query in `native/src/run/api.ts` makes the call, behind two helpers: `listServerRuns` (the Today tab asks for 40 and the Analytics tab for 200) and `listRunsToShare`, which also reads each run's `points` for the post composer (8, or 40 when opened for one run). Today joins them with the runs on the phone that have not uploaded yet, matching on `external_id` (or the `run_id` `ingestActivity` returned) so no run is counted twice |
| Turn directions for a route | `POST /api/functions/routeDirections { route_id }` -> `{ available, maneuvers: [{ index, instruction, verbal, type, lat, lng, at_mi }] }`; `404` for a route the caller does not own. A waypoint saved with `offroad: true` is reached in a straight line: its leg is not sent to the router and comes back as one maneuver of `type: 0` ("Leave the road and head straight for the next marker."). `available: false` means the route is still drawn but turns are not spoken |
| Report a crash | `POST /api/client-errors { message, stack?, context?, platform?, app_version? }` -> `201 { ok: true }`. Signed-in users only, 20 an hour each; long fields are cut. Never send a token, location or health data in it |

Every query above carries `q: { "created_by_id": "<the user's id>" }`. An admin's
token can read other people's records, and the app must only ever show and change the
signed-in person's own. The social queries below are the exceptions, and each says what it
asks for instead.

Runs and workouts are **never written** through `/api/entities` by the app: `ingestActivity`
is the only write path. The one read is the `Run/query` above; workouts are not read at all.
`native/scripts/check-boundaries.mjs` allows that single call and fails on any other use of
the `Run` or `Workout` entity routes.

### Social routes the app uses (Feed, Friends, Challenges)

Added 2026-11-27 with the app's social screens. Every call is one the website already
makes (`web/src/pages/Feed.jsx`, `Friends.jsx`, `Challenges.jsx`, `ChallengeDetail.jsx`,
`web/src/lib/social.js`), with the same body; nothing is new on the server. All need the
bearer token. The helpers are in `native/src/social/api.ts`; the rules (handles, audiences,
the post record) are in `native/src/social/logic.ts` and `challenges.ts`. Gym is hidden:
the app shows no `kind: "workout"` post, lists no `metric: "workouts"` challenge and
creates neither.

| What | Route |
| ---- | ----- |
| The signed-in user's name | `GET /api/auth/me` -> also reads `full_name`, used once to make the first handle |
| My social profile | `POST /api/entities/SocialProfile/query { q: { created_by_id }, limit: 1 }`. When there is none, the app creates it as the website does: `POST .../SocialProfile/query { q: { handle }, limit: 1 }` to see whether the handle made from the name is free (four random digits are added when it is not), then `POST /api/entities/SocialProfile { handle, display_name, visibility: "private" }` |
| Edit my social profile | `POST .../SocialProfile/query { q: { handle }, limit: 1 }` (is the handle someone else's?), then `PUT /api/entities/SocialProfile/:id { handle, display_name, bio, visibility }` (`visibility` is `public` or `private`). `409` means the handle was taken in between; the app says "That handle is already taken." either way |
| Find people | `POST /api/entities/SocialProfile/query { q: {}, limit: 100 }` (the directory the search filters on the phone, as the website's does) and `POST .../SocialProfile/query { q: { handle }, limit: 1 }` for a full handle typed in. Reads `id`, `created_by_id`, `handle`, `display_name`, `bio`, `avatar_url`, `visibility` |
| My connections | `POST /api/entities/Connection/query { q: { $or: [{ from_user_id }, { to_user_id }] }, sort: "-created_date", limit: 200 }`, both ids the user's own |
| Send a friend request | `POST /api/entities/Connection/query { q: { $or: [{ from_user_id: me, to_user_id: them }, { from_user_id: them, to_user_id: me }] }, limit: 1 }`; when nothing comes back, `POST /api/entities/Connection { from_user_id, to_user_id, from_handle, from_name, to_handle, to_name, status }`. `status` is `"accepted"` when the other profile is public and `"pending"` otherwise, exactly as the website sets it |
| Accept a request | `PUT /api/entities/Connection/:id { status: "accepted" }` |
| Decline a request, cancel one I sent, remove a friend | `DELETE /api/entities/Connection/:id`. Decline is the website's call; cancel and remove are the same call from the other two lists (the website has no button for them) |
| Feed, "Your circle" | `POST /api/functions/socialFeed {}` -> `{ posts, friend_ids }`: my posts and my accepted friends' posts that are not private. The app reads `posts` only |
| Feed, "Discover" | `POST /api/entities/Post/query { q: { visibility: "public" }, sort: "-created_date", limit: 30 }`. The app drops anything that comes back not public |
| Share a run | `POST /api/entities/Post { kind: "run", ref_id, title, caption, distance_mi, duration_sec, avg_pace_sec, zone_name, in_zone_pct, route_points: [{ lat, lng }], background_type, background_url, visibility, author_handle, author_name, author_avatar, shared_to: [] }`. The website composer's record. `background_type` is `none`, `photo` or `video` and `background_url` is `""`, a stock background's path (`/backgrounds/trees.jpg`, `river.jpg`, `trail.jpg`) or the `file_url` the upload returned, unchanged; of the media the post carries nothing else. `ref_id` is the server's id of the run and the numbers are the server's own copy of it. `route_points` is the run's track thinned as the website thins it (every n-th point, at most 160), `lat` and `lng` only. `visibility` is `public`, `friends` or `private`, whichever the runner picked; the starting choice is `friends`, or `public` when their social profile is public. |
| Upload a post's photo or video | `POST /api/uploads` with the file's bytes as the body (not multipart), `Content-Type` the file's type and the bearer token -> `201 { file_url }`. The website's call. Sent only by the composer, only after the runner taps Post, and before the `Post` is created; a retry of a failed post does not send the file again. The app checks the server's rules first: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `video/mp4`, `video/quicktime`, `video/webm`, at most 50 MB (the server's default `MAX_UPLOAD_MB`; `413` and `415` are still shown in the server's words). `file_url` must be `/uploads/<name>` on this server (written short or with `API_URL` in front), else the post is not made |
| Show a post's background | `GET {API_URL}/uploads/<name>` or `GET {API_URL}/backgrounds/<name>.jpg`, no sign-in (the route is public). The app builds the address from `background_url` only when it is one of those two paths on `API_URL`; any other address is treated as no background and never fetched, so a post cannot make the phone call another host. A video is fetched only while its post is on screen |
| Delete my post | `DELETE /api/entities/Post/:id` |
| Challenges | `POST /api/entities/Challenge/query { q: {}, sort: "-created_date", limit: 30 }` and `POST /api/entities/ChallengeMember/query { q: { user_id }, limit: 100 }` (which ones I joined) |
| Create a challenge | `POST /api/entities/Challenge { name, description, metric, target_value, month, start_date, end_date, creator_handle }`. `metric` is `distance` or `runs`; `month` is `YYYY-MM`; the dates are the first instant of that month and of the next in the phone's time zone, as ISO strings |
| Leaderboard | `POST /api/functions/challengeBoard { challenge_id }` -> `{ challenge, rows: [{ user_id, name, handle, value }], member_count, joined }`; `404` when there is no such challenge |
| Join / leave | `POST /api/entities/ChallengeMember/query { q: { challenge_id, user_id }, limit: 1 }`, then `POST /api/entities/ChallengeMember { challenge_id, user_id, handle, name }` to join (not sent when already a member) or `DELETE /api/entities/ChallengeMember/:id` to leave |

Not called by the app: `PUT /api/entities/Post/:id` (the website's `shared_to` marker),
and deleting or editing a challenge (the website has no button for either).

Photo and video backgrounds, what the phone does and does not do:

- The picker is the system's own (PHPicker on iOS, the Android photo picker), which hands
  over the one item chosen and needs no photo-library permission; the app never asks for
  one. The camera permission is asked when "Take a photo" is tapped, never earlier. The
  camera takes photos only, so the microphone is not used (Android: `RECORD_AUDIO`,
  `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are blocked in `app.json`; on
  Android 8 and 9 "Take a photo" is not offered because it would need the last one).
- A chosen file stays in the app's cache until Post is tapped. Only its bytes and type are
  sent: no file name, album, EXIF read-out or location field.
- **Metadata inside the file is not stripped.** `expo-image-picker` has no option for it
  (`exif: false` only keeps EXIF out of what JavaScript receives). On iOS a JPEG is
  re-encoded at quality 0.85, which drops its EXIF; HEIC, GIF and every video are sent as
  the picker delivers them. On Android files are copied as they are. A photo or video may
  therefore still carry where and when it was taken. Removing it reliably is a server job
  (`/api/uploads`), not done today.
- **Uploads are public by address.** `GET /uploads/<name>` needs no sign-in, so anyone who
  has the link can open the file whatever the post's `visibility`. The composer says so,
  as the website's does. A file whose post was never made, or was deleted, stays on the
  server: there is no delete route.
- The feed shows a post with a background as the website's share card (the media under a
  flat Ink veil with the stats). The website itself shows that card only when a post is
  saved or shared as an image; its feed shows the plain stats block. A video plays muted
  and looped while its post is on screen and never takes the audio from music or cues.
  Media that fails to load falls back to the plain stats block.

The invite link and the link in a shared post are `{API_URL}/friends?add=<handle>` and
`{API_URL}/feed?post=<id>`: the hosted API serves the website at the same address. They
are handed to the phone's share sheet and never fetched by the app.

### Invite links that open the app

Added 2026-11-27. A friend invite link opens the app when it is installed and the website
otherwise. A post link (`/feed?post=<id>`) and every other page still open in the browser.

| What | Route |
| ---- | ----- |
| iOS universal links | `GET /.well-known/apple-app-site-association` -> `200`, `Content-Type: application/json`, no sign-in, no redirect: `{ "applinks": { "details": [{ "appIDs": ["LA4YX3HF32.com.vantrarun.app"], "components": [{ "/": "/friends", "?": { "add": "?*" }, "comment": "..." }] }] } }`. Only `/friends` with a non-empty `add` is handed to the app. The app id comes from `IOS_APP_ID` (comma separated for more than one); that value is the default |
| Android app links | `GET /.well-known/assetlinks.json` -> `200`, `Content-Type: application/json`: `[]` until `ANDROID_CERT_SHA256` is set (comma-separated SHA-256 fingerprints of the signing certificate, colons optional), then `[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "android_app", "package_name": "com.vantrarun.app", "sha256_cert_fingerprints": [...] } }]` |

Both are served by `server/src/well-known.js`, ahead of the website; any other
`/.well-known/` path is a `404`. The app's side is in `native/app.json`:
`ios.associatedDomains: ["applinks:vantrarun.onrender.com"]`, an Android `intentFilters`
entry (`autoVerify`, `https`, that host, path `/friends`) and the scheme `vantrarun`, so
`vantrarun://friends?add=<handle>` works too. **The host is written into `app.json`**: if the
site moves, those two entries and the links must change together (see
`docs/launch-checklist.md`). Android can only match the path, not the query, so there any
`https://<site>/friends` link opens the app's Friends screen.

What the app does with one (`native/src/social/invite-link.ts`, `native/app/friends.tsx`),
which is what the website's Friends page does:

- The handle is cleaned first (`cleanHandle`: lower case, `a-z 0-9 . _`, 24 characters at
  most) and is only ever sent as a value in the body of `SocialProfile/query`; it is never
  put into an address.
- Signed in and set up: the profile is looked up, and one friend request is sent with the
  "Send a friend request" calls above (accepted at once only when that account is public).
  The screen says whose request is being sent and what came of it.
- Nothing is sent when the handle is the runner's own, when nobody has that handle, or when
  a connection between the two already exists in either direction (the screen says which).
  A link is acted on once per account while the app stays open, so drawing the screen again,
  cancelling the request or opening the same link again does not send a second one; after a
  restart the existing connection is what stops it.
- Signed out, consent not given, no invite, or zones not set: the access gate keeps the
  cleaned handle in memory (never on disk, 30 minutes at most) while the person goes through
  those steps, then sends them to Friends with it. The destination is fixed; a link cannot
  choose where the app goes. A run being started, recorded or reviewed is never interrupted.

Feed and friend data is not stored on the phone. With no connection those screens say so.

---

## Shared shape

| field         | type   | required | notes                                                        |
| ------------- | ------ | -------- | ------------------------------------------------------------ |
| `kind`        | string | no       | `"run"` or `"workout"`. Defaults to `"run"`. Anything else → 400 |
| `external_id` | string | **yes**  | Trimmed, max 200 chars. Platform's own event/workout id      |
| `source`      | string | no       | Max 40 chars. Defaults to `"manual"`                          |
| `notes`       | string | no       | Max 2000 chars                                                |

`source` values in use: `fitpro` (a run recorded live by the FitPro app), `apple`,
`health_connect`, `garmin`, `manual`.

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

### Runs recorded by FitPro (`source: "fitpro"`)

`external_id` is an id the phone generates when the run starts, so a retried upload
updates the same run. `route_name` defaults to `"Free run"`. These optional fields carry
the route, the zone the runner aimed for and the heart-rate stats:

| field | rule |
| ----- | ---- |
| `route_id` | a route the caller owns |
| `target_zone_name` | string, max 80 chars |
| `target_fast_sec`, `target_slow_sec` | both `> 0` and `fast <= slow`, rounded |
| `in_zone_pct` | `0..100`, rounded: share of the run inside the pace zone |
| `hr_in_zone_pct` | `0..100`, rounded: share of the run inside the heart-rate zone |
| `min_hr`, `hr_target_min`, `hr_target_max` | bpm `20..260`, rounded |

**A value that breaks its rule is dropped, never a 400.** The phone queues runs while
offline and retries them, so an optional field must not be able to block an upload: a
`route_id` for a route that was since deleted, or that belongs to someone else, is left
out and the run is still saved. The two pace targets are kept or dropped together.

Response:

```json
{ "ok": true, "kind": "run", "action": "created",
  "run_id": "...", "source": "apple", "distance_mi": 5.12,
  "duration_sec": 2490, "avg_pace_sec": 486, "points": 412 }
```

`action` is `"created"` or `"updated"`. **Show this on screen during the spike** — it is
the proof the upsert works.

### Imported copies of a FitPro run are skipped

A runner who also records on their watch would get the run twice. When an incoming run's
`source` is not `fitpro`, the caller has no record yet for that `(source, external_id)`,
and they already have a run recorded by FitPro (`fitpro`, or `live` from the website)
that shares at least half of the longer run's time span with it, nothing is written
(so a FitPro run stopped after two minutes never hides the hour a watch recorded):

```json
{ "ok": true, "kind": "run", "action": "skipped", "reason": "overlaps_fitpro_run",
  "run_id": "<the FitPro run>", "source": "apple" }
```

A run's span is `started_at` to `started_at + duration_sec`. Treat `skipped` as success:
do not retry it and do not show it as an error.

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
| 403    | signed in, but the account has no access (admins are exempt): `"Subscribe or enter an invite code to use VantraRun."` Until 2026-11-27 the message was `"Redeem your invite code before syncing activities."`; the status is the same. Keep the activity queued and retry later: access can come back. Never match on the message text. |
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
- Duplicate skipping works one way only. If the watch's copy of a run is imported
  **before** FitPro's own upload arrives (the phone was offline at the finish), both
  records are kept; nothing merges or removes the imported one.