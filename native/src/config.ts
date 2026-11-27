/**
 * The FitPro API. Set EXPO_PUBLIC_API_URL in native/.env (see .env.example), e.g.
 * http://<your computer's LAN IP>:4000 in development. Never hard-code it here.
 * No admin/personal tokens are used by the native client.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

export const APP_AUTH_URL = `${API_URL}/api/auth`;
export const INGEST_URL = `${API_URL}/api/functions/ingestActivity`;
export const ENTITIES_URL = `${API_URL}/api/entities`;
export const FUNCTIONS_URL = `${API_URL}/api/functions`;
/** Where a post's photo or video is sent. Files come back from `${API_URL}/uploads/<name>`. */
export const UPLOADS_URL = `${API_URL}/api/uploads`;
/** The hosted API also serves the website (one service, see render.yaml), so links a runner
 * shares — a friend invite, a post — start at the same address. */
export const WEB_URL = API_URL;
