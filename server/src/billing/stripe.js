// The only code that talks to Stripe. Everything else gets one of these objects
// (the app puts it on `ctx.stripe`), and tests pass a fake with the same methods
// (test/stripe-fake.js), so no test ever reaches the network.
//
// Plain HTTPS with fetch, no SDK: see docs/decisions.md. Field paths and parameter
// names were checked against Stripe's reference for STRIPE_API_VERSION; what was
// checked, and where, is in docs/decisions.md ("Stripe details checked").

/** The API version every request asks for. Changing it means re-checking this file and sync.js. */
export const STRIPE_API_VERSION = '2026-11-18.endive';

const BASE = 'https://api.stripe.com';
const TIMEOUT_MS = 10000;

export class StripeError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.code = code;
  }
}

/** Stripe's form encoding: nested objects and arrays become a[b][0]=... keys. */
export function encodeForm(object) {
  const pairs = [];
  const add = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((item, i) => add(`${key}[${i}]`, item));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(object || {})) add(key, value);
  return pairs.join('&');
}

const idOf = (value) => (value && typeof value === 'object' ? value.id ?? null : value ?? null);
const seg = (id) => encodeURIComponent(String(id));

export function createStripe(config, { fetch = globalThis.fetch, now = Date.now } = {}) {
  async function request(method, path, params, { idempotencyKey } = {}) {
    if (!config?.stripe?.ready) throw new StripeError(503, 'Stripe is not set up on this server.');
    const encoded = encodeForm(params);
    const sendsBody = method === 'POST';
    const url = `${BASE}${path}${!sendsBody && encoded ? `?${encoded}` : ''}`;
    let res;
    let text;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.stripe.secretKey}`,
          'Stripe-Version': STRIPE_API_VERSION,
          ...(sendsBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: sendsBody ? encoded : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (error) {
      // The cause is named, never quoted: a transport error may carry the request, and the key with it.
      throw new StripeError(0, `Could not reach Stripe (${error?.name || 'Error'}) for ${method} ${path}.`);
    }
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const detail = body?.error || {};
      throw new StripeError(
        res.status,
        String(detail.message || `Stripe answered ${res.status} for ${method} ${path}.`),
        detail.code || detail.type || null
      );
    }
    return body;
  }

  const missing = (error) => error instanceof StripeError && (error.status === 404 || error.code === 'resource_missing');

  return {
    /**
     * One customer per account. The key makes a repeat (a retry, a second tab) return the
     * same customer. It carries the UTC day: Stripe replays whatever it first answered for a
     * key, an error included, for 24 hours, and without the day a stored error could keep
     * someone from subscribing for all of that time. With it, the next day starts clean.
     */
    createCustomer({ userId, email }) {
      const day = Math.floor(now() / 86400000);
      return request('POST', '/v1/customers', { email, metadata: { user_id: userId } }, { idempotencyKey: `customer-${userId}-${day}` });
    },

    /** Deleting a customer cancels its subscriptions at once. One that is already gone counts as done. */
    async deleteCustomer(customerId) {
      try {
        await request('DELETE', `/v1/customers/${seg(customerId)}`);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },

    retrievePrice(priceId) {
      return request('GET', `/v1/prices/${seg(priceId)}`);
    },

    async listOpenCheckoutSessions(customerId) {
      const page = await request('GET', '/v1/checkout/sessions', { customer: customerId, status: 'open', limit: 100 });
      return page?.data || [];
    },

    expireCheckoutSession(sessionId) {
      return request('POST', `/v1/checkout/sessions/${seg(sessionId)}/expire`);
    },

    /**
     * Stripe's own hosted page, for one subscription. No payment_method_types: Stripe
     * offers what the dashboard has switched on. The trial is only on the session when
     * asked for; billing mode is "flexible", which Stripe recommends for new subscriptions.
     */
    createCheckoutSession({ customerId, userId, priceId, trialDays, successUrl, cancelUrl }) {
      return request('POST', '/v1/checkout/sessions', {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
          billing_mode: { type: 'flexible' },
          metadata: { user_id: userId },
        },
      });
    },

    /** Every subscription the customer has or had, ended ones included. */
    async listSubscriptions(customerId) {
      const page = await request('GET', '/v1/subscriptions', { customer: customerId, status: 'all', limit: 100 });
      return page?.data || [];
    },

    setCancelAtPeriodEnd(subscriptionId, value) {
      return request('POST', `/v1/subscriptions/${seg(subscriptionId)}`, { cancel_at_period_end: Boolean(value) });
    },

    /** Ends a subscription now. One that is already cancelled or gone counts as done. */
    async cancelSubscription(subscriptionId) {
      try {
        await request('DELETE', `/v1/subscriptions/${seg(subscriptionId)}`);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },

    /**
     * The subscription a charge paid for, or null when Stripe does not say. The one place
     * that knows the route in this API version: a charge has no `invoice` field, so it is
     * charge -> payment_intent -> invoice payment -> invoice -> parent.subscription_details.
     */
    async subscriptionIdForCharge(chargeId) {
      const charge = await request('GET', `/v1/charges/${seg(chargeId)}`);
      const paymentIntent = idOf(charge?.payment_intent);
      if (!paymentIntent) return null;
      const payments = await request('GET', '/v1/invoice_payments', {
        payment: { type: 'payment_intent', payment_intent: paymentIntent },
        limit: 1,
      });
      const invoiceId = idOf(payments?.data?.[0]?.invoice);
      if (!invoiceId) return null;
      const invoice = await request('GET', `/v1/invoices/${seg(invoiceId)}`);
      return idOf(invoice?.parent?.subscription_details?.subscription);
    },

    /** Stripe's customer portal; with a subscription id it opens straight on the cancel confirmation. */
    createPortalSession({ customerId, returnUrl, cancelSubscriptionId }) {
      return request('POST', '/v1/billing_portal/sessions', {
        customer: customerId,
        return_url: returnUrl,
        ...(cancelSubscriptionId
          ? { flow_data: { type: 'subscription_cancel', subscription_cancel: { subscription: cancelSubscriptionId } } }
          : {}),
      });
    },
  };
}
