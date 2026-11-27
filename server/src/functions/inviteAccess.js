import { accessOf, grantFree, hasAccess } from '../access.js';
import { syncCustomer } from '../billing/sync.js';
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

// A payer whose renewal notice was lost would be locked out for good on the phone,
// which only ever asks for this status. So when an account that has a Stripe customer
// is about to be told "no", Stripe is asked first: at most once every five minutes per
// account, and a failure there changes nothing (the stored answer stands).
const RECONCILE_EVERY_MS = 5 * 60 * 1000;
const lastReconcile = new Map();

async function reconcileWithStripe({ db, user, config, stripe }) {
  if (!stripe || !config?.stripe?.ready || !user.stripe_customer_id) return false;
  const now = Date.now();
  if (now - (lastReconcile.get(user.id) || 0) < RECONCILE_EVERY_MS) return false;
  lastReconcile.set(user.id, now);
  if (lastReconcile.size > 10000) {
    for (const [id, at] of lastReconcile) if (now - at >= RECONCILE_EVERY_MS) lastReconcile.delete(id);
  }
  try {
    await syncCustomer(db, stripe, config, user.stripe_customer_id);
    return true;
  } catch (error) {
    console.error(`[billing] could not check Stripe for a locked-out account: ${error?.message || error}`);
    return false;
  }
}

export default async function inviteAccess({ db, user, body, config, stripe }) {
  const action = body?.action || 'status';

  if (action === 'status') {
    let found = await accessOf(db, user);
    if (!found.allowed && (await reconcileWithStripe({ db, user, config, stripe }))) found = await accessOf(db, user);
    // `admin` is only present for admins, as before. `subscriptions` tells the
    // screens whether to offer a subscription or only the invite code.
    const { admin, ...access } = found;
    return { ...access, ...(admin ? { admin: true } : {}), subscriptions: Boolean(config?.subscriptions) };
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
