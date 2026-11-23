/**
 * The FitPro API. Set EXPO_PUBLIC_API_URL in native/.env (see .env.example), e.g.
 * http://<your computer's LAN IP>:4000 in development. Never hard-code it here.
 * No admin/personal tokens are used by the native client.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const APP_AUTH_URL = `${API_URL}/api/auth`;
export const INGEST_URL = `${API_URL}/api/functions/ingestActivity`;
