// POST /api/stripe/webhook: Stripe telling us something changed.
//
// A notice is only a prompt. Its signature is checked over the exact bytes received,
// and then only its type and the customer it is about are read; what the subscription
// actually is, we ask Stripe (sync.js). So a repeated notice, an old one arriving late
// or one that never arrives cannot leave an account in the wrong state.
import { recordServerError } from '../errors.js';
import { HttpError, readBody } from '../lib/http.js';
import { verifyStripeSignature } from './signature.js';
import { syncCustomer } from './sync.js';

const MAX_BODY_BYTES = 1024 * 1024;
const KEEP_EVENTS_DAYS = 30;

// Any of these means "this customer's subscriptions may have changed".
const SYNC_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
]);

const idOf = (value) => (value && typeof value === 'object' ? value.id : value) || null;

/**
 * A charge was refunded in full: the subscription it paid for ends now, here and at
 * Stripe, with no allowance. A free pass on the same account is a different row and
 * is not touched.
 */
async function handleRefund(db, tx, stripe, config, customerId, chargeId) {
  // Make sure every subscription the customer has is in our table before choosing one.
  const synced = await syncCustomer(tx, stripe, config, customerId);
  if (!synced) return 'ignored';

  const subscriptionId = chargeId ? await stripe.subscriptionIdForCharge(chargeId) : null;
  let row = null;
  if (subscriptionId) {
    row = synced.rows.find((r) => r.external_id === subscriptionId) || null;
  } else {
    // Stripe could not say which subscription the charge paid for. With one that has not
    // ended there is nothing to choose between.
    const open = synced.rows.filter((r) => r.status !== 'expired' && r.status !== 'revoked');
    if (open.length === 1) [row] = open;
  }
  if (!row) {
    const error = new Error(`Refund received for ${customerId} but the subscription could not be identified. Cancel it in Stripe.`);
    console.error(`[billing] ${error.message}`);
    // On the pool, not the transaction: the report is written after this returns.
    recordServerError(db, error, { method: 'POST', pathname: '/api/stripe/webhook' });
    return 'handled';
  }
  if (row.status === 'revoked') return 'handled';

  await stripe.cancelSubscription(row.external_id);
  await tx.query(
    `update entitlements
        set status = 'revoked', note = 'Refunded', expires_at = now(), cancel_at_period_end = false, updated_date = now()
      where id = $1 returning id`,
    [row.id]
  );
  // Picks up anything else that changed; a revoked row is never changed back.
  await syncCustomer(tx, stripe, config, customerId);
  return 'handled';
}

/**
 * Handles one verified event. The event id is recorded in the same transaction as the
 * work, so an event is either handled and remembered, or neither (and Stripe sends it again).
 */
export async function handleStripeEvent(db, stripe, config, event) {
  const eventId = typeof event?.id === 'string' ? event.id : '';
  const type = typeof event?.type === 'string' ? event.type : '';
  if (!eventId || !type) throw new HttpError(400, 'That is not a Stripe event.');
  const object = event.data?.object || {};
  const customerId = idOf(object.customer);

  try {
    return await db.tx(async (tx) => {
      const fresh = await tx.query(
        'insert into stripe_events (id, type) values ($1, $2) on conflict (id) do nothing returning id',
        [eventId.slice(0, 255), type.slice(0, 100)]
      );
      if (!fresh.length) return 'duplicate';
      await tx.query(`delete from stripe_events where received_at < now() - make_interval(days => $1::int) returning id`, [KEEP_EVENTS_DAYS]);

      if (SYNC_EVENTS.has(type)) {
        return customerId && (await syncCustomer(tx, stripe, config, customerId)) ? 'handled' : 'ignored';
      }
      if (type === 'charge.refunded') {
        // Only a full refund ends access; a partial one changes nothing.
        if (object.refunded !== true || !customerId) return 'ignored';
        return handleRefund(db, tx, stripe, config, customerId, idOf(object.id));
      }
      return 'ignored';
    });
  } catch (error) {
    // The transaction took the event id back with it. This is for a database driver
    // that has no transactions (the psql test driver): same outcome.
    await db.query('delete from stripe_events where id = $1 returning id', [eventId.slice(0, 255)]).catch(() => {});
    throw error;
  }
}

export function registerBillingRoutes(router) {
  router.add(
    'POST',
    '/api/stripe/webhook',
    async (ctx) => {
      // Without the keys there is no endpoint: nothing to verify a delivery against.
      if (!ctx.config.stripe?.ready) throw new HttpError(404, 'Not found');
      const raw = await readBody(ctx.req, MAX_BODY_BYTES);
      if (!verifyStripeSignature(raw, ctx.req.headers['stripe-signature'], ctx.config.stripe.webhookSecret)) {
        throw new HttpError(400, 'Invalid signature.');
      }
      let event;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(400, 'That is not a Stripe event.');
      }
      // A failure in here (Stripe unreachable, the database down) is a 500, which is what
      // makes Stripe deliver the event again later.
      const outcome = await handleStripeEvent(ctx.db, ctx.stripe, ctx.config, event);
      return outcome === 'duplicate' ? { received: true, duplicate: true } : { received: true };
    },
    { raw: true }
  );
}
