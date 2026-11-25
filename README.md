# FitPro

Run tracking, route building, pace zones, gym logging, friends and group challenges.

This repo is the standalone version of FitPro: the React web app, a Node API, a
Postgres database, and (soon) the Expo native shell. It replaces the Base44-hosted
version; nothing here depends on Base44.

```
web/      React + Vite web app (the UI from the Base44 app, unchanged except for the API client)
server/   Node API: sign-in, record storage with per-record access rules, backend functions
native/   Expo / React Native shell (iOS + Android) — to be moved in, see native/README.md
docs/     architecture, decisions, the native ingestion contract
```

## Run it locally

You need **Node 20.11+** and **Postgres 16** (Docker is the easiest way to get it).
On Windows, do all of this inside WSL, from the Linux filesystem (not `/mnt/c/...`).

```bash
npm install                 # installs web/ and server/
npm run db:up               # starts Postgres in Docker (creates fitpro and fitpro_test)
cp .env.example server/.env # defaults work for local development
npm run migrate             # creates the tables
npm run create-admin -- you@example.com 'a-long-password'
npm run dev                 # API on :4000, web app on :5173
```

Open http://localhost:5173 and sign in with the admin account. Admins skip the invite
gate and can mint invite codes for testers from Settings.

Without Docker: install Postgres 16 (`sudo apt install postgresql` in WSL), then
create the role and databases:

```bash
sudo -u postgres psql -c "create role fitpro login password 'fitpro'" \
  -c "create database fitpro owner fitpro" -c "create database fitpro_test owner fitpro"
```

**Email in development.** No mail provider is needed: verification codes and
password-reset links are printed in the API console (`[mail] ...`), and the API also
returns them in its response (`dev_code`, `dev_token`) outside production. Set
`RESEND_API_KEY` to send real email.

## Tests

```bash
npm test
```

Runs the API end to end against the `fitpro_test` database (wiped on every run):
sign-up and sign-in, password reset, the access rules on every kind of record,
invite codes, the `ingestActivity` contract the native app depends on, the social
feed, challenges, uploads and account deletion.

```bash
npm run e2e            # browser flows (Playwright), first time: npx playwright install chromium
npm run check          # API tests, web lint and browser flows, one summary
npm run check:watch    # the same, rerun every time a source file changes
```

The browser flows in `e2e/` drive the built web app, served by the real API, as the
owner (sign in, generate and revoke invite codes) and as a tester (sign up with a
code, verify, consent, open every screen, sign out). They use their own database,
`fitpro_e2e`, created on first run and wiped on every run. GitHub reruns all three
on every push and pull request (`.github/workflows/checks.yml`).

## How the pieces fit

- [docs/architecture.md](docs/architecture.md): how the API, database and apps fit
  together, and what replaced each Base44 feature.
- [docs/native-contract.md](docs/native-contract.md): how the phone sends health
  data in. Source of truth for the native shell.
- [docs/decisions.md](docs/decisions.md): decisions made, open questions, and
  what's left before the app stores.

## Deploying

Not chosen yet. Because this is plain Node + Postgres, it runs on most hosts
(Fly.io, Railway, Render, a VPS, AWS). The short version: provision Postgres, set
the variables in `.env.example` (a real `JWT_SECRET` and `RESEND_API_KEY` at
minimum), run `npm run migrate`, `npm run build`, and start the API with
`WEB_DIST=web/dist` to serve the web app from the same process. See the deployment
checklist in [docs/decisions.md](docs/decisions.md).
