# FitPro Native — Step 4 (Personal Base44 backend)

**This build is already configured for the new personal-account FitPro Base44 application:** `https://fit-pro-a305cc72.base44.app` (app `6af5fd196ba44438a305cc72`). Do not reapply the separate migration patch. Its SecureStore token/consent keys match the previously migrated Step 3 shell, so an authenticated session can persist after installing this overlay. This zip replaces only `native/`; it never edits `src/` or `base44/`.

# FitPro Native — Step 4: Apple HealthKit, read-only

**Scope:** This is a complete replacement **`native/` overlay** for Steps 1–4. It does **not** include or modify the Base44 web (`src/`) or backend (`base44/`). The source of truth for ingestion and consent boundaries remains `docs/native-contract.md` in FitPro Base44.

## What is implemented

- Retains validated Step 1 user sign-in + SecureStore + synthetic ingestion, Step 2 consent/invite access, and Step 3 fake adapter with visible reload feedback.
- Adds a read-only Apple HealthKit adapter under the **same `HealthAdapter` interface**. The Activity screen still defaults to four deterministic FAKE samples. No OS health API is initialized by the fake provider.
- Apple Health is **opt-in on the Activities screen**. It requests *only* read permission for workouts, workout routes and heart rate after the user has already signed in, accepted consent, and passed `inviteAccess`. The permission dialog is never automatic at app startup.
- Lists up to 50 readable Apple Health **running workouts**, with stable HealthKit UUID, recorded distance and duration, and optional average/max HR and GPS routes. Invalid or missing run details are skipped with visible diagnostics. Route coordinates are reduced to at most 5,000 points. No splits are fabricated.
- Apple Health strength summaries are **not mapped** into FitPro strength records: the existing backend requires actual exercises, sets, reps, and weights, which normal HealthKit workouts do not provide. Nothing is invented.
- **NO genuine health uploads, no background delivery, no subscriptions/observers, no health writes**, no new backend, no additional analytics/tracking.
- No native libraries load in Expo Go unless the user explicitly selects the Apple provider and tries requesting access; the interface displays an error explaining why an iOS development build is required.

## Runtime dependencies added in Step 4

Chosen for Expo SDK 58 / React Native 0.88.1:

- `@kingstinct/react-native-healthkit@16.2.0` — maintained HealthKit binding, Expo config plugin; peers React >=19, React Native >=0.79, Nitro >=0.35.
- `react-native-nitro-modules@0.37.2` — native dependency required by HealthKit.
- `expo-dev-client@~58.0.18` — development build runtime; Expo Go cannot load HealthKit.

The HealthKit Expo plugin sets `NSHealthShareUsageDescription`; `NSHealthUpdateUsageDescription` is disabled, and `background` is `false`. This milestone is strictly read-only foreground access.

## Install over the already migrated personal-backend Step 3 working copy

1. Save `FitPro_Native_Step4_Apple_HealthKit.zip` to Windows Downloads.
2. Stop the current Expo server using **Ctrl+C**.
3. Run this exact copy-pasteable WSL command:

```bash
cd "$HOME/fitpro-native-test" && unzip -o "$(find /mnt/c/Users -maxdepth 3 -name FitPro_Native_Step4_Apple_HealthKit.zip -print -quit)" -d "$HOME/fitpro-native-test" && cd "$HOME/fitpro-native-test/native" && npm install && npx expo install --check && npm run typecheck && npm run check:boundaries && npm run test:invite && npm run test:health && npm run test:apple
```

Do **not** run `npm audit fix --force` without reviewing compatibility.

## Test the preserved fake provider in Expo Go

```bash
cd "$HOME/fitpro-native-test/native" && npx expo start --tunnel --clear
```

1. Sign in, accept consent if asked, and wait for Base44 invite verification.
2. From the ingestion spike screen, tap **View activities · Fake / Apple Health**.
3. Verify the fake provider displays four activities and reloads with visible feedback.
4. Select **Apple Health (read-only)** and tap **Request Apple Health read access**. **In Expo Go, an error should clearly state that a development build is required.** No OS HealthKit prompt should appear in Expo Go. Switch to fake to restore simulated samples.
5. The `/spike` synthetic test remains available; you do not need to submit another workout.

## Build for a real iPhone with Apple HealthKit

**A physical iPhone development build requires an active Apple Developer Program membership**, a registered test device, and iOS Developer Mode. WSL cannot directly compile an iOS app; EAS cloud builds can build it for you. You do **not** need to connect FitPro to GitHub to start, but EAS may prompt you to initialize a local Git repository inside `native/`.

Run these in WSL **from the `native/` folder**, after validation passes:

```bash
cd "$HOME/fitpro-native-test/native" && npx eas-cli@latest whoami
```

If not signed into EAS, run `npx eas-cli@latest login` and follow its prompt. Register your iPhone:

```bash
cd "$HOME/fitpro-native-test/native" && npx eas-cli@latest device:create
```

Once your Apple Developer signing account and test device are registered, create the native development build:

```bash
cd "$HOME/fitpro-native-test/native" && npx eas-cli@latest build --platform ios --profile development
```

The repo has `eas.json` with `developmentClient: true` and internal distribution. EAS may ask to associate an EAS project with this standalone source tree and to initialize local git. The existing `ios.bundleIdentifier` is `com.fitpro.spike` from Step 1; verify that identifier is appropriate for your Apple Developer team before signing, and change it *within native/app.json only* if necessary. Do not paste Apple credentials or signing secrets into ChatGPT. Install the EAS-provided build on the registered iPhone, enable **Settings → Privacy & Security → Developer Mode** if prompted, then run:

```bash
cd "$HOME/fitpro-native-test/native" && npx expo start --dev-client --tunnel --clear
```

Open the **installed FitPro Native development build**, *not* Expo Go. In **Activities**, select Apple Health, tap the permission button, allow workouts/heart rate/routes as desired, and verify the screen displays real running workouts with stable IDs. Tap Reload once. **Do not submit any health activities**; this version has no real-activity upload action.

## Step 4 acceptance checklist

- `npx expo install --check`, TypeScript, boundary, invite, fake, and Apple normalization tests all pass in WSL.
- Fake samples still function in Expo Go.
- Trying Apple Health in Expo Go gives a visible guidance error instead of crashing.
- On a signed development build and approved device, HealthKit permission request only occurs after FitPro consent and accepted invite.
- Running workouts read correctly. Missing route/HR fields appear as optional, and errors are visible on the screen.
- No health data transmitted to Base44 by the Apple adapter.
- Withdrawal of FitPro consent blocks further app reads; Apple's system authorization is managed separately under iOS Settings → Privacy & Security → Health.

**Step 4 is not accepted until physical-device testing passes.** Stop before Step 5 (Android Health Connect) until explicitly confirmed.
