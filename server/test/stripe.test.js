// Stripe, without Stripe: the settings, the webhook signature check, the request
// encoding and the mapping from a Stripe subscription to our entitlement row. No
// database and no network; `fetch` is a stub.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { PLANS, TRIAL_DAYS, planForPrice } from '../src/billing/plans.js';
import { verifyStripeSignature } from '../src/billing/signature.js';
import { STRIPE_API_VERSION, StripeError, createStripe, encodeForm } from '../src/billing/stripe.js';
import { loadConfig } from '../src/config.js';

const KEYS = {
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_a',
};

describe('Stripe settings', () => {
  test('no Stripe settings: not ready, not selling, and no throw, in production too', () => {
    const dev = loadConfig({ NODE_ENV: 'test' });
    assert.equal(dev.stripe.ready, false);
    assert.equal(dev.selling, false);
    const prod = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), SUBSCRIPTIONS: 'on' });
    assert.equal(prod.stripe.ready, false);
    assert.equal(prod.selling, false);
  });

  test('three of the four settings is still not ready', () => {
    for (const missing of Object.keys(KEYS)) {
      const config = loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'on', ...KEYS, [missing]: '' });
      assert.equal(config.stripe.ready, false, `without ${missing}`);
      assert.equal(config.selling, false, `without ${missing}`);
    }
  });

  test('all four with the switch on is selling; with the switch off it is ready but not selling', () => {
    const on = loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'on', ...KEYS });
    assert.equal(on.stripe.ready, true);
    assert.equal(on.selling, true);
    assert.deepEqual(on.stripe.prices, { monthly: 'price_m', annual: 'price_a' });
    const off = loadConfig({ NODE_ENV: 'test', ...KEYS });
    assert.equal(off.stripe.ready, true);
    assert.equal(off.selling, false);
  });
});

describe('plans', () => {
  test('the prices people are shown', () => {
    assert.deepEqual(PLANS.monthly, { amountCents: 499, interval: 'month', price: '$4.99', per: 'month' });
    assert.deepEqual(PLANS.annual, { amountCents: 4999, interval: 'year', price: '$49.99', per: 'year' });
    assert.equal(TRIAL_DAYS, 7);
  });

  test('planForPrice maps the two configured ids and nothing else', () => {
    const config = loadConfig({ NODE_ENV: 'test', ...KEYS });
    assert.equal(planForPrice(config, 'price_m'), 'monthly');
    assert.equal(planForPrice(config, 'price_a'), 'annual');
    assert.equal(planForPrice(config, 'price_other'), null);
    assert.equal(planForPrice(config, ''), null);
    assert.equal(planForPrice(loadConfig({ NODE_ENV: 'test' }), ''), null, 'an empty setting matches nothing');
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const body = Buffer.from('{"id":"evt_1","type":"invoice.paid"}');
  const now = () => 1_800_000_000_000;
  const t = Math.floor(now() / 1000);
  const sign = (payload, key, at = t) => crypto.createHmac('sha256', key).update(`${at}.${payload}`).digest('hex');
  const header = (at, ...sigs) => [`t=${at}`, ...sigs.map((s) => `v1=${s}`)].join(',');

  test('accepts a payload signed with the secret', () => {
    assert.equal(verifyStripeSignature(body, header(t, sign(body, secret)), secret, { now }), true);
  });

  test('refuses a changed body, a wrong secret, a missing header and a header with no v1', () => {
    const good = header(t, sign(body, secret));
    assert.equal(verifyStripeSignature(Buffer.from(`${body} `), good, secret, { now }), false);
    assert.equal(verifyStripeSignature(body, header(t, sign(body, 'whsec_other')), secret, { now }), false);
    assert.equal(verifyStripeSignature(body, undefined, secret, { now }), false);
    assert.equal(verifyStripeSignature(body, '', secret, { now }), false);
    assert.equal(verifyStripeSignature(body, `t=${t},v0=${sign(body, secret)}`, secret, { now }), false);
    assert.equal(verifyStripeSignature(body, `v1=${sign(body, secret)}`, secret, { now }), false);
    assert.equal(verifyStripeSignature(body, good, '', { now }), false, 'an empty secret verifies nothing');
    assert.equal(verifyStripeSignature(body, header(t, 'not-hex'), secret, { now }), false);
  });

  test('refuses a timestamp six minutes old and one six minutes ahead', () => {
    const old = t - 6 * 60;
    const ahead = t + 6 * 60;
    assert.equal(verifyStripeSignature(body, header(old, sign(body, secret, old)), secret, { now }), false);
    assert.equal(verifyStripeSignature(body, header(ahead, sign(body, secret, ahead)), secret, { now }), false);
    const recent = t - 4 * 60;
    assert.equal(verifyStripeSignature(body, header(recent, sign(body, secret, recent)), secret, { now }), true);
  });

  test('accepts when the second of two v1 values is the right one', () => {
    assert.equal(verifyStripeSignature(body, header(t, sign(body, 'whsec_old'), sign(body, secret)), secret, { now }), true);
  });
});

describe('encodeForm', () => {
  test('nested keys, arrays and booleans', () => {
    assert.equal(decodeURIComponent(encodeForm({ a: { b: [1, 2] }, c: true })), 'a[b][0]=1&a[b][1]=2&c=true');
  });

  test('values are URL-encoded and undefined is left out', () => {
    assert.equal(encodeForm({ url: 'https://x.test/?a=1&b=2', gone: undefined, n: null }), 'url=https%3A%2F%2Fx.test%2F%3Fa%3D1%26b%3D2');
    assert.equal(encodeForm({ 'a[b]': 'c d' }), 'a%5Bb%5D=c%20d');
  });
});

describe('the Stripe client', () => {
  const config = loadConfig({ NODE_ENV: 'test', SUBSCRIPTIONS: 'on', ...KEYS });

  function stub(answers = []) {
    const requests = [];
    const fetch = async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? new URLSearchParams(init.body) : null });
      const next = answers.shift() || { status: 200, body: { id: 'obj_1' } };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: async () => JSON.stringify(next.body),
      };
    };
    return { fetch, requests };
  }

  test('createCheckoutSession posts the price, the customer and the account, with a trial only when asked', async () => {
    const { fetch, requests } = stub([{ status: 200, body: { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' } }]);
    const stripe = createStripe(config, { fetch });
    const session = await stripe.createCheckoutSession({
      customerId: 'cus_1', userId: 'user-1', priceId: 'price_m', trialDays: 7,
      successUrl: 'https://app.test/?checkout=success', cancelUrl: 'https://app.test/?checkout=cancelled',
    });
    assert.equal(session.url, 'https://checkout.stripe.test/cs_1');
    const [req] = requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(req.headers.Authorization, 'Bearer sk_test_abc123');
    assert.equal(req.headers['Stripe-Version'], STRIPE_API_VERSION);
    assert.equal(req.body.get('mode'), 'subscription');
    assert.equal(req.body.get('customer'), 'cus_1');
    assert.equal(req.body.get('client_reference_id'), 'user-1');
    assert.equal(req.body.get('line_items[0][price]'), 'price_m');
    assert.equal(req.body.get('line_items[0][quantity]'), '1');
    assert.equal(req.body.get('subscription_data[trial_period_days]'), '7');
    assert.equal(req.body.get('subscription_data[metadata][user_id]'), 'user-1');
    assert.equal(req.body.get('subscription_data[billing_mode][type]'), 'flexible');
    assert.equal(req.body.get('success_url'), 'https://app.test/?checkout=success');
    assert.equal(req.body.get('cancel_url'), 'https://app.test/?checkout=cancelled');
    // Stripe chooses the payment methods from the dashboard settings.
    assert.equal([...req.body.keys()].some((key) => key.startsWith('payment_method_types')), false);

    const second = stub();
    await createStripe(config, { fetch: second.fetch }).createCheckoutSession({
      customerId: 'cus_1', userId: 'user-1', priceId: 'price_a', trialDays: 0, successUrl: 'https://a.test', cancelUrl: 'https://b.test',
    });
    assert.equal(second.requests[0].body.has('subscription_data[trial_period_days]'), false);
  });

  test('createCustomer is safe to repeat for one account', async () => {
    const { fetch, requests } = stub([{ status: 200, body: { id: 'cus_9' } }]);
    const customer = await createStripe(config, { fetch }).createCustomer({ userId: 'user-9', email: 'a@example.com' });
    assert.equal(customer.id, 'cus_9');
    assert.equal(requests[0].url, 'https://api.stripe.com/v1/customers');
    assert.equal(requests[0].headers['Idempotency-Key'], 'customer-user-9');
    assert.equal(requests[0].body.get('metadata[user_id]'), 'user-9');
    assert.equal(requests[0].body.get('email'), 'a@example.com');
  });

  test("an error answer throws StripeError with Stripe's code, and never the secret key", async () => {
    const { fetch } = stub([{ status: 402, body: { error: { code: 'card_declined', message: 'Your card was declined.' } } }]);
    await assert.rejects(
      createStripe(config, { fetch }).retrievePrice('price_m'),
      (error) => {
        assert.ok(error instanceof StripeError);
        assert.equal(error.status, 402);
        assert.equal(error.code, 'card_declined');
        assert.equal(`${error.message} ${error.stack}`.includes('sk_test_abc123'), false);
        return true;
      }
    );
    const down = async () => {
      throw new Error('connect ECONNREFUSED with header Bearer sk_test_abc123');
    };
    await assert.rejects(createStripe(config, { fetch: down }).retrievePrice('price_m'), (error) => {
      assert.ok(error instanceof StripeError);
      assert.equal(`${error.message} ${error.stack}`.includes('sk_test_abc123'), false);
      return true;
    });
  });

  test('deleteCustomer treats "no such customer" as done', async () => {
    const { fetch, requests } = stub([{ status: 404, body: { error: { code: 'resource_missing', message: 'No such customer' } } }]);
    await createStripe(config, { fetch }).deleteCustomer('cus_gone');
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].url, 'https://api.stripe.com/v1/customers/cus_gone');
  });

  test('cancelSubscription treats one that is already gone as done; other failures still throw', async () => {
    const gone = stub([{ status: 404, body: { error: { code: 'resource_missing', message: 'No such subscription' } } }]);
    await createStripe(config, { fetch: gone.fetch }).cancelSubscription('sub_1');
    assert.equal(gone.requests[0].method, 'DELETE');
    assert.equal(gone.requests[0].url, 'https://api.stripe.com/v1/subscriptions/sub_1');
    const broken = stub([{ status: 500, body: { error: { message: 'oops' } } }]);
    await assert.rejects(createStripe(config, { fetch: broken.fetch }).cancelSubscription('sub_1'), StripeError);
  });

  test('a charge is traced to its subscription through the invoice it paid', async () => {
    const { fetch, requests } = stub([
      { status: 200, body: { id: 'ch_1', payment_intent: 'pi_1' } },
      { status: 200, body: { data: [{ id: 'inpay_1', invoice: 'in_1' }] } },
      { status: 200, body: { id: 'in_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_7' } } } },
    ]);
    assert.equal(await createStripe(config, { fetch }).subscriptionIdForCharge('ch_1'), 'sub_7');
    assert.equal(requests[0].url, 'https://api.stripe.com/v1/charges/ch_1');
    const list = new URL(requests[1].url);
    assert.equal(list.pathname, '/v1/invoice_payments');
    assert.equal(list.searchParams.get('payment[type]'), 'payment_intent');
    assert.equal(list.searchParams.get('payment[payment_intent]'), 'pi_1');
    assert.equal(requests[2].url, 'https://api.stripe.com/v1/invoices/in_1');

    const none = stub([{ status: 200, body: { id: 'ch_2', payment_intent: 'pi_2' } }, { status: 200, body: { data: [] } }]);
    assert.equal(await createStripe(config, { fetch: none.fetch }).subscriptionIdForCharge('ch_2'), null);
  });

  test('the cancel link names the subscription', async () => {
    const { fetch, requests } = stub([{ status: 200, body: { url: 'https://billing.stripe.test/p/1' } }]);
    await createStripe(config, { fetch }).createPortalSession({ customerId: 'cus_1', returnUrl: 'https://app.test/settings', cancelSubscriptionId: 'sub_1' });
    assert.equal(requests[0].url, 'https://api.stripe.com/v1/billing_portal/sessions');
    assert.equal(requests[0].body.get('customer'), 'cus_1');
    assert.equal(requests[0].body.get('return_url'), 'https://app.test/settings');
    assert.equal(requests[0].body.get('flow_data[type]'), 'subscription_cancel');
    assert.equal(requests[0].body.get('flow_data[subscription_cancel][subscription]'), 'sub_1');
  });

  test('without the keys every call is refused before anything is sent', async () => {
    const { fetch, requests } = stub();
    const stripe = createStripe(loadConfig({ NODE_ENV: 'test' }), { fetch });
    await assert.rejects(stripe.listSubscriptions('cus_1'), (error) => error instanceof StripeError && error.status === 503);
    assert.equal(requests.length, 0);
  });
});
