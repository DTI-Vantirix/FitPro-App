# AGENTS.md

FitPro: React web app (`web/`), Node API (`server/`), Postgres, Expo shell (`native/`).
Read `README.md` for setup and `docs/architecture.md` for how it fits together.

## Rules

- `docs/native-contract.md` is the contract for health ingestion. Changing
  `ingestActivity` means changing the contract doc and the tests in the same commit.
- Schema changes go in a **new** numbered file in `server/migrations/`. Never edit a
  migration that has already been applied anywhere.
- Entity fields: add the column in a migration **and** the property in
  `server/entities/<Entity>.json`. The API refuses to start if they disagree.
- Access rules live in each entity's `rls` block. Any change needs a test in
  `server/test/api.test.js` showing who can and can't see the record.
- Never commit secrets (`server/.env`). `.env.example` lists every setting.
- No third-party analytics, ad SDKs or session recording, in web or native.

## Checks before finishing a change

```bash
npm test          # API end to end against Postgres (fitpro_test)
npm run lint      # web
npm run build     # web
```
