// Shared by the e2e server and the specs. These accounts exist only in the
// throwaway fitpro_e2e database, which is wiped at the start of every run.
export const PORT = Number(process.env.E2E_PORT) || 4100;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export const ADMIN = { email: 'admin@e2e.test', password: 'e2e-admin-pass-1' };
export const RUNNER = { email: 'runner@e2e.test', password: 'e2e-runner-pass-1' };
