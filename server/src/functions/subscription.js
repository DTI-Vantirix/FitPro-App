import { accessOf, isLive } from '../access.js';
import { PLANS, TRIAL_DAYS } from '../billing/plans.js';
import { StripeError } from '../billing/stripe.js';
import { ensureCustomer, lockUser, stripeRowOf, syncCustomer } from '../billing/sync.js';
import { recordServerError } from '../errors.js';
import { HttpError, rateLimiter } from '../lib/http.js';

// A subscription bought on the website: what the account has, and the way to
// Stripe's checkout. Open to an account without access (that is who needs it).
// Stripe is only ever reached through `stripe` (src/billing/stripe.js).
const UNAVAILABLE = 'Subscriptions are not available right now.';
const PROVIDER_DOWN = 'We could not reach the payment provider. Try again in a moment.';

const checkoutLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many attempts to start checkout. Try again in an hour.',
});

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** What the screens show. Reads our own tables only; never calls Stripe. */
export async function subscriptionStatus(db, config, user) {
  const [account] = await db.query('select trial_used_at, stripe_customer_id from users where id = $1', [user.id]);
  const rows = await db.query(
    `select * from entitlements where user_id = $1 and source = 'stripe' order by created_date desc, id desc`,
    [user.id]
  );
  const shown = rows.find((row) => row.status !== 'expired' && row.status !== 'revoked');
  return {
    selling: Boolean(config.selling),
    trial_available: !account?.trial_used_at,
    customer: Boolean(account?.stripe_customer_id),
    subscription: shown
      ? {
          plan: shown.plan ?? null,
          status: shown.status,
          expires_at: iso(shown.expires_at),
          cancel_at_period_end: Boolean(shown.cancel_at_period_end),
        }
      : null,
    // Paid twice (two tabs, or two devices): both are kept, and the owner refunds one.
    duplicate: rows.filter((row) => isLive(row)).length >= 2,
  };
}

// The prices configured at Stripe must be the ones people are shown. Checked before the
// first checkout and remembered for the life of the process, per Stripe client. A mismatch
// is not remembered, so putting the price right at Stripe is enough to start selling.
const pricesChecked = new WeakSet();

function priceProblem(plan, price) {
  const expected = PLANS[plan];
  if (price?.currency !== 'usd') return `is in ${price?.currency || 'no currency'}, not usd`;
  if (price?.unit_amount !== expected.amountCents) return `is ${price?.unit_amount} cents, not ${expected.amountCents}`;
  const recurring = price?.recurring || {};
  if (recurring.interval !== expected.interval || (recurring.interval_count ?? 1) !== 1) {
    return `renews every ${recurring.interval_count ?? 1} ${recurring.interval || 'nothing'}, not every ${expected.interval}`;
  }
  return null;
}

async function pricesMatch(db, stripe, config) {
  if (pricesChecked.has(stripe)) return true;
  for (const plan of Object.keys(PLANS)) {
    const priceId = config.stripe.prices[plan];
    const problem = priceProblem(plan, await stripe.retrievePrice(priceId));
    if (problem) {
      const error = new Error(`The Stripe price for the ${plan} plan (${priceId}) does not match what people are shown: it ${problem}. Nobody can subscribe until it does.`);
      console.error(`[billing] ${error.message}`);
      recordServerError(db, error, { method: 'POST', pathname: '/api/functions/subscription' });
      return false;
    }
  }
  pricesChecked.add(stripe);
  return true;
}

/** Runs work that calls Stripe; any failure there is one clear message of ours, never Stripe's. */
async function withStripe(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StripeError) {
      console.error(`[billing] ${error.message}`);
      throw new HttpError(502, PROVIDER_DOWN);
    }
    throw error;
  }
}

async function checkout({ db, user, body, config, stripe }) {
  if (!config.selling) throw new HttpError(503, UNAVAILABLE);
  checkoutLimit(`checkout:${user.id}`);
  if (!(await withStripe(() => pricesMatch(db, stripe, config)))) throw new HttpError(503, UNAVAILABLE);

  const plan = typeof body.plan === 'string' && Object.prototype.hasOwnProperty.call(PLANS, body.plan) ? body.plan : null;
  if (!plan) throw new HttpError(400, 'Choose the monthly or the annual plan.');

  // A tester, a free pass or an admin is never asked for a card.
  const access = await accessOf(db, user);
  if (access.allowed && access.reason !== 'trial' && access.reason !== 'subscription') {
    throw new HttpError(409, 'You already have access, so there is nothing to pay.');
  }
  const subscribed = () => new HttpError(409, 'You already have a subscription. Manage it in Settings.');
  if (await stripeRowOf(db, user.id)) throw subscribed();

  // One at a time per account, so two tabs share one customer and leave one open session.
  // A Stripe failure after the customer was made keeps the customer id (the transaction
  // still commits) and is reported once the lock is released.
  const result = await db.tx(async (tx) => {
    await lockUser(tx, user.id);
    let customerId;
    let known;
    try {
      [{ stripe_customer_id: known }] = await tx.query('select stripe_customer_id from users where id = $1', [user.id]);
      customerId = await ensureCustomer(tx, stripe, user);
    } catch (error) {
      if (error instanceof StripeError) return { error };
      throw error;
    }
    try {
      // The person may have paid a moment ago in another tab, with the webhook still on its
      // way: ask Stripe before selling a second subscription. This also lets them in.
      // (A customer made a moment ago has nothing to ask about.)
      if (known) {
        await syncCustomer(tx, stripe, config, customerId);
        if (await stripeRowOf(tx, user.id)) return { subscribed: true };
      }

      for (const open of await stripe.listOpenCheckoutSessions(customerId)) {
        await stripe.expireCheckoutSession(open.id);
      }
      const [account] = await tx.query('select trial_used_at from users where id = $1', [user.id]);
      const session = await stripe.createCheckoutSession({
        customerId,
        userId: user.id,
        priceId: config.stripe.prices[plan],
        trialDays: account?.trial_used_at ? 0 : TRIAL_DAYS,
        successUrl: `${config.appUrl}/?checkout=success`,
        cancelUrl: `${config.appUrl}/?checkout=cancelled`,
      });
      return { url: session.url };
    } catch (error) {
      if (error instanceof StripeError) return { error };
      throw error;
    }
  });
  if (result.subscribed) throw subscribed();
  if (result.error) await withStripe(() => Promise.reject(result.error));
  return { url: result.url };
}

const refreshLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many checks. Wait a few minutes and try again.',
});

const ownCustomer = async (db, user) =>
  (await db.query('select stripe_customer_id from users where id = $1', [user.id]))[0]?.stripe_customer_id || null;

/**
 * Asks Stripe about the account's own customer and answers with what it said. Nothing
 * in the request names a customer, a session or a subscription: an account can only
 * ever refresh itself. This is what lets a payer in when the webhook is late or lost.
 */
async function refresh({ db, user, config, stripe }) {
  refreshLimit(`refresh:${user.id}`);
  const customerId = await ownCustomer(db, user);
  if (customerId) await withStripe(() => syncCustomer(db, stripe, config, customerId));
  return { ...(await subscriptionStatus(db, config, user)), allowed: (await accessOf(db, user)).allowed };
}

/** A link to Stripe's own pages for the card, invoices and cancelling. */
async function portal({ db, user, body, config, stripe }) {
  const customerId = await ownCustomer(db, user);
  if (!customerId) throw new HttpError(404, 'You do not have a subscription to manage.');
  const row = body.flow === 'cancel' ? await stripeRowOf(db, user.id) : null;
  const session = await withStripe(() =>
    stripe.createPortalSession({
      customerId,
      returnUrl: `${config.appUrl}/settings?billing=updated`,
      ...(row?.external_id ? { cancelSubscriptionId: row.external_id } : {}),
    })
  );
  return { url: session.url };
}

/** Undoes "cancel at the end of the period" while that period is still running. */
async function resume({ db, user, config, stripe }) {
  const row = await stripeRowOf(db, user.id);
  if (!row || !row.cancel_at_period_end) {
    throw new HttpError(400, 'Your subscription is not set to end, so there is nothing to resume.');
  }
  await withStripe(async () => {
    await stripe.setCancelAtPeriodEnd(row.external_id, false);
    await syncCustomer(db, stripe, config, await ownCustomer(db, user));
  });
  return subscriptionStatus(db, config, user);
}

export default async function subscription({ db, user, body, config, stripe }) {
  const action = body?.action || 'status';
  if (action === 'status') return subscriptionStatus(db, config, user);
  if (action === 'checkout') return checkout({ db, user, body, config, stripe });
  // The rest look after a subscription that already exists. They need the keys but not
  // the switch: turning SUBSCRIPTIONS off stops new sales, never the care of a payer.
  const upkeep = { refresh, portal, resume }[action];
  if (!upkeep) throw new HttpError(400, 'Unknown action');
  if (!config.stripe?.ready) throw new HttpError(503, UNAVAILABLE);
  return upkeep({ db, user, body, config, stripe });
}
