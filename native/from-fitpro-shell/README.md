# FitPro Native — Step 1: Scaffold & Auth Spike

**State:** source prepared, not installed, not tested on a real device. Do not mark Step 1 complete until a real app-user session works and `ingestActivity` returns a response on-device.

## Source of truth and ownership

- Original contract: `docs/native-contract.md` in the **Base44 FitPro project**. Read that original before making further changes. The contract is not reproduced here to avoid a divergent copy.
- `src/` and `base44/` of the web project are **read-only**. This archive contains **only `native/`**, which can later be placed at the repository root.
- No Supabase, analytics, ad/tracking libraries, HealthKit, or Health Connect modules installed or invoked.
- App identifier in `src/config.ts` corresponds to existing FitPro Base44 app `6af009164237ed7caaaf8216`. Published backend is `https://fitpro-route-flow.base44.app`.

## Version and dependency approval

Proposed **Expo SDK 58**, React Native **0.88**, React **19.3.0**, Expo Router **58.0.30**, SecureStore **58.0.2**. The remaining packages in `package.json` are the documented Expo Router runtime dependencies and TypeScript tooling. **No `npm install` or package download was performed when preparing this archive.**

Inspect/approve `package.json` before installing. Node.js >= 22.13 is required by Expo 58. No native health packages are included, and their compatibility is NOT claimed or determined by Step 1.

## Unpack and install after approval

If this ZIP is in your Windows Downloads folder, from WSL:

```bash
mkdir -p "$HOME/fitpro-native-test" && unzip -o "/mnt/c/Users/$(cmd.exe /c echo %USERNAME% | tr -d '\r')/Downloads/FitPro_Native_Step1.zip" -d "$HOME/fitpro-native-test" && cd "$HOME/fitpro-native-test/native"
```

Or simply extract the ZIP to a folder; from inside `native/`:

```bash
npm install
npx expo install --check
npm run typecheck
npm run check:boundaries
npx expo start --tunnel
```

Expo Go for SDK 58 must be available on the device to run in Expo Go; otherwise request approval for a dev-client dependency and build a development client. Future health libraries require a development build.

## Manual Step 1 test (real device, existing test user)

1. Open the shell on an iOS or Android device and sign in with your existing FitPro **email and password** account. No personal access tokens, admin tokens, or credentials are baked into the app.
2. If MFA is configured, complete the TOTP or SMS challenge. An account needing initial MFA enrollment must first complete enrollment in the FitPro website; native MFA enrollment is not part of this spike.
3. On the ingestion screen tap **Send synthetic test workout** **once**. The screen shows HTTP status and raw response. Expect `action: "created"` with HTTP 200 on an authorized user; the backend may instead return an error, which must be reported.
4. Tap the button **again**. Expect `action: "updated"` rather than another workout. The fixed external ID is for this synthetic spike only, not health-derived activities.
5. Report the exact HTTP status, action, and error text (if any). **Never send the bearer token or screenshots revealing it.**

### Auth specifics

The existing FitPro web UI uses `POST /api/apps/{appId}/auth/login` with `{email,password}` and returns either `access_token` or MFA challenge (`mfa_session_token`). The shell uses these same known auth endpoints from `src/lib/authMfa.js` and `src/lib/authMfaFlow.js`.

The `POST /functions/ingestActivity` function requires a real authenticated **app user**. The native call sends `Authorization: Bearer <user access token>`. Whether the published backend on a **physical phone** accepts this header is a **test outcome**, not a claim.

A stored access token is treated as unverified until ingestion succeeds; a rejected/expired token yields HTTP 401 and is displayed on-screen. The **Forget stored session** action clears SecureStore locally; it does not revoke a server session. We don't implement undocumented logout endpoints in Step 1.

### Known blockers / intentionally deferred

- Google-only sign-in uses OAuth browser/redirect semantics not established for this native scheme. For Step 1, use an existing FitPro email/password account, or stop and define native OAuth handoff first.
- On-device auth and ingestion cannot be proven from the coding environment; a real device with a real account is required.
- Expo SDK 58 on-device availability may require a development build during the SDK transition. No dev-client dependency was approved or installed.
- No invitation redemption or health permissions until the corresponding future steps. The test workout is synthetic, not HealthKit/Health Connect data.
- The original user contract has no delete/unsync endpoint. Test data cannot be deleted via this app; use appropriate backend admin tooling if cleanup is desired.
- A real GitHub pull request cannot be created until the repository is connected. This standalone archive can be imported as `native/` later.

**STOP at Step 1.** Don't begin Step 2 without explicit approval.
