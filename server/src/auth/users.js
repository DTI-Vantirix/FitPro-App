import { HttpError } from '../lib/http.js';
import { serialize } from '../lib/serialize.js';
import { sha256, signToken, verifyToken } from './crypto.js';

// The user object the app sees (same shape Base44's auth.me() returned).
export function publicUser(row) {
  return serialize({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    consent_version: row.consent_version,
    consent_accepted_at: row.consent_accepted_at,
    email_verified: Boolean(row.email_verified_at),
    created_date: row.created_date,
    updated_date: row.updated_date,
  });
}

export function issueAccessToken(config, user) {
  return signToken({ sub: user.id, tv: user.token_version }, config.jwtSecret, config.tokenTtlSec);
}

// Resolves the signed-in user from "Authorization: Bearer <token>", or null.
// A token stops working when the password changes (token_version bump) or
// the account is deleted.
export async function authenticate(req, db, config) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const claims = verifyToken(match[1].trim(), config.jwtSecret);
  if (!claims?.sub) return null;
  const rows = await db.query('select * from users where id = $1', [claims.sub]);
  const user = rows[0];
  if (!user || user.token_version !== claims.tv || !user.email_verified_at) return null;
  return user;
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Unauthorized');
  return ctx.user;
}

export function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  return user;
}

// ------------------------------------------------------------------ one-time codes

export async function storeCode(db, userId, purpose, code, ttlMinutes) {
  // A new code replaces any earlier one for the same purpose.
  await db.query(
    `update auth_codes set used_at = now() where user_id = $1 and purpose = $2 and used_at is null returning id`,
    [userId, purpose]
  );
  await db.query(
    `insert into auth_codes (user_id, purpose, code_hash, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4::int)) returning id`,
    [userId, purpose, sha256(code), ttlMinutes]
  );
}

const MAX_CODE_ATTEMPTS = 5;

// Checks a short code typed by the user (email verification).
export async function consumeCodeForUser(db, userId, purpose, code) {
  const rows = await db.query(
    `select * from auth_codes
      where user_id = $1 and purpose = $2 and used_at is null and expires_at > now()
      order by created_date desc limit 1`,
    [userId, purpose]
  );
  const entry = rows[0];
  if (!entry || entry.attempts >= MAX_CODE_ATTEMPTS) return false;
  if (entry.code_hash !== sha256(String(code || '').trim())) {
    await db.query('update auth_codes set attempts = attempts + 1 where id = $1 returning id', [entry.id]);
    return false;
  }
  const used = await db.query(
    'update auth_codes set used_at = now() where id = $1 and used_at is null returning id',
    [entry.id]
  );
  return used.length === 1;
}

// Checks a long random token from a link (password reset). Returns the user id.
export async function consumeLinkToken(db, purpose, token) {
  const rows = await db.query(
    `update auth_codes set used_at = now()
      where code_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256(String(token || '')), purpose]
  );
  return rows[0]?.user_id || null;
}
