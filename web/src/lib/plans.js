// What a subscription costs and its terms, as the website words them. The one place
// in the web app that knows the prices (the server's copy is server/src/billing/plans.js,
// which also checks them against the prices set up at Stripe).
export const PLANS = [
  { id: 'annual', name: 'Annual', price: '$49.99', per: 'year' },
  { id: 'monthly', name: 'Monthly', price: '$4.99', per: 'month' },
];

export const planById = (id) => PLANS.find((plan) => plan.id === id) || null;

// Twelve months at $4.99 is $59.88; the annual plan is $49.99.
export const ANNUAL_SAVING = '$9.89';
export const TRIAL_DAYS = 7;
// An annual payment is refunded in full on request within this many days of the charge.
export const REFUND_DAYS = 14;
export const SUPPORT_EMAIL = 'info@dtisys.com';

// "December 4, 2026", in the reader's own language and time zone.
export const longDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
