// Keeps our copy of a Stripe subscription right. Stripe is the record of what was
// paid; the `entitlements` row (source 'stripe', external_id = subscription id) is a
// copy. Every path that learns something may have changed (a webhook, a return from
// checkout or the portal, a status check for someone locked out) does the same
// thing: ask Stripe for that customer's subscriptions and write what it says.
//
// This file and stripe.js are the only two that read fields of a Stripe object.
import { planForPrice } from './plans.js';
import { customerKey, serialised } from './queue.js';

const iso = (unixSeconds) => new Date(unixSeconds * 1000).toISOString();
const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Stripe's status -> ours. `incomplete` (the first payment has not gone through yet)
// is deliberately absent: nothing is written for it.
const STATUS = {
  trialing: 'trial',
  active: 'active',
  past_due: 'grace',
  canceled: 'expired',
  unpaid: 'expired',
  incomplete_expired: 'expired',
  paused: 'expired',
};

/**
 * What our row for this subscription should say, or null when nothing should be written.
 * In the pinned API version the period dates are on the subscription's item, not on the
 * subscription; the top-level fields are read only as a fallback.
 */
export function entitlementFromSubscription(config, subscription, now = new Date(), log = console) {
  if (!subscription?.id) return null;
  const status = STATUS[subscription.status];
  if (!status) {
    if (subscription.status !== 'incomplete') log.warn(`[billing] subscription ${subscription.id} has a status this build does not know: ${subscription.status}`);
    return null;
  }
  const item = subscription.items?.data?.[0] || {};
  const periodEnd = isTime(item.current_period_end) ? item.current_period_end : subscription.current_period_end;
  const periodStart = isTime(item.current_period_start) ? item.current_period_start : subscription.current_period_start;
  const priceId = typeof item.price === 'string' ? item.price : item.price?.id;

  let expiresAt;
  if (status === 'expired') {
    // Ended: when Stripe says it ended.
    const ended = [subscription.ended_at, subscription.canceled_at].find(isTime);
    expiresAt = ended ? iso(ended) : now.toISOString();
  } else if (status === 'grace') {
    // A payment failed. The period Stripe shows is the one that has not been paid for, so
    // what was paid for ended when it started. access.js allows GRACE_DAYS past that, no more.
    expiresAt = isTime(periodStart) ? iso(periodStart) : now.toISOString();
  } else {
    const end = status === 'trial' && isTime(subscription.trial_end) ? subscription.trial_end : periodEnd;
    if (!isTime(end)) {
      // A paid row with no end date would be access for ever; better no row at all.
      log.warn(`[billing] subscription ${subscription.id} is ${subscription.status} but has no period end; nothing written`);
      return null;
    }
    expiresAt = iso(end);
  }

  const plan = planForPrice(config, priceId);
  if (!plan) log.warn(`[billing] subscription ${subscription.id} is on a price that is not one of ours (${priceId || 'none'}); check STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL`);

  return {
    external_id: subscription.id,
    status,
    plan,
    expires_at: expiresAt,
    // "Cancel at the end of the period": the flag, or (on newer subscriptions) an end date.
    cancel_at_period_end: status !== 'expired' && (Boolean(subscription.cancel_at_period_end) || isTime(subscription.cancel_at)),
    trial_started_at: isTime(subscription.trial_start) ? iso(subscription.trial_start) : null,
  };
}

/**
 * The account's Stripe row to show and to act on: the newest one that has not ended
 * (so a `grace` row past its allowance still counts, and the paywall can say why).
 */
export async function stripeRowOf(db, userId) {
  const [row] = await db.query(
    `select * from entitlements
      where user_id = $1 and source = 'stripe' and status not in ('expired', 'revoked')
      order by created_date desc, id desc
      limit 1`,
    [userId]
  );
  return row || null;
}

/**
 * The account's Stripe customer id, made on first use. Stripe is called with no
 * transaction open; the id is then claimed in a short one that holds the user's row, so
 * if two requests got here together the first id written is the one both use. Callers
 * also queue per account (queue.js), which is what stops two tabs making two customers.
 */
export async function ensureCustomer(db, stripe, user) {
  const [row] = await db.query('select stripe_customer_id from users where id = $1', [user.id]);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe.createCustomer({ userId: user.id, email: user.email });
  return db.tx(async (tx) => {
    const [held] = await tx.query('select stripe_customer_id from users where id = $1 for no key update', [user.id]);
    if (held?.stripe_customer_id) return held.stripe_customer_id;
    await tx.query('update users set stripe_customer_id = $2, updated_date = now() where id = $1 returning id', [user.id, customer.id]);
    return customer.id;
  });
}

/**
 * Writes what Stripe said about a customer's subscriptions, in one short transaction
 * that holds the user's row. Nothing here calls Stripe.
 *  - one row per subscription, found by (source, external_id); `user_id` never changes;
 *  - a row that is `revoked` (refunded) is never changed, whatever Stripe says later;
 *  - a row that already says the same is left alone, `updated_date` included;
 *  - the account's one free trial is marked used when a subscription has had one.
 * Returns null when no account has that customer any more (deleted in the meantime).
 */
async function writeSubscriptions(db, config, customerId, subscriptions) {
  return db.tx(async (tx) => {
    const [owner] = await tx.query('select id from users where stripe_customer_id = $1 for no key update', [customerId]);
    if (!owner) return null;
    let trialStartedAt = null;
    for (const subscription of subscriptions) {
      const next = entitlementFromSubscription(config, subscription);
      if (!next) continue;
      if (next.trial_started_at && (!trialStartedAt || next.trial_started_at < trialStartedAt)) trialStartedAt = next.trial_started_at;
      await tx.query(
        `insert into entitlements (user_id, source, status, plan, expires_at, cancel_at_period_end, external_id)
         values ($1, 'stripe', $2, $3, $4, $5, $6)
         on conflict (source, external_id) where external_id is not null
         do update set
           status = excluded.status,
           plan = coalesce(excluded.plan, entitlements.plan),
           expires_at = excluded.expires_at,
           cancel_at_period_end = excluded.cancel_at_period_end,
           updated_date = now()
         where entitlements.status <> 'revoked'
           and (entitlements.status, entitlements.plan, entitlements.expires_at, entitlements.cancel_at_period_end)
               is distinct from
               (excluded.status, coalesce(excluded.plan, entitlements.plan), excluded.expires_at, excluded.cancel_at_period_end)
         returning id`,
        [owner.id, next.status, next.plan, next.expires_at, next.cancel_at_period_end, next.external_id]
      );
    }
    if (trialStartedAt) {
      await tx.query('update users set trial_used_at = $2 where id = $1 and trial_used_at is null returning id', [owner.id, trialStartedAt]);
    }
    const rows = await tx.query(
      `select * from entitlements where user_id = $1 and source = 'stripe' order by created_date, id`,
      [owner.id]
    );
    return { userId: owner.id, rows };
  });
}

/**
 * Asks Stripe for the customer's subscriptions and writes what it says. Returns null when
 * no account has that customer id (a deleted account, or a customer that is not ours).
 *
 * Stripe is asked with no transaction open and no row held, so a slow Stripe ties up
 * nothing in the database. Work for one customer goes one at a time through the queue,
 * so the answer read last is the one written last. Never call this from inside a
 * transaction, or from inside other work queued under the same customer.
 * Throws StripeError when Stripe cannot be reached; nothing is written then.
 */
export async function syncCustomer(db, stripe, config, customerId) {
  if (!customerId) return null;
  const [owner] = await db.query('select id from users where stripe_customer_id = $1', [customerId]);
  if (!owner) return null;
  return serialised(customerKey(customerId), async () => {
    const subscriptions = await stripe.listSubscriptions(customerId);
    return writeSubscriptions(db, config, customerId, subscriptions);
  });
}
