// Creates an admin account, or promotes an existing one.
//   npm run create-admin -- you@example.com 'a-strong-password'
// The password is only used when the account doesn't exist yet.
import { hashPassword } from '../src/auth/crypto.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

const [email, password] = process.argv.slice(2);
if (!email) {
  console.error("usage: npm run create-admin -- <email> [password]");
  process.exit(1);
}

const db = createDb(loadConfig().databaseUrl);
try {
  const [existing] = await db.query('select id from users where lower(email) = lower($1)', [email]);
  if (existing) {
    await db.query(
      `update users set role = 'admin', email_verified_at = coalesce(email_verified_at, now()) where id = $1`,
      [existing.id]
    );
    console.log(`${email} is now an admin.`);
  } else {
    if (!password || password.length < 8) {
      console.error('New accounts need a password of at least 8 characters.');
      process.exit(1);
    }
    await db.query(
      `insert into users (email, password_hash, role, email_verified_at) values (lower($1), $2, 'admin', now())`,
      [email, await hashPassword(password)]
    );
    console.log(`Created admin ${email}.`);
  }
} finally {
  await db.close();
}
