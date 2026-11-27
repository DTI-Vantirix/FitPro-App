import http from 'node:http';
import { syncInviteEntitlements } from './access.js';
import { createApp } from './app.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { startTrialReminders } from './billing/reminders.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { loadRegistry } from './entities/registry.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);

if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
// Invite codes redeemed while an older build was serving (see access.js).
const carried = await syncInviteEntitlements(db);
if (carried) console.log(`[access] gave ${carried} redeemed invite code(s) their entitlement`);
await bootstrapAdmin(db, process.env, console.log);
const registry = await loadRegistry(db);

if (config.production && !config.mail.resendApiKey) {
  console.warn('[mail] RESEND_API_KEY is not set: sign-up codes and password-reset links cannot be emailed, so nobody new can sign up.');
}

if ((process.env.ANDROID_CERT_SHA256 || '').trim() && !config.appLinks.androidCertSha256.length) {
  console.warn('[links] ANDROID_CERT_SHA256 is set but holds no SHA-256 fingerprint (64 hex digits, colons optional): invite links will not open the Android app.');
}

// Payments are never a reason not to start: a missing setting is said once, here.
if (config.stripe.ready) {
  const mode = config.stripe.secretKey.startsWith('sk_live_') ? 'LIVE' : config.stripe.secretKey.startsWith('sk_test_') ? 'TEST' : null;
  console.log(mode ? `[billing] Stripe keys are for ${mode} mode.` : '[billing] Stripe keys are set (the secret key is neither sk_test_ nor sk_live_).');
} else if (config.subscriptions) {
  console.warn('[billing] SUBSCRIPTIONS is on but a Stripe setting is missing (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL): nobody can subscribe and the gate shows the invite code only.');
}

// Nothing a single request does may stop the process: a failure that escapes the
// request handler is logged and answered, and a stray rejection is only logged.
const handle = createApp({ db, config, registry });
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[error] unhandled in request', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(res.writableEnded ? undefined : '{"error":"Something went wrong on our side."}');
  });
});
process.on('unhandledRejection', (reason) => console.error('[error] unhandled rejection', reason));
server.listen(config.port, () => {
  console.log(`VantraRun API listening on http://localhost:${config.port} (${config.production ? 'production' : 'development'})`);
  console.log(`[uploads] stored ${config.storage.s3 ? `in the bucket "${config.storage.s3.bucket}"` : `on disk at ${config.uploadDir}`}`);
});

// The "your trial ends in two days" email: once now, then every hour. Only where Stripe
// is set up; without it there are no trials to remind anyone about.
if (config.stripe.ready) startTrialReminders({ db, config });

const shutdown = () => {
  server.close(() => db.close().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
