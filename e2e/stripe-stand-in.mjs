// The browser tests' second server: the real API and website with SUBSCRIPTIONS on,
// and the fake Stripe from server/test/stripe-fake.js in place of the real client.
// Nothing here reaches Stripe, and no production file knows any of this exists.
//
// Three test-only addresses stand in for Stripe's own pages and dashboard:
//   GET  /__stripe/checkout?session=<id>   "the person paid": completes the session and
//                                          sends the browser back to the success address.
//                                          No webhook is sent, as when one is late.
//   GET  /__stripe/portal?id=<id>          Stripe's portal: confirms a cancellation if that
//                                          is what it was opened for, then sends them back.
//   POST /__stripe/control                 what the owner (or Stripe) does behind the scenes:
//                                          { action: 'refund' | 'state', email }, or
//                                          { action: 'cancel-next-checkout' }: the next person
//                                          to reach checkout presses Back instead of paying
import http from 'node:http';

export async function startSellingServer({ baseUrl, port }) {
  const { createApp } = await import('../server/src/app.js');
  const { loadConfig } = await import('../server/src/config.js');
  const { createDb } = await import('../server/src/db.js');
  const { loadRegistry } = await import('../server/src/entities/registry.js');
  const { TEST_STRIPE, createFakeStripe, signedEvent } = await import('../server/test/stripe-fake.js');

  const loaded = loadConfig();
  // Made-up Stripe ids; `selling` is what the switch plus the four settings give in production.
  const config = { ...loaded, subscriptions: true, stripe: TEST_STRIPE, selling: true };
  const db = createDb(config.databaseUrl);
  const registry = await loadRegistry(db);
  const fake = createFakeStripe({
    checkoutUrl: (session) => `${baseUrl}/__stripe/checkout?session=${encodeURIComponent(session.id)}`,
    portalUrl: (portal) => `${baseUrl}/__stripe/portal?id=${encodeURIComponent(portal.id)}`,
  });
  const handle = createApp({ db, config, registry, stripe: fake });
  let eventsSent = 0;
  let cancelNextCheckout = false;

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, to) => {
    res.writeHead(302, { Location: to });
    res.end();
  };
  const readJson = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  };
  const planOf = (priceId) => Object.entries(TEST_STRIPE.prices).find(([, id]) => id === priceId)?.[0] || null;

  // Delivers a signed event to this server's own webhook, as Stripe would.
  async function sendEvent(type, object) {
    const { body, header } = signedEvent(TEST_STRIPE.webhookSecret, { type, object });
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
      body,
    });
    eventsSent += 1;
    return res.status;
  }

  async function control(body) {
    if (body.action === 'cancel-next-checkout') {
      cancelNextCheckout = true;
      return { ok: true };
    }
    const email = String(body.email || '').toLowerCase();
    const [user] = await db.query('select id, stripe_customer_id from users where lower(email) = $1', [email]);
    const customer = [...fake.state.customers.values()].find((c) => c.email === email) || null;
    const customerId = customer?.id || null;
    const subscriptions = [...fake.state.subscriptions.values()].filter((s) => s.customer === customerId);

    if (body.action === 'state') {
      return {
        account: Boolean(user),
        customer: Boolean(customer),
        customersDeleted: [...fake.state.customers.values()].filter((c) => c.deleted).map((c) => c.email),
        sessions: [...fake.state.sessions.values()]
          .filter((s) => s.customer === customerId)
          .map((s) => ({ status: s.status, plan: planOf(s.price), trialDays: s.trialDays })),
        subscriptions: subscriptions.map((s) => ({ id: s.id, status: s.status, cancel_at_period_end: s.cancel_at_period_end })),
        eventsSent,
      };
    }
    if (body.action === 'refund') {
      // The owner refunds the charge in Stripe's dashboard; Stripe tells the server.
      const subscription = subscriptions.at(-1);
      if (!subscription) throw new Error(`no subscription for ${email}`);
      const charge = fake.chargeFor(subscription.id);
      return { webhook: await sendEvent('charge.refunded', { id: charge, customer: customerId, refunded: true }) };
    }
    throw new Error(`unknown control action ${body.action}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, baseUrl);
      if (url.pathname === '/__stripe/checkout' && req.method === 'GET') {
        const session = fake.state.sessions.get(url.searchParams.get('session'));
        if (!session || session.status !== 'open') return json(res, 404, { error: 'That checkout session is not open.' });
        if (cancelNextCheckout) {
          cancelNextCheckout = false;
          return redirect(res, session.cancel_url);
        }
        fake.completeCheckout(session.id);
        return redirect(res, session.success_url);
      }
      if (url.pathname === '/__stripe/portal' && req.method === 'GET') {
        const portal = fake.state.portals.find((p) => p.id === url.searchParams.get('id'));
        if (!portal) return json(res, 404, { error: 'No such portal session.' });
        // The portal is set to cancel at the end of the billing period (docs/launch-checklist.md).
        if (portal.cancel) fake.setSubscription(portal.cancel, { cancel_at_period_end: true });
        return redirect(res, portal.return_url);
      }
      if (url.pathname === '/__stripe/control' && req.method === 'POST') {
        return json(res, 200, await control(await readJson(req)));
      }
      return await handle(req, res);
    } catch (error) {
      console.error('[e2e] stand-in failed', error);
      if (!res.headersSent) json(res, 500, { error: String(error?.message || error) });
      else res.end();
      return undefined;
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`VantraRun API (subscriptions on, fake Stripe) listening on ${baseUrl}`);
  return server;
}
