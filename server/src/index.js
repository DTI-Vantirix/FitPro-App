import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { loadRegistry } from './entities/registry.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);

if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
const registry = await loadRegistry(db);

const server = http.createServer(createApp({ db, config, registry }));
server.listen(config.port, () => {
  console.log(`FitPro API listening on http://localhost:${config.port} (${config.production ? 'production' : 'development'})`);
});

const shutdown = () => {
  server.close(() => db.close().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
