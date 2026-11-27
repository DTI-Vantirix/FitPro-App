import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { certFingerprints } from './well-known.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

// Load server/.env when present (Node 20.12+). Real environment variables win.
try {
  process.loadEnvFile?.(path.join(SERVER_ROOT, '.env'));
} catch {
  // no .env file: fine
}

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  // Render sets this to the service's public https address.
  const hostUrl = env.RENDER_EXTERNAL_URL || '';
  const s3 = {
    endpoint: (env.S3_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: env.S3_BUCKET || '',
    region: env.S3_REGION || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
  };
  const s3Ready = Boolean(s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey);

  const jwtSecret = env.JWT_SECRET || (production ? '' : 'dev-only-secret-do-not-use-in-production');
  if (production && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 random characters in production');
  }

  // Stripe (subscriptions bought on the website). All four or nothing: with any one
  // missing the server runs as if there were none, and says so once at start-up.
  const stripe = {
    secretKey: (env.STRIPE_SECRET_KEY || '').trim(),
    webhookSecret: (env.STRIPE_WEBHOOK_SECRET || '').trim(),
    prices: {
      monthly: (env.STRIPE_PRICE_MONTHLY || '').trim(),
      annual: (env.STRIPE_PRICE_ANNUAL || '').trim(),
    },
  };
  stripe.ready = Boolean(stripe.secretKey && stripe.webhookSecret && stripe.prices.monthly && stripe.prices.annual);
  const subscriptions = env.SUBSCRIPTIONS === 'on';

  return {
    production,
    port: Number(env.PORT) || 4000,
    databaseUrl: env.DATABASE_URL || 'postgres://fitpro:fitpro@localhost:5432/fitpro',
    jwtSecret,
    tokenTtlSec: (Number(env.TOKEN_TTL_DAYS) || 30) * 24 * 60 * 60,
    // Where the web app lives; used for links in emails (password reset).
    appUrl: (env.APP_URL || hostUrl || 'http://localhost:5173').replace(/\/$/, ''),
    // Public base URL of this API, used to build upload URLs. Empty = same origin.
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    // Uploads go to this bucket when every S3_* setting is present; otherwise to uploadDir.
    storage: { s3: s3Ready ? s3 : null },
    corsOrigins: list(env.CORS_ORIGINS || 'http://localhost:5173'),
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(SERVER_ROOT, 'uploads')),
    maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 50) * 1024 * 1024,
    // Built web app to serve from this process (optional; handy for single-box deploys).
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : '',
    // Friend invite links that open the phone app (src/well-known.js, native/app.json).
    appLinks: {
      // <Apple team id>.<bundle id>, comma separated if there is ever more than one.
      iosAppIds: list(env.IOS_APP_ID || 'LA4YX3HF32.com.vantrarun.app'),
      androidPackage: 'com.vantrarun.app',
      // SHA-256 fingerprint(s) of the Android signing certificate. Empty until a build exists.
      androidCertSha256: certFingerprints(env.ANDROID_CERT_SHA256),
    },
    mail: {
      from: env.MAIL_FROM || 'VantraRun <no-reply@vantrarun.local>',
      resendApiKey: env.RESEND_API_KEY || '',
    },
    routerUrl: env.ROUTER_URL || 'https://valhalla1.openstreetmap.de/route',
    // For a hosted Valhalla provider that wants a key (sent as api_key). Empty = none.
    routerApiKey: env.ROUTER_API_KEY || '',
    // Off: sign-up needs an invite code. On: anyone can sign up, and an account
    // without access is told to subscribe or enter a code (docs/decisions.md).
    subscriptions,
    stripe,
    // Selling needs the switch and the keys. Looking after people who already pay
    // (the webhook, the portal, cancel on delete) needs only the keys.
    selling: subscriptions && stripe.ready,
    // Outside production, auth responses include the emailed code so you can
    // test sign-up without a mail provider. Never on in production.
    exposeDevCodes: !production && env.EXPOSE_DEV_CODES !== 'false',
  };
}
