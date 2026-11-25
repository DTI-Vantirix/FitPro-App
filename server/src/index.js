import http from 'node:http';
import { createApp } from './app.js';
import { bootstrapAdmin } from './auth/bootstrap.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { loadRegistry } from './entities/registry.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);

if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
await bootstrapAdmin(db, process.env, console.log);
const registry = await loadRegistry(db);

if (config.production && !config.mail.resendApiKey) {
  console.warn('[mail] RESEND_API_KEY is not set: sign-up codes and password-reset links cannot be emailed, so nobody new can sign up.');
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
  console.log(`FitPro API listening on http://localhost:${config.port} (${config.production ? 'production' : 'development'})`);
  console.log(`[uploads] stored ${config.storage.s3 ? `in the bucket "${config.storage.s3.bucket}"` : `on disk at ${config.uploadDir}`}`);
});

const shutdown = () => {
  server.close(() => db.close().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
