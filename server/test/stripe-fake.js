// A stand-in for src/billing/stripe.js with the same methods, kept in memory.
// The API tests and the browser tests' second server pass it to createApp, so
// nothing in a test run reaches Stripe. Objects have the shape of the pinned API
// version where our code reads them (period dates on the subscription's item).
import crypto from 'node:crypto';
import { StripeError } from '../src/billing/stripe.js';

/** Stripe settings for tests: made-up ids, never real keys. */
export const TEST_STRIPE = {
  secretKey: 'sk_test_fake',
  webhookSecret: 'whsec_test_fake',
  prices: { monthly: 'price_monthly_test', annual: 'price_annual_test' },
  ready: true,
};

const price = (id, unitAmount, interval) => ({ id, object: 'price', currency: 'usd', unit_amount: unitAmount, recurring: { interval, interval_count: 1 } });

export const TEST_PRICES = {
  [TEST_STRIPE.prices.monthly]: price(TEST_STRIPE.prices.monthly, 499, 'month'),
  [TEST_STRIPE.prices.annual]: price(TEST_STRIPE.prices.annual, 4999, 'year'),
};

const DAY = 24 * 60 * 60;
const unix = (ms = Date.now()) => Math.floor(ms / 1000);

export function createFakeStripe({
  prices = TEST_PRICES,
  checkoutUrl = (session) => `https://checkout.stripe.test/c/pay/${session.id}`,
  portalUrl = (portal) => `https://billing.stripe.test/p/session/${portal.id}`,
} = {}) {
  const state = {
    customers: new Map(),
    sessions: new Map(),
    subscriptions: new Map(),
    charges: new Map(), // charge id -> subscription id
    portals: [],
  };
  const calls = [];
  const failing = new Map();
  let seq = 0;
  const nextId = (prefix) => `${prefix}_fake${String((seq += 1)).padStart(4, '0')}${crypto.randomBytes(3).toString('hex')}`;

  // Records the call, waits if a test is holding the method, then fails it if a test asked for that.
  const holds = new Map();
  async function enter(method, args) {
    calls.push({ method, args });
    if (holds.has(method)) await holds.get(method).promise;
    const left = failing.get(method) || 0;
    if (left > 0) {
      failing.set(method, left - 1);
      throw new StripeError(0, `Could not reach Stripe (fake) for ${method}.`);
    }
  }

  const copy = (value) => JSON.parse(JSON.stringify(value));

  const api = {
    async createCustomer({ userId, email }) {
      await enter('createCustomer', { userId, email });
      // Same idempotency key, same customer.
      const existing = [...state.customers.values()].find((c) => c.metadata.user_id === userId && !c.deleted);
      if (existing) return copy(existing);
      const customer = { id: nextId('cus'), object: 'customer', email, metadata: { user_id: userId }, deleted: false };
      state.customers.set(customer.id, customer);
      return copy(customer);
    },

    async deleteCustomer(customerId) {
      await enter('deleteCustomer', { customerId });
      const customer = state.customers.get(customerId);
      if (!customer) return;
      customer.deleted = true;
      for (const sub of state.subscriptions.values()) {
        if (sub.customer === customerId && sub.status !== 'canceled') {
          Object.assign(sub, { status: 'canceled', canceled_at: unix(), ended_at: unix(), cancel_at_period_end: false });
        }
      }
    },

    async retrievePrice(priceId) {
      await enter('retrievePrice', { priceId });
      const found = prices[priceId];
      if (!found) throw new StripeError(404, `No such price: '${priceId}'`, 'resource_missing');
      return copy(found);
    },

    async listOpenCheckoutSessions(customerId) {
      await enter('listOpenCheckoutSessions', { customerId });
      return [...state.sessions.values()].filter((s) => s.customer === customerId && s.status === 'open').map(copy);
    },

    async expireCheckoutSession(sessionId) {
      await enter('expireCheckoutSession', { sessionId });
      const session = state.sessions.get(sessionId);
      if (!session) throw new StripeError(404, 'No such checkout session', 'resource_missing');
      if (session.status === 'open') session.status = 'expired';
      return copy(session);
    },

    async createCheckoutSession({ customerId, userId, priceId, trialDays, successUrl, cancelUrl }) {
      await enter('createCheckoutSession', { customerId, userId, priceId, trialDays, successUrl, cancelUrl });
      const session = {
        id: nextId('cs_test'),
        object: 'checkout.session',
        mode: 'subscription',
        status: 'open',
        customer: customerId,
        client_reference_id: userId,
        price: priceId,
        trialDays: trialDays > 0 ? trialDays : 0,
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription: null,
      };
      session.url = checkoutUrl(session);
      state.sessions.set(session.id, session);
      return copy(session);
    },

    async listSubscriptions(customerId) {
      await enter('listSubscriptions', { customerId });
      return [...state.subscriptions.values()].filter((s) => s.customer === customerId).map(copy);
    },

    async setCancelAtPeriodEnd(subscriptionId, value) {
      await enter('setCancelAtPeriodEnd', { subscriptionId, value });
      const sub = state.subscriptions.get(subscriptionId);
      if (!sub) throw new StripeError(404, 'No such subscription', 'resource_missing');
      sub.cancel_at_period_end = Boolean(value);
      return copy(sub);
    },

    async cancelSubscription(subscriptionId) {
      await enter('cancelSubscription', { subscriptionId });
      const sub = state.subscriptions.get(subscriptionId);
      if (!sub || sub.status === 'canceled') return;
      Object.assign(sub, { status: 'canceled', canceled_at: unix(), ended_at: unix(), cancel_at_period_end: false });
    },

    async subscriptionIdForCharge(chargeId) {
      await enter('subscriptionIdForCharge', { chargeId });
      return state.charges.get(chargeId) ?? null;
    },

    async createPortalSession({ customerId, returnUrl, cancelSubscriptionId }) {
      await enter('createPortalSession', { customerId, returnUrl, cancelSubscriptionId });
      const portal = { id: nextId('bps'), customer: customerId, return_url: returnUrl, cancel: cancelSubscriptionId || null };
      portal.url = portalUrl(portal);
      state.portals.push(portal);
      return copy(portal);
    },
  };

  /** A subscription as Stripe would hold it. `periodDays` back-dates or extends the current period. */
  function addSubscription({ customerId, priceId, status = 'active', trialDays = 0, periodDays } = {}) {
    const now = unix();
    const trialing = status === 'trialing';
    const yearly = prices[priceId]?.recurring?.interval === 'year';
    const length = (periodDays ?? (trialing ? trialDays || 7 : yearly ? 365 : 30)) * DAY;
    const sub = {
      id: nextId('sub'),
      object: 'subscription',
      customer: customerId,
      status,
      created: now,
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      trial_start: trialing ? now : null,
      trial_end: trialing ? now + length : null,
      items: {
        object: 'list',
        data: [{ id: nextId('si'), object: 'subscription_item', current_period_start: now, current_period_end: now + length, price: { id: priceId, object: 'price' } }],
      },
    };
    state.subscriptions.set(sub.id, sub);
    return sub;
  }

  return {
    ...api,
    calls,
    state,

    /** The person finished Stripe's page: the session completes and its subscription starts. No webhook is sent. */
    completeCheckout(sessionId, { status } = {}) {
      const session = state.sessions.get(sessionId);
      if (!session) throw new Error(`no fake checkout session ${sessionId}`);
      if (session.status !== 'open') throw new Error(`fake checkout session ${sessionId} is ${session.status}`);
      const sub = addSubscription({
        customerId: session.customer,
        priceId: session.price,
        status: status || (session.trialDays ? 'trialing' : 'active'),
        trialDays: session.trialDays,
      });
      session.status = 'complete';
      session.subscription = sub.id;
      return copy(sub);
    },

    addSubscription: (options) => copy(addSubscription(options)),

    /**
     * Changes a subscription as Stripe would have. `current_period_start`, `current_period_end`
     * (unix seconds) and `price` go on the item; everything else on the subscription.
     */
    setSubscription(id, patch) {
      const sub = state.subscriptions.get(id);
      if (!sub) throw new Error(`no fake subscription ${id}`);
      const { current_period_start: start, current_period_end: end, price: priceId, ...rest } = patch;
      const [item] = sub.items.data;
      if (start !== undefined) item.current_period_start = start;
      if (end !== undefined) item.current_period_end = end;
      if (priceId !== undefined) item.price = { id: priceId, object: 'price' };
      Object.assign(sub, rest);
      return copy(sub);
    },

    /** A charge that paid for this subscription; returns its id (for a refund notice). */
    chargeFor(subscriptionId, { traceable = true } = {}) {
      const id = nextId('ch');
      if (traceable) state.charges.set(id, subscriptionId);
      return id;
    },

    /** Makes the next call (or the next `times` calls) to a method fail as if Stripe could not be reached. */
    failNext(methodName, times = 1) {
      failing.set(methodName, times);
    },

    /**
     * Makes every call to a method wait, as when Stripe is slow, until the returned function
     * is called. The call is recorded when it arrives, so a test can see it is waiting.
     */
    hold(methodName) {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      holds.set(methodName, { promise });
      return () => {
        holds.delete(methodName);
        release();
      };
    },

    callsTo: (methodName) => calls.filter((c) => c.method === methodName),
  };
}

/** A webhook delivery as Stripe signs it: the body to post and its Stripe-Signature header. */
export function signedEvent(secret, { id, type, object }, { at = Date.now() } = {}) {
  const body = JSON.stringify({
    id: id || `evt_fake${crypto.randomBytes(8).toString('hex')}`,
    object: 'event',
    api_version: '2026-11-18.endive',
    created: unix(at),
    type,
    data: { object },
  });
  const t = unix(at);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { body, header: `t=${t},v1=${v1}` };
}

/** The Stripe-Signature header for any body, signed as Stripe would (for a body that is not an event). */
export function signBody(secret, body, { at = Date.now() } = {}) {
  const t = unix(at);
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export const daysFromNowUnix = (days) => unix() + Math.round(days * DAY);
