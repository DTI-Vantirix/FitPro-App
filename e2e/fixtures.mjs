// Shared by the e2e server and the specs. These accounts exist only in the
// throwaway fitpro_e2e database, which is wiped at the start of every run.
export const PORT = Number(process.env.E2E_PORT) || 4100;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
// A second server with SUBSCRIPTIONS on and a stand-in for Stripe, on its own database
// (fitpro_e2e_subs). Only e2e/05-subscribe.spec.mjs talks to it.
export const SUBS_PORT = PORT + 1;
export const SUBS_BASE_URL = `http://127.0.0.1:${SUBS_PORT}`;

export const ADMIN = { email: 'admin@e2e.test', password: 'e2e-admin-pass-1' };
// Redeemed a code under the previous build: a row in access_grants and no entitlement.
// The API must give them one when it starts (see e2e/start-server.mjs).
export const CARRIED = { email: 'carried@e2e.test', password: 'e2e-carried-pass-1' };
export const RUNNER = { email: 'runner@e2e.test', password: 'e2e-runner-pass-1' };
