# FitPro native run coach — design

Date: 2026-11-25. Status: approved by the owner on 2026-11-25 ("work through the
full build"), with the answers recorded in section 13.

Items marked **(owner)** were decided by the owner in conversation. Items marked
**(proposal)** are the designer's calls and are open to correction. Everything else
is description of the code as it stands today.

## 1. Intent

FitPro becomes a live run coach that people install from TestFlight / Google Play.
A runner opens the app, picks how they want to run, picks a zone, and runs. While
they run, the phone (and their watch, if it has a screen) shows directions and
tells them when their pace or heart rate is outside the zone. When they stop they
get the stats, and can share the run to the feed and have it count toward
challenges.

Why now: the owner has 10 testers ready (mostly iPhone + Apple Watch, a few Garmin
watches, a few Android phones) and Apple and Google developer accounts. The web
app's Live Run page cannot do this job on a phone because a browser stops tracking
when the screen locks.

## 2. Goals

- **(owner)** Three ways to start a run: a pre-mapped route, a free run, a free run
  with a map.
- **(owner)** Pick a running zone before starting.
- **(owner)** Directions during the run on the phone, and on a wrist device that
  has a screen.
- **(owner)** Live heart rate and pace are monitored and the runner is told when
  either is above or below the zone.
- **(owner)** When pace and heart rate disagree, the app shows both and the runner
  decides. The app never tells the runner what to do about it.
- **(owner)** Post-run stats: max and min heart rate, pace, distance "etc".
- **(owner)** The social features work in the app: the feed for sharing run
  details, and run challenges.
- **(owner)** Every screen is rebuilt native ("full rebuild to do it right"), not
  shown through an embedded web view.
- **(owner)** Hosted on a managed platform; iOS and Android builds delivered to 10
  testers.

## 3. Non-goals (for now)

- **(owner)** Gym workouts. Removed from the product for now, to be built up later.
- **(proposal)** On-wrist apps for Wear OS and Garmin (Connect IQ). Later stage,
  not designed here.
- **(proposal)** Running without the phone (watch-only runs). Everyone is assumed
  to carry their phone.
- **(proposal)** New work on the web app. It stays up as it is; only gym removal
  touches it.
- Google sign-in, MFA, public (non-invite) release.

## 4. Anti-goals

- The app issuing instructions about effort ("slow down", "speed up"). Cues state
  facts only.
- Nagging: repeated alerts for the same out-of-zone condition.
- Third-party analytics, ad SDKs or session recording (existing rule in
  `AGENTS.md`).
- Requesting health permissions before sign-in, consent and invite have passed
  (existing rule in `docs/native-contract.md`).

## 5. What exists today

- `web/`: React + Vite. `web/src/pages/LiveRun.jsx` does browser GPS, a zone
  picker and Bluetooth heart-rate straps (`web/src/hooks/useHeartRate.js`). It
  judges **pace only** (`zoneStatus` in `web/src/lib/geo.js`), shows the result on
  screen, and has no voice, vibration or turn directions. Pages also exist for
  RouteBuilder, Routes, Zones, Analytics, Feed, Friends, Challenges, Devices,
  Settings, Workouts.
- `server/`: plain Node + Postgres. Tables include `pace_zones` (each zone has a
  pace range `fast_sec`..`slow_sec` **and** a heart-rate range
  `hr_min_pct`..`hr_max_pct` of max HR), `routes`, `runs`, `posts`, `challenges`,
  `challenge_members`. `profiles` holds `hr_max`.
- `native/`: Expo SDK 58 shell, bundle id `com.fitpro.spike`. Has sign-in, consent
  and invite gates, read-only HealthKit and Health Connect adapters, manual
  import, foreground auto-sync and background-sync diagnostics. It has **no** run
  screen and no location, map, speech, notification or Bluetooth libraries.
  `native/eas.json` has a development profile only.
- Hosting: none chosen. Uploads are on local disk. Route snapping uses a public
  best-effort Valhalla server.

## 6. Constraints

- Schema changes go in a new numbered migration and the matching
  `server/entities/*.json`; access-rule changes need a test (`AGENTS.md`).
- `docs/native-contract.md` says `ingestActivity` is the phone's only write path
  for runs, and that changing it means changing the contract doc and tests in the
  same commit. A run recorded in the native app carries fields that contract does
  not have today (see section 10), so the contract must be extended, not bypassed.
- Both app stores require an in-app account deletion button; native has none.
- An Apple Watch does not hand live heart rate to a phone app unless that app has
  its own watch component. **This should be verified against current Apple
  documentation before Stage 2 is planned**; it is stated here from the designer's
  general knowledge, not from a test.
- An Apple Watch app is native Swift and needs an extra build target in the Expo
  project.

## 7. Approaches considered

| Approach | Trade-off | Outcome |
| --- | --- | --- |
| A. Hybrid: native run screen, existing web screens embedded for everything else | Fastest to testers, social nearly free; embedded screens feel less native, shared sign-in needed | Recommended by the designer; not chosen |
| B. Full native rebuild of every screen | Best feel; about 15 screens to rebuild; web and native UIs to keep in step | **Chosen by the owner**, "to do it right" |
| C. Wrap the web app with Capacitor | Discards the HealthKit / Health Connect work and reverses the recorded Expo decision | Dropped |

Hosting:

| Option | Trade-off | Outcome |
| --- | --- | --- |
| A. Managed platform (e.g. Render, Fly.io) with managed Postgres | Least upkeep, backups and HTTPS included; roughly $15–30/month (unverified estimate) | **Chosen by the owner** |
| B. Single rented server with Docker | Cheapest; patching, backups and certificates are ours | Not chosen |
| C. AWS / Azure / Google Cloud | More setup than 10 testers need | Not chosen |

## 8. Stages

Each stage ends in a build testers can install. **(proposal)** for the order; the
owner was shown it and did not change it.

1. **Run core on the phone**, plus hosting and the first TestFlight and Play
   internal-testing builds. Gym removed.
2. **Apple Watch companion.**
3. **Social native**: feed, friends, challenges.
4. **Remaining screens native**: route builder, zones editor, analytics, settings,
   devices. Until this stage, testers use the website for these.

This document designs Stage 1 in detail and fixes the shape of Stages 2–4. Each
later stage gets its own plan.

## 9. Stage 1 — run core

### 9.1 Starting a run

Home leads to a start screen with three choices **(owner)**:

- **Pre-mapped route**: pick from the user's saved routes (`routes` table). The
  route's own target zone is preselected when it has one (as the web app does).
- **Free run**: no map; stats and coaching only.
- **Free run with map**: live map showing position and the track so far; no
  directions, because there is no destination.

Then pick a zone from the user's `pace_zones` **(owner)**, defaulting to the
route's zone, else Zone 2 **(proposal, matches the web app)**. Then Start.

In Stage 1 routes are created on the website; the app only lists and runs them.

**First-time setup (proposal).** A tester must be able to install the app and run
without visiting the website first. Stage 1 therefore adds native sign-up with
the emailed code, and a short setup that collects what the zones need (max heart
rate and threshold pace) and creates the user's zones the same way the web
onboarding does (`applyZones` in `web/src/lib/profile.js`). Today the shell has
sign-in only and zones are created only by the web onboarding.

### 9.2 During a run

```
┌──────────────────────────────┐
│  ↰ Left on Elm St   0.1 mi   │  directions (pre-mapped only)
├──────────────────────────────┤
│                              │
│            map               │  (hidden in plain free run)
│                              │
├──────────────────────────────┤
│  2.31 mi          19:42      │
│                              │
│  PACE  8:32 /mi   ● in zone  │
│  HR    164 bpm    ▲ above    │
│  Zone 2 · 8:15–9:00 · 125–145│
├──────────────────────────────┤
│   [ Pause ]        [ Finish ]│
└──────────────────────────────┘
```

- Tracking continues with the screen locked and the app in the background.
- **Directions (owner)**: turn-by-turn along a pre-mapped route, shown on screen
  and spoken. Leaving the route is reported as a fact ("off route"); the app does
  not re-plan the route **(proposal)**. Saved routes hold geometry only (no turn
  instructions), so the app fetches the instructions when the route is opened to
  run and keeps them on the device for the run **(proposal)**. That needs a
  connection at the start, not during the run, and avoids changing the web route
  builder. Without a connection at the start the route is still drawn on the map
  and the runner is told spoken turns are unavailable.
- **Coaching (owner)**: pace and heart rate are each compared with the chosen
  zone's own range and shown separately as in zone / above / below. Neither
  overrides the other.
- **Cues (proposal)**: when either reading leaves its range the phone vibrates and
  speaks a short factual cue ("heart rate above zone", "pace slower than zone";
  pace uses faster/slower because above/below is ambiguous for pace), and
  again when it returns. One reminder if it stays out for a sustained period.
  Pace cues and heart-rate cues can be muted separately, before or during a run.
  The same cues are posted as notifications so any paired watch shows them.
- **Heart rate sources in Stage 1**: Bluetooth heart-rate straps and Garmin
  watches in broadcast mode. Apple Watch heart rate arrives in Stage 2. With no
  heart-rate source the HR row reads "no sensor" and only pace is coached.
- Heart-rate zone bounds are the zone's `hr_min_pct`/`hr_max_pct` applied to the
  profile's `hr_max`. If `hr_max` is missing the app asks for it before the first
  run rather than guessing **(proposal)**.

### 9.3 After a run

Summary screen **(owner: max and min heart rate, pace, distance "etc")**:
distance, duration, average pace, mile splits, max / min / average heart rate,
time in pace zone, time in heart-rate zone **(proposal)**, and the route map.

The run is saved to the server. If the phone is offline the run is kept on the
device and sent when a connection returns; a run is never lost because of signal
**(proposal)**.

**Duplicate runs (proposal).** A tester who also records the run on their watch
would get it twice: once from FitPro and once imported from Apple Health or
Health Connect, because dedupe is on `source` + `external_id`. In Stage 1
automatic health import is off; manual import stays, and it skips any activity
that overlaps in time with a run FitPro recorded. This must be revisited in
Stage 2, where the watch workout session may itself write a HealthKit workout.

Sharing to the feed arrives with Stage 3. Until then a run saved from the app
still appears on the website, where it can be shared.

### 9.4 Gym removal

**(owner: remove for now, build up later.)** **(proposal)**: hide it, do not
delete it. Remove the Workouts page and navigation, the gym stop on routes and
runs, workout posts in the feed and the `workouts` challenge metric from the web
UI, and build none of it in native. Keep the tables, the `workout` ingest kind
and existing data so it can come back.

### 9.5 Hosting and builds

- Managed platform **(owner)**; the API also serves the built web app
  (`WEB_DIST`), as the README already plans. Managed Postgres with automatic
  backups. Provider choice between Render and Fly.io is left to the builder.
- Uploads move to object storage; directions and route snapping move to a hosted
  routing provider **(proposal)**.
- Error monitoring that respects the no-analytics rule.
- EAS preview/production profiles, signing, a permanent bundle id to replace
  `com.fitpro.spike` **(proposal: owner supplies the id)**, location and
  Bluetooth usage strings, TestFlight and Play internal testing for 10 testers.
- Native account deletion (store requirement).
- Access stays invite-only.
- **(proposal)** The hosted environment starts clean; nothing is copied from the
  local development database or `server/uploads`. The handoff reported no real
  users.

## 10. Server changes needed by Stage 1

- `runs` has no minimum heart rate, no heart-rate time-in-zone and no record of
  the heart-rate target. New migration adds them.
- The ingest contract has no fields for the route, target zone, time in zone
  or minimum heart rate (`legs` exist only for the gym stop and are left out), and its `source` list has no value for a run
  recorded by FitPro itself. Extend `ingestActivity`, its tests and
  `docs/native-contract.md` together. `external_id` for an app-recorded run is an
  id generated on the phone when the run starts, so a retried upload updates the
  same run.
- `points` is `{lat, lng}` with a 5000 cap and no timestamps. Whether to add
  per-point time is left to the builder.

## 11. Shape of later stages

- **Stage 2, Apple Watch companion**: a watch app that starts a workout session,
  streams heart rate to the phone, shows pace and heart-rate zone status and the
  next turn, and taps the wrist for cues. The phone remains the recorder.
- **Stage 3, social**: native feed, friends and challenges on the existing server
  functions; a finished run can be shared to the feed from the summary screen;
  runs count toward `distance` and `runs` challenges. Whether a finished run
  already posts and counts automatically today has **not been verified** and is
  the first thing to check when this stage is planned.
- **Stage 4**: route builder, zones editor, analytics, settings and devices
  screens native.

## 12. Left to the builder

- Library choices for location, maps, speech, notifications and Bluetooth in
  Expo.
- Hosting provider (Render or Fly.io), object storage and routing providers.
- Cue timing thresholds (how long out of zone before a reminder), smoothing of
  pace and heart rate so cues do not flicker.
- Where the existing health-import and background-sync diagnostic screens live in
  the rebuilt app. Imported runs remain supported; the diagnostics are developer
  tools.
- Local storage format for unsent runs.

## 13. Owner answers (2026-11-25) and what is still open

- **(owner)** Hosting region: Northeast North America.
- **(owner)** iOS testers are added to the owner's App Store Connect team
  (TestFlight internal testing, no beta review).
- **(owner)** Sign-up requires a code provided by the owner. The existing invite
  codes (`invite_codes`, `inviteAccess`, admin-generated) are that code. Today a
  person can register first and is asked for the code afterwards, and only the
  app enforces it. **(proposal)** Registration itself now takes the code and the
  server refuses to create an account without a valid unused one; the server
  also refuses run uploads from an account with no accepted code.
- **(owner)** The goal is that everything works easily for the testers.

Still open:

- The permanent app name and bundle id for the stores. Needed before the first
  signed build, not before development.
- Privacy policy wording and health-data retention (open since the handoff; the
  stores ask for a privacy policy URL).
