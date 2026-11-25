import { hashPassword } from './crypto.js';

// The first admin on a new host. Locally you run `npm run create-admin`; on a
// managed host there is no shell, so the owner sets ADMIN_EMAIL and ADMIN_PASSWORD
// and the API creates the account once, at start-up.
//
// It only ever creates. An email that already has an account is left exactly as
// it is — never promoted, never given a new password — so leaving the variables
// set cannot be used to take an account over, and changing ADMIN_PASSWORD later
// does nothing. Remove ADMIN_PASSWORD from the host once you have signed in.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_ADMIN_PASSWORD = 12;

export async function bootstrapAdmin(db, env = process.env, log = () => {}) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : '';
  // No password is the normal state once the admin exists (the checklist says to remove it).
  if (!password) return 'skipped';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    log('[admin] ADMIN_EMAIL is not an email address; no admin was created.');
    return 'skipped';
  }
  if (password.length < MIN_ADMIN_PASSWORD) {
    log(`[admin] ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD} characters; no admin was created.`);
    return 'skipped';
  }
  // The unique index on lower(email) makes this safe if two instances start at once.
  const created = await db.query(
    `insert into users (email, password_hash, role, email_verified_at)
     select $1, $2, 'admin', now()
      where not exists (select 1 from users where lower(email) = $1)
     on conflict do nothing
     returning id`,
    [email, await hashPassword(password)]
  );
  if (created.length) {
    log(`[admin] Created the first admin account for ${email}. Remove ADMIN_PASSWORD from the host settings now.`);
    return 'created';
  }
  return 'exists';
}
