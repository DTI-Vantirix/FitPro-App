// The one place that answers "may this account use the product, and why".
// Every source of access writes a row to `entitlements` (migration 005): an
// invite code, a free pass from the owner, and later Stripe and Apple. Admins
// pass by role and need no row.
import { requireUser } from './auth/users.js';
import { HttpError } from './lib/http.js';

// A paid period that has just ended still counts for this long, so a renewal
// notice that arrives late never locks out someone who paid.
export const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

const LIVE_STATUSES = new Set(['trial', 'active', 'grace']);
const PAID_SOURCES = new Set(['stripe', 'apple']);
const FREE_SOURCES = new Set(['invite', 'admin']);

/** Is this entitlement row good at `now`? Free passes have no expiry. */
export function isLive(row, now = new Date()) {
  if (!row || !LIVE_STATUSES.has(row.status)) return false;
  if (row.expires_at === null || row.expires_at === undefined) return true;
  const end = new Date(row.expires_at).getTime();
  if (Number.isNaN(end)) return false;
  return now.getTime() <= end + GRACE_MS;
}

const endOf = (row) => (row.expires_at ? new Date(row.expires_at).getTime() : Infinity);

// Paid before free; among paid, the one that lasts longest; an invite before a hand grant.
function better(a, b) {
  const paid = Number(PAID_SOURCES.has(b.source)) - Number(PAID_SOURCES.has(a.source));
  if (paid) return paid;
  if (endOf(a) !== endOf(b)) return endOf(b) > endOf(a) ? 1 : -1;
  return a.source < b.source ? 1 : a.source > b.source ? -1 : 0;
}

function reasonFor(row) {
  if (PAID_SOURCES.has(row.source)) return row.status === 'trial' ? 'trial' : 'subscription';
  return row.source === 'invite' ? 'invite' : 'granted';
}

const NO_ACCESS = { allowed: false, admin: false, reason: null, source: null, plan: null, expires_at: null, cancel_at_period_end: false };

/** Works out an account's access from its role and its entitlement rows. */
export function decideAccess(user, rows, now = new Date()) {
  if (user?.role === 'admin') return { ...NO_ACCESS, allowed: true, admin: true, reason: 'admin' };
  const best = rows.filter((row) => isLive(row, now)).sort(better)[0];
  if (!best) return { ...NO_ACCESS };
  return {
    allowed: true,
    admin: false,
    reason: reasonFor(best),
    source: best.source,
    plan: best.plan ?? null,
    expires_at: best.expires_at ? new Date(best.expires_at).toISOString() : null,
    cancel_at_period_end: Boolean(best.cancel_at_period_end),
  };
}

export async function accessOf(db, user) {
  if (user?.role === 'admin') return decideAccess(user, []);
  if (!user?.id) return { ...NO_ACCESS };
  const rows = await db.query('select * from entitlements where user_id = $1', [user.id]);
  return decideAccess(user, rows);
}

export const hasAccess = async (db, user) => (await accessOf(db, user)).allowed;

export const NO_ACCESS_MESSAGE = 'Subscribe or enter an invite code to use VantraRun.';

/**
 * For every route that is part of the product: the signed-in user, or 401 when
 * nobody is signed in, or 403 when the account has no access. Routes a person
 * without access still needs (account, invite codes, access status) use
 * requireUser instead.
 */
export async function requireAccess(ctx) {
  const user = requireUser(ctx);
  if (!(await hasAccess(ctx.db, user))) throw new HttpError(403, NO_ACCESS_MESSAGE);
  return user;
}

/**
 * Gives an account a free pass: `invite` (a redeemed code) or `admin` (granted by
 * hand). One row per account and source. Granting again leaves a pass that is
 * still good as it is, and brings back one that was revoked. Call inside a transaction.
 */
export async function grantFree(tx, { userId, source, grantedBy = null, note = null }) {
  if (!FREE_SOURCES.has(source)) throw new Error(`grantFree is for free passes only, not "${source}"`);
  const [row] = await tx.query(
    `insert into entitlements (user_id, source, status, granted_by, note)
     values ($1, $2, 'active', $3, $4)
     on conflict (user_id, source) where source in ('invite', 'admin')
     do update set
       granted_by = case when entitlements.status = 'active' then entitlements.granted_by else excluded.granted_by end,
       note = case when entitlements.status = 'active' then entitlements.note else excluded.note end,
       status = 'active',
       expires_at = null,
       updated_date = now()
     returning *`,
    [userId, source, grantedBy, note]
  );
  return row;
}
