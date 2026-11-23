# Native shell (Expo)

The Expo / Expo Router shell (`com.fitpro.spike`) lives in this folder. It keeps its
own `package.json` and is not part of the npm workspaces, because Expo manages its own
dependency versions. Notes from the shell's earlier Base44 steps are in
[SHELL_NOTES.md](SHELL_NOTES.md); the install commands in it are out of date.

## Running it

```
cd native
npm install
cp .env.example .env      # then set EXPO_PUBLIC_API_URL
npm run typecheck
npm run check:boundaries
npm run test:invite && npm run test:health && npm run test:apple && npm run test:android
npx expo start
```

`check:boundaries` fails if anything in the shell imports from outside `native/`
(so nothing from `../server` or `../web`) or still names a Base44 URL. The other
step tests are run directly, e.g. `node scripts/test-step6-sync.mjs`.

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
