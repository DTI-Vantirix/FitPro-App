import { HttpError, rateLimiter } from '../lib/http.js';

// VantraRun is invite-only: a single-use code has to be redeemed once per athlete
// before the app opens for them. Admins always get in.
const redeemLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many code attempts. Wait 15 minutes and try again.',
});

const hasGrant = async (db, userId) =>
  (await db.query('select 1 from access_grants where user_id = $1 limit 1', [userId])).length > 0;

// May this person use the app? Admins always; everyone else needs an accepted code.
export const hasAccess = async (db, user) => user.role === 'admin' || hasGrant(db, user.id);

export const normalizeCode = (value) => String(value || '').trim().toUpperCase();

// Claims an available code for this user and records the grant. Call inside a
// transaction. Returns false when the code is no longer available, so two people
// can never share one.
export async function claimInvite(tx, user, code) {
  const claimed = await tx.query(
    `update invite_codes
        set status = 'used', used_by_id = $2, used_by_email = $3, used_at = now(), updated_date = now()
      where code = $1 and status = 'available'
      returning id`,
    [code, user.id, user.email]
  );
  if (!claimed.length) return false;
  await tx.query(
    `insert into access_grants (user_id, email, code, granted_at)
     values ($1, $2, $3, now())
     on conflict (user_id) do nothing
     returning id`,
    [user.id, user.email, code]
  );
  return true;
}

export default async function inviteAccess({ db, user, body }) {
  const action = body?.action || 'status';

  if (action === 'status') {
    if (user.role === 'admin') return { allowed: true, admin: true };
    return { allowed: await hasGrant(db, user.id) };
  }

  if (action === 'redeem') {
    const code = normalizeCode(body?.code);
    if (!code) return { allowed: false, error: 'Enter an invite code.' };
    if (await hasGrant(db, user.id)) return { allowed: true };
    redeemLimit(`redeem:${user.id}`);

    const [invite] = await db.query('select * from invite_codes where code = $1', [code]);
    if (!invite) return { allowed: false, error: 'That code is not recognised.' };
    if (invite.status !== 'available') return { allowed: false, error: 'That code has already been used.' };

    return db.tx(async (tx) =>
      (await claimInvite(tx, user, invite.code))
        ? { allowed: true }
        : { allowed: false, error: 'That code was just used by someone else.' }
    );
  }

  throw new HttpError(400, 'Unknown action');
}
