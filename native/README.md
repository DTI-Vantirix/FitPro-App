# Native shell (Expo)

The Expo / Expo Router shell from the handoff lives here once it's moved in. It
currently sits in a separate project on the developer's WSL machine
(`com.fitpro.spike`).

## Moving it in

1. Copy the Expo project into this folder (keep its own `package.json`; it is not
   part of the npm workspaces, because Expo manages its own dependency versions).
2. Keep its tests (`typecheck`, `check:boundaries`, `test:invite`, `test:health`,
   `test:apple`) and update `check:boundaries` to forbid imports from `../server`
   and `../web`.
3. Point it at the new API (below), then rerun every check.

## What changes in the shell

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
