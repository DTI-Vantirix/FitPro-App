import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  await migrate(db);
} finally {
  await db.close();
}
