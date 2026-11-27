import { grantFree, hasAccess } from '../access.js';
import { HttpError, rateLimiter } from '../lib/http.js';

// Invite codes: a single-use code from the owner opens the app for one athlete,
// for free. Who has access is decided in ../access.js; redeeming a code here is
// one of the ways to get it.
const redeemLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many code attempts. Wait 15 minutes and try again.',
});

export const normalizeCode = (value) => String(value || '').trim().toUpperCase();

// Claims an available code for this user and records the grant: a row in
// access_grants (the invite-code admin screen reads it) and the entitlement that
// gives the access. Call inside a transaction. Returns false when the code is no
// longer available, so two people can never share one.
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
  await grantFree(tx, { userId: user.id, source: 'invite', grantedBy: code });
  return true;
}

export default async function inviteAccess({ db, user, body }) {
  const action = body?.action || 'status';

  if (action === 'status') {
    if (user.role === 'admin') return { allowed: true, admin: true };
    return { allowed: await hasAccess(db, user) };
  }

  if (action === 'redeem') {
    const code = normalizeCode(body?.code);
    if (!code) return { allowed: false, error: 'Enter an invite code.' };
    if (await hasAccess(db, user)) return { allowed: true };
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
