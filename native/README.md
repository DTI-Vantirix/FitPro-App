# Native shell (Expo)

The Expo / Expo Router app (`com.fitpro.spike` until the store id is settled) lives in this folder.
It is the run coach: sign-up, first-time zone setup, starting a run, the live run screen and
the post-run summary, plus the earlier read-only health import. It keeps its
own `package.json` and is not part of the npm workspaces, because Expo manages its own
dependency versions. Notes from the shell's earlier Base44 steps are in
[SHELL_NOTES.md](SHELL_NOTES.md); the install commands in it are out of date.

## Running it

```
cd native
npm install
cp .env.example .env      # then set EXPO_PUBLIC_API_URL
npm run check             # type check + boundary check + every scripts/test-*.mjs
npx expo start
```

`check:boundaries` fails if anything in the shell imports from outside `native/`
(so nothing from `../server` or `../web`) or still names a Base44 URL, and it holds the
run experience to its rules (runs go through `ingestActivity` only, the run logic stays
free of React and Expo, automatic health import stays off). `npm test` runs every
`scripts/test-*.mjs`; `npm run test:run` runs only the run-coach ones. A single file is
run directly, e.g. `node scripts/test-run-cues.mjs`.

The run screens need native modules (background location, Bluetooth, maps, notifications),
so they do not work in Expo Go: build a development client (`eas build --profile development`).

## What changed from the Base44 shell

Only the backend address and sign-in. Request and response bodies are unchanged.

| Before (Base44) | Now |
| --- | --- |
| `https://fitpro-route-flow.base44.app/functions/ingestActivity` | `${EXPO_PUBLIC_API_URL}/api/functions/ingestActivity` |
| `.../functions/inviteAccess` | `${EXPO_PUBLIC_API_URL}/api/functions/inviteAccess` |
| Base44 user session | `POST /api/auth/login` → `access_token`, sent as `Authorization: Bearer ...` |

In development `EXPO_PUBLIC_API_URL` is `http://<your computer's LAN IP>:4000`
(find it with `hostname -I` in WSL, or `ipconfig` on Windows). From WSL you may need
to forward the port to Windows so the phone can reach it.

Full details: [../docs/native-contract.md](../docs/native-contract.md).

## The run experience (Stage 1B)

| Where | What |
| --- | --- |
| `src/run/*.ts` | The run itself, as plain TypeScript with no React or Expo imports: zones and in-zone status (`zones`), GPS filtering, distance, splits and live pace (`tracker`, `geo`), when to cue (`cues`), turns and off-route (`directions`), the state machine that ties them together (`engine`), the summary and upload body (`payload`), the offline upload queue (`queue`), Bluetooth heart-rate decoding (`hr-parse`) and the controller that drives a run (`controller`). Each has a `scripts/test-run-*.mjs`. |
| `src/run/api.ts` | Every HTTP call the run experience makes. |
| `src/run/device/` | The only files that touch the phone: background GPS, Bluetooth, speech/vibration/notifications, run files on disk. |
| `src/run/runtime.ts`, `use-run.tsx` | The single run controller wired to the device, and the React hooks screens use. |
| `app/signup.tsx`, `setup.tsx`, `home.tsx`, `settings.tsx`, `run-start.tsx`, `run-live.tsx`, `run-summary.tsx` | Screens. Files in `app/` stay flat. |

How a run is kept safe: the run in progress is checkpointed to the phone every 15 seconds;
a finished run is written to the phone before any upload is tried; uploads go through
`ingestActivity` with `source: "fitpro"` and an `external_id` created when the run started,
so a retry updates the same run; nothing but the server accepting a run (or the owner
deleting their account) removes it from the phone.

Cue timing and GPS thresholds are constants at the top of `cues.ts`, `tracker.ts` and
`directions.ts`, and are listed in `docs/superpowers/plans/2026-11-25-stage1b-native-run-experience.md`.

Not built yet: Apple Watch heart rate (Stage 2), sharing to the feed (Stage 3), editing
zones and building routes in the app (Stage 4), store identity and signing (Stage 1C).
On Android the map needs a Google Maps key at build time (Stage 1C); until
`android.config.googleMaps.apiKey` is set the map is replaced by a notice and never created.
