# Stage 1B — Native Run Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tester can install the Expo app, sign up with their invite code, set up zones, run in one of three modes with pace and heart-rate coaching and turn directions, and have the run saved to the server even if they were offline.

**Architecture:** All run behaviour is a pure TypeScript engine under `native/src/run/` (no React, no Expo imports) that turns location fixes, heart-rate samples and clock ticks into state and cue events. A thin controller (`native/src/run/device/`) feeds it from `expo-location`, Bluetooth and a timer, and plays its cues through speech, haptics and local notifications. Screens only read the controller's state. Finished runs are files on the device; an upload queue sends them through `ingestActivity` and never deletes one the server has not accepted.

**Tech Stack:** Expo SDK 58, Expo Router, `expo-location` + `expo-task-manager` (background GPS), `react-native-maps`, `expo-speech`, `expo-haptics`, `expo-notifications`, `react-native-ble-plx` (heart-rate straps, Garmin broadcast), `expo-file-system` (run files), `expo-crypto` (run id), `expo-keep-awake`. Tests are plain `node scripts/test-*.mjs` files that transpile the module under test with `typescript` and run it in `node:vm`, as the existing ones do.

**Spec:** `docs/superpowers/specs/2026-11-25-native-run-coach-design.md` sections 9.1–9.3 and 13. Server contract: `docs/native-contract.md`.

## Global Constraints

- Native talks to the server only over HTTP; nothing under `native/` imports from `server/` or `web/` (`npm run check:boundaries`).
- No analytics, ad or session-recording SDKs.
- Health permissions (HealthKit / Health Connect) only after sign-in, consent and invite. Location, Bluetooth and notification permissions are asked on the run start screen, which is itself behind the same three gates.
- `ingestActivity` is the only write path for runs. Payload fields are exactly those in `docs/native-contract.md`; no invented fields.
- Cues state facts only. Exact spoken strings: "Pace faster than zone", "Pace slower than zone", "Pace back in zone", "Heart rate above zone", "Heart rate below zone", "Heart rate back in zone", "Off route", "Back on route". The reminder repeats the same sentence prefixed with "Still: ". Nothing ever says slow down or speed up. When pace and heart rate disagree both are shown and nothing is resolved.
- Expo packages stay on SDK 58 versions (`npx expo install`).
- Bundle id stays `com.fitpro.spike`; nothing is registered with Apple or Google.
- Every file in `native/app/` is a flat `.tsx` (the boundary check rejects anything else), so run screens are `run-start.tsx`, `run-live.tsx`, `run-summary.tsx`.
- Gym workouts are not built.
- `npm run check`, native `typecheck`, `check:boundaries` and every existing `scripts/test-*.mjs` keep passing.

## Decisions the spec left to the builder

| Decision | Value |
| --- | --- |
| GPS fix accepted when | horizontal accuracy ≤ 35 m, and implied speed from the previous accepted fix ≤ 12 m/s |
| Distance added when | the accepted fix is ≥ 3 m from the previous accepted fix (jitter guard) |
| Live pace | distance over the last 30 s of unpaused fixes; unknown until the window holds ≥ 10 s and ≥ 15 m |
| Live heart rate | median of samples from the last 10 s; unknown ("no sensor") when the newest sample is older than 15 s |
| Cue when status changes | only after the new status has held 10 s |
| Reminder | once, after 120 s continuously out of range; none after that until it has been back in |
| Start grace | no pace or heart-rate cue in the first 60 s of the run |
| Off route | ≥ 40 m from the route line for 10 s; back on route when ≤ 25 m |
| Turn announcement | once per maneuver, when ≤ 60 m of route remains before it |
| Time in zone | seconds in range ÷ seconds with a reading, per metric; omitted when there was no reading |
| Points uploaded | evenly thinned to at most 5000 |
| Active-run checkpoint | written every 15 s and on pause/finish; offered for recovery on next launch |
| Upload retry | network error, 401, 403, 429, 5xx → stays pending; 400 → kept on the device and marked "needs attention"; a run file is never deleted unless the server accepted it or the owner deletes their account |
| Map | `react-native-maps` (Apple Maps on iOS without a key; Android needs a Google Maps key at build time — Stage 1C) |

## Review Focus

1. **GPS noise at a standstill or a tunnel jump** — distance must not grow from jitter and one wild fix must not add a mile (tests in Task 2: jitter under 3 m adds nothing; a 500 m jump in 1 s is dropped).
2. **A reading that flickers across the zone edge** — must not produce a cue per flicker (Task 3: alternating in/out every 4 s yields zero cues).
3. **Heart-rate strap drops mid-run** — status becomes unknown, no "below zone" cue, time-in-zone denominator stops (Task 3 and Task 4 tests).
4. **Upload answered 400 or the app killed mid-upload** — the run file survives and is still listed (Task 6 tests; queue writes status before and after each send).
5. **`hr_max` missing or zones missing** — the app routes to setup instead of computing bounds from nothing (Task 1: `hrBounds` returns null without `hr_max`; Task 9 gate).

---

### Task 1: Zones and status (pure)

**Files:** Create `native/src/run/zones.ts`, `native/scripts/test-run-zones.mjs`. Modify `native/package.json` (script `test:run` that runs every `scripts/test-run-*.mjs`, and `test` that runs all scripts).

**Produces:**
```ts
export type Zone = { id?: string; name: string; zone_number: number; fast_sec: number; slow_sec: number; hr_min_pct: number | null; hr_max_pct: number | null; color?: string };
export type PaceStatus = 'in' | 'faster' | 'slower' | 'unknown';
export type HrStatus = 'in' | 'above' | 'below' | 'unknown';
export function zoneTemplate(thresholdSec: number): Omit<Zone, 'id'>[] & Record<string, unknown>[]; // same five records as web/src/lib/zones.js
export function sortZones(zones: Zone[]): Zone[];
export function defaultZone(zones: Zone[], routeZoneId?: string | null): Zone | null; // route's zone, else zone_number 2, else first
export function hrBounds(zone: Zone, hrMax: number | null): { min: number; max: number } | null;
export function paceStatus(zone: Zone, paceSec: number | null): PaceStatus;
export function hrStatus(bounds: { min: number; max: number } | null, bpm: number | null): HrStatus;
export function parsePace(text: string): number | null; // "8:30" -> 510; accepts 3:00..20:00
export function formatPace(sec: number | null): string; // 510 -> "8:30", null -> "--:--"
export function validHrMax(value: number): boolean; // 100..230
```

- [ ] Test first: template for 600 s gives Zone 2 `fast_sec 690, slow_sec 768, hr 60–70`; `hrBounds(zone2, 190)` = `{min:114,max:133}`; `hrBounds(zone2, null)` = null; pace 680 → `faster`, 700 → `in`, 800 → `slower`, null → `unknown`; bpm 140 vs 114–133 → `above`; `defaultZone` picks the route's zone, falls back to Zone 2; `parsePace('8:30')` = 510, `'830'`/`'25:00'` → null.
- [ ] Run, see it fail; implement; pass; commit.

### Task 2: Geometry and tracking (pure)

**Files:** Create `native/src/run/geo.ts`, `native/src/run/tracker.ts`, `native/scripts/test-run-tracker.mjs`.

**Produces:**
```ts
// geo.ts
export type LatLng = { lat: number; lng: number };
export function metersBetween(a: LatLng, b: LatLng): number;
export const METERS_PER_MILE = 1609.344;
export function projectOnPath(path: LatLng[], p: LatLng): { offMeters: number; alongMeters: number } | null;
export function pathLengthMeters(path: LatLng[]): number;
export function thinPoints<T>(points: T[], max: number): T[];
// tracker.ts
export type Fix = { lat: number; lng: number; t: number; accuracy: number | null };
export type Track = { points: Fix[]; meters: number; last: Fix | null; splits: { mile: number; pace_sec: number }[]; splitStartMovingSec: number };
export function emptyTrack(): Track;
export function addFix(track: Track, fix: Fix, movingSec: number): Track; // filter rules from the decisions table; closes a split each whole mile
export function rollingPaceSec(points: Fix[], nowMs: number): number | null;
```

- [ ] Tests: two fixes 100 m apart add ~100 m; 2 m jitter adds 0; accuracy 60 dropped; 500 m in 1 s dropped; a fix after a pause gap adds no distance (`addFix` is given `resumed: true` via `breakTrack(track)`, which clears `last`); crossing 1 mile at moving second 480 yields split `{mile:1,pace_sec:480}`; rolling pace of 3 m/s ≈ 536 s/mi; < 10 s of data → null; `projectOnPath` on an L-shaped path gives the right off-distance and along-distance; `thinPoints` of 12000 → 5000 keeping first and last.
- [ ] Fail, implement, pass, commit.

### Task 3: Cue scheduling (pure)

**Files:** Create `native/src/run/cues.ts`, `native/scripts/test-run-cues.mjs`.

**Produces:**
```ts
export type Metric = 'pace' | 'hr';
export type Cue = { metric: Metric | 'route' | 'turn'; kind: 'left' | 'returned' | 'reminder' | 'info'; text: string; at: number };
export type MetricCueState = { announced: 'in' | 'out-high' | 'out-low'; candidate: string | null; candidateSince: number; outSince: number | null; reminded: boolean };
export function initialMetricCueState(): MetricCueState;
export function stepMetricCue(state: MetricCueState, metric: Metric, status: 'in' | 'high' | 'low' | 'unknown', nowMs: number, opts: { muted: boolean; graceUntil: number }): { state: MetricCueState; cue: Cue | null };
```
`high` is pace `faster` / heart rate `above`; `low` is `slower` / `below`. Texts come from Global Constraints. `unknown` freezes the state (no cue, timers do not advance). A muted metric still advances its state so un-muting does not replay old cues.

- [ ] Tests: out for 9 s → no cue; 10 s → "Heart rate above zone"; stays out → exactly one "Still: …" at 120 s and none at 300 s; back in for 10 s → "Heart rate back in zone"; flicker in/out every 4 s for 2 min → no cues; high → low directly announces the new side; unknown in the middle produces nothing; inside grace nothing; muted returns no cue but un-muted later does not replay; pace texts say faster/slower.
- [ ] Fail, implement, pass, commit.

### Task 4: Directions and off-route (pure)

**Files:** Create `native/src/run/directions.ts`, `native/scripts/test-run-directions.mjs`.

**Produces:**
```ts
export type Maneuver = { index: number; instruction: string; verbal: string; type: number; lat: number; lng: number; at_mi: number };
export type NavState = { announced: number[]; offRoute: boolean; offSince: number | null };
export function initialNavState(): NavState;
export function stepNav(nav: NavState, input: { path: LatLng[]; maneuvers: Maneuver[]; position: LatLng; nowMs: number }): { nav: NavState; next: { maneuver: Maneuver; metersAway: number } | null; cues: Cue[] };
```
The next maneuver is the first whose `at_mi` is ahead of the runner's along-route distance. With no maneuvers (directions unavailable) off-route detection still works from `path`.

- [ ] Tests: next maneuver and distance along an L path; verbal cue emitted once at ≤ 60 m and not again; 45 m off for 9 s → nothing, 10 s → "Off route" once; back within 25 m → "Back on route"; empty maneuvers still report off route; while off route no turn cues.
- [ ] Fail, implement, pass, commit.

### Task 5: Run engine and summary (pure)

**Files:** Create `native/src/run/engine.ts`, `native/src/run/payload.ts`, `native/scripts/test-run-engine.mjs`.

**Produces:**
```ts
export type RunMode = 'route' | 'free' | 'free_map';
export type RunConfig = { externalId: string; mode: RunMode; zone: Zone; hrMax: number | null; route: { id: string; name: string; path: LatLng[]; maneuvers: Maneuver[] } | null; ownerId: string };
export type RunState = { config: RunConfig; startedAt: number; status: 'running' | 'paused' | 'finished'; movingMs: number; lastClock: number; track: Track; hrSamples: { t: number; bpm: number }[]; hr: { min: number | null; max: number | null; sum: number; count: number; device: string | null }; pace: number | null; bpm: number | null; paceStatus: PaceStatus; hrStatus: HrStatus; zoneSec: { paceIn: number; paceKnown: number; hrIn: number; hrKnown: number }; cue: { pace: MetricCueState; hr: MetricCueState }; nav: NavState; next: { maneuver: Maneuver; metersAway: number } | null; mute: { pace: boolean; hr: boolean } };
export function startRun(config: RunConfig, nowMs: number, mute?: { pace: boolean; hr: boolean }): RunState;
export function onFix(state: RunState, fix: Fix): { state: RunState; cues: Cue[] };
export function onHeartRate(state: RunState, bpm: number, tMs: number, device?: string): RunState; // 30..240 only
export function onClock(state: RunState, nowMs: number): { state: RunState; cues: Cue[] };
export function pauseRun(state: RunState, nowMs: number): RunState;
export function resumeRun(state: RunState, nowMs: number): RunState;
export function finishRun(state: RunState, nowMs: number): RunState;
export function setMute(state: RunState, mute: { pace: boolean; hr: boolean }): RunState;
// payload.ts
export type RunSummary = { externalId: string; startedAt: string; mode: RunMode; routeName: string; distanceMi: number; durationSec: number; avgPaceSec: number | null; splits: { mile: number; pace_sec: number }[]; hr: { min: number; max: number; avg: number } | null; paceInZonePct: number | null; hrInZonePct: number | null; zone: { name: string; fast_sec: number; slow_sec: number; hrMin: number | null; hrMax: number | null }; points: LatLng[] };
export function summarize(state: RunState): RunSummary;
export function buildRunPayload(summary: RunSummary, routeId: string | null, hrDevice: string | null): Record<string, unknown> | null; // null when distance or duration is not > 0
```
`onClock` is safe to call from both the 1 s timer and each fix: it advances by `nowMs - lastClock` (capped at 5 s per call so a suspended timer cannot credit zone time it did not observe) and is a no-op when paused.

- [ ] Tests: a simulated 12-minute run at a steady in-zone pace gives distance, duration, average pace and one split; time paused is excluded from duration and its distance is not counted; heart rate 150 for half the run then silence gives `hrInZonePct` over the half with readings and `hr.min/max/avg`; no sensor → `hr: null` and payload has no heart-rate fields; payload keys are exactly contract fields (`source: 'fitpro'`, `external_id`, `distance_mi`, `duration_sec`, `started_at`, `route_name`, `points`, `splits`, `avg_hr`, `max_hr`, `min_hr`, `hr_device`, `route_id`, `target_zone_name`, `target_fast_sec`, `target_slow_sec`, `in_zone_pct`, `hr_in_zone_pct`, `hr_target_min`, `hr_target_max`) and never `avg_pace_sec`; a zero-distance run builds no payload; free run's `route_name` is "Free run"; pace above zone and heart rate in zone at the same time leave both statuses as they are and emit only the pace cue.
- [ ] Fail, implement, pass, commit.

### Task 6: Offline upload queue (pure) and API client

**Files:** Create `native/src/run/queue.ts`, `native/src/run/api.ts`, `native/scripts/test-run-queue.mjs`, `native/scripts/test-run-api.mjs`. Modify `native/src/config.ts` (no new URLs hard-coded; add `ENTITIES_URL`, `FUNCTIONS_URL`).

**Produces:**
```ts
// queue.ts
export type StoredRun = { summary: RunSummary; payload: Record<string, unknown> | null; ownerId: string; status: 'pending' | 'uploaded' | 'needs_attention' | 'local_only'; attempts: number; lastError: string | null; serverRunId: string | null; savedAt: string };
export type RunStore = { list(): Promise<string[]>; read(id: string): Promise<StoredRun | null>; write(id: string, run: StoredRun): Promise<void>; remove(id: string): Promise<void> };
export type SendResult = { kind: 'ok'; runId: string | null } | { kind: 'retry'; error: string; stop: boolean } | { kind: 'rejected'; error: string };
export function classifyResponse(status: number | null, body: unknown, error?: string): SendResult;
export async function enqueueRun(store: RunStore, run: StoredRun): Promise<void>;
export async function flushQueue(store: RunStore, ownerId: string, send: (payload: Record<string, unknown>) => Promise<SendResult>): Promise<{ uploaded: number; pending: number; needsAttention: number }>;
export async function pruneUploaded(store: RunStore, keep: number): Promise<void>; // only ever removes status 'uploaded'
// api.ts — every call takes the token; all throw ApiError { status, message }
export function register(input: { email: string; password: string; fullName: string; inviteCode: string }): Promise<void>;
export function verifyEmailCode(email: string, code: string): Promise<string /* access_token */>;
export function resendEmailCode(email: string): Promise<void>;
export function fetchMe(token: string): Promise<{ id: string; email: string }>;
export function deleteAccount(token: string, password: string): Promise<void>;
export function loadProfile(token: string): Promise<{ id: string; hr_max: number | null; threshold_sec: number | null } | null>;
export function saveProfile(token: string, values: { hr_max: number; threshold_sec: number }): Promise<void>;
export function listZones(token: string): Promise<Zone[]>;
export function applyZones(token: string, thresholdSec: number): Promise<Zone[]>; // same steps as web applyZones
export function listRoutes(token: string): Promise<SavedRoute[]>;
export function fetchDirections(token: string, routeId: string): Promise<{ available: boolean; maneuvers: Maneuver[] }>; // never throws: failure is { available: false }
export function sendRun(token: string, payload: Record<string, unknown>): Promise<SendResult>;
```

- [ ] Queue tests: 200 `created` → uploaded with run id; network error → pending, attempts +1, flush stops; 500/401/403/429 → pending; 400 → `needs_attention` with the server's message and the file still present; another owner's runs are not sent; a throw from `store.write` after a successful send does not turn into a resend loop that loses the file (file still listed); `pruneUploaded` never removes pending or needs-attention runs; a run with `payload: null` is `local_only` and never sent; flushing twice concurrently sends each run once.
- [ ] API tests (fetch mocked, as `test-invite-api.mjs`): register sends `invite_code` upper-cased and trimmed; verify returns the token; a 409 on verify surfaces the server's sentence; `applyZones` bulk-updates when five zones exist and delete-then-bulk-creates otherwise; `fetchDirections` returns `{available:false}` on a network error; `deleteAccount` sends `DELETE /api/auth/me` with the password; `sendRun` posts to `ingestActivity` with the bearer token.
- [ ] Fail, implement, pass, commit.

### Task 7: Bluetooth heart-rate parsing (pure) and device adapters

**Files:** Create `native/src/run/hr-parse.ts`, `native/scripts/test-run-hr-parse.mjs`, `native/src/run/device/heart-rate.ts`, `native/src/run/device/location.ts`, `native/src/run/device/alerts.ts`, `native/src/run/device/run-files.ts`. Modify `native/app.json` (plugins and usage strings), `native/index.js` (define the location task before the router starts).

**Produces:**
```ts
export function parseHeartRate(base64: string): number | null; // Bluetooth Heart Rate Measurement 0x2A37: 8- or 16-bit by flag bit 0
// device/heart-rate.ts: scan for service 0x180D, connect, subscribe; reconnects after a drop
export function createHeartRateMonitor(onSample: (bpm: number, device: string) => void): { scan(onFound: (d: { id: string; name: string }) => void): Promise<() => void>; connect(id: string): Promise<void>; disconnect(): Promise<void>; status(): 'idle' | 'scanning' | 'connecting' | 'connected' | 'lost' };
// device/location.ts
export const RUN_LOCATION_TASK = 'fitpro-run-location-v1';
export function setFixHandler(handler: ((fix: Fix) => void) | null): void;
export async function requestRunPermissions(): Promise<{ foreground: boolean; background: boolean }>;
export async function startTracking(): Promise<void>; export async function stopTracking(): Promise<void>;
// device/alerts.ts
export async function prepareAlerts(): Promise<void>; export function playCue(cue: Cue): void; // speech + haptic + local notification
// device/run-files.ts
export const runStore: RunStore; export function saveCheckpoint(state: RunState): void; export function loadCheckpoint(): RunState | null; export function clearCheckpoint(): void;
```
`app.json`: `expo-location` plugin with `isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled` and the three location strings; `react-native-ble-plx` with `isBackgroundEnabled: true`, `modes: ['central']`, `neverForLocation: true` and a Bluetooth string; `expo-notifications`; `ios.infoPlist.UIBackgroundModes` gains `audio` so spoken cues play with the screen locked. The Android health permission list in `app.json` is untouched (the boundary check pins it).

- [ ] Parser tests: `[0x00, 72]` → 72; `[0x01, 0x2C, 0x01]` → 300 → null (out of 30..240); `[0x01, 0xA0, 0x00]` → 160; empty → null.
- [ ] Implement adapters; `npm run typecheck`; `npx expo config --type prebuild` succeeds and shows the background modes and permissions; commit.

### Task 8: Run controller

**Files:** Create `native/src/run/controller.ts`, `native/src/run/use-run.ts`, `native/scripts/test-run-controller.mjs`.

**Produces:** `createRunController(deps)` where `deps` are the adapters from Task 7 behind interfaces, so the controller is tested in node with fakes: `begin(config, mute)`, `pause()`, `resume()`, `finish(): Promise<string /* externalId */>`, `discard()`, `setMute()`, `getState()`, `subscribe(listener)`, `recover()`. `use-run.ts` exposes it to React with `useSyncExternalStore`.

- [ ] Tests with fake deps: `begin` starts tracking and a 1 s clock; a cue from the engine is played once; `finish` stops tracking, writes the stored run **before** attempting upload, clears the checkpoint only after the run file is written, and triggers a flush; a failing flush leaves the run pending; `recover` rebuilds a paused run from a checkpoint; the checkpoint is written at most every 15 s.
- [ ] Fail, implement, pass, commit.

### Task 9: Sign-up, first-time setup, home, settings, account deletion

**Files:** Create `native/app/signup.tsx`, `native/app/setup.tsx`, `native/app/home.tsx`, `native/app/settings.tsx`, `native/src/run/profile-gate.ts` (pure: `needsSetup(profile, zones)`), test in `test-run-zones.mjs`. Modify `native/app/index.tsx` (link to sign-up; handle `needs_verification`), `native/app/invite.tsx` and `native/app/consent.tsx` (land on `/home`; consent copy covers runs recorded by the app), `native/app/_layout.tsx`, `native/src/auth/session.tsx` (owner id), `native/app/activities.tsx`, `native/src/ingestion/manual-import-panel.tsx` (automatic import off: `AUTO_HEALTH_IMPORT_ENABLED = false` hides the toggle and stops the auto effect; manual import untouched), `native/scripts/check-boundaries.mjs` (new screens exist; `auto import` constant is false; no run write through `/api/entities/Run`).

- Sign-up: name, email, password (≥ 8), invite code → `register` → 6-digit code → `verifyEmailCode` → `saveSession` → consent. A 409 on verify offers "Use a different invite code".
- Setup: max heart rate (100–230, with "estimate from age": `208 − 0.7 × age`), threshold pace `m:ss` → `saveProfile` then `applyZones`.
- Home: Start a run; runs waiting to upload with a Retry button; recovered-run prompt; Import from health; Settings.
- Settings: cue mutes default, sign out (warns when runs are waiting), delete account (password, typed confirmation "DELETE", then local runs for that owner are removed and the session cleared), developer tools (the existing ingestion test and diagnostics).

- [ ] `needsSetup` tests: no profile, no `hr_max`, fewer than one zone → true; complete → false.
- [ ] Build screens; typecheck; boundaries; commit.

### Task 10: Start, live and summary screens

**Files:** Create `native/app/run-start.tsx`, `native/app/run-live.tsx`, `native/app/run-summary.tsx`, `native/src/run/ui/RunMap.tsx`, `native/src/run/ui/format.ts` (+ tests in `test-run-engine.mjs`).

- Start: three mode cards; route list for pre-mapped (fetches directions on select, keeps them in the run config; when unavailable shows "Spoken turns unavailable — the route is still drawn"); zone picker defaulting per `defaultZone`; heart-rate sensor scan/connect; pace-cue and heart-rate-cue switches; permission requests; Start generates `external_id` with `expo-crypto` `randomUUID()`.
- Live: layout from spec 9.2; map hidden in free run; "no sensor" when heart rate is unknown; both statuses always shown side by side; mute switches; Pause/Resume; Finish (confirm). Screen kept awake.
- Summary: every stat in spec 9.3, route map, upload state ("Saved", "Waiting for a connection", "Needs attention: …") with Retry.

- [ ] Build; typecheck; boundaries; all tests; commit.

### Task 11: Docs, CI and verification

**Files:** Modify `native/README.md`, `docs/native-contract.md` (which generic entity routes the app reads and writes for profile, zones and routes — documentation of existing behaviour, no server change), `.github/workflows/checks.yml` (native job: `npm ci`, typecheck, boundaries, tests, `expo config`), `scripts/check-all.mjs` (native step), `docs/architecture.md` if it lists native screens.

- [ ] `npm run check` at the repo root passes; native `npm test` passes; `npx expo config --type prebuild` and `npx expo-doctor` reviewed; push; open pull request into `native-shell-wiring`; GitHub checks green.
- [ ] Independent review of the branch; fix important findings with a failing test first.
- [ ] Dashboard: tasks, checks, and a flag listing what needs a device.

## Not verifiable on this machine (goes on the dashboard as a flag)

Background GPS with the screen locked, speech while locked, notification mirroring to a watch, Bluetooth strap and Garmin broadcast pairing, map rendering (and the Android Google Maps key), haptics, battery use, and the whole flow on a real phone. All need a development build installed on an iPhone and an Android phone.
