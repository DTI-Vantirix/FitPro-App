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

const server = http.createServer(createApp({ db, config, registry }));
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
