// The two plans and what they cost. The one place on the server that knows the
// prices people are shown (the website's copy is web/src/lib/plans.js). The
// amounts are checked against the prices configured at Stripe before anyone is
// sent to checkout (src/functions/subscription.js).
export const PLANS = {
  monthly: { amountCents: 499, interval: 'month', price: '$4.99', per: 'month' },
  annual: { amountCents: 4999, interval: 'year', price: '$49.99', per: 'year' },
};

// One free trial per account, on either plan.
export const TRIAL_DAYS = 7;

/** Which plan a Stripe price id is, or null when it is neither of the two configured. */
export function planForPrice(config, priceId) {
  if (!priceId) return null;
  const prices = config?.stripe?.prices || {};
  if (priceId === prices.monthly) return 'monthly';
  if (priceId === prices.annual) return 'annual';
  return null;
}
