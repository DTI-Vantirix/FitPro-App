// One thing at a time per key, inside this process.
//
// Billing work for one customer (ask Stripe, then write what it said) must not
// interleave with other work for the same customer: the answer written last has to be
// the one read last. A database lock could do that, but it would be held while waiting
// on Stripe, and a slow Stripe would then tie up connections and rows. So the order is
// kept here instead, with no connection in hand, and the database is only touched in
// short transactions after Stripe has answered.
//
// This is per process. With more than one API instance the order across instances is
// not guaranteed; the writes are still safe (each is a whole, consistent copy of what
// Stripe said) and the next sync puts any stale copy right.
const tails = new Map();

/** Runs `work` after everything queued earlier under `key` has finished, whether it failed or not. */
export function serialised(key, work) {
  const before = tails.get(key) || Promise.resolve();
  const run = before.then(work, work);
  // What the next one waits for never rejects, and the map does not grow for ever.
  const tail = run.then(
    () => {},
    () => {}
  );
  tails.set(key, tail);
  tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

export const customerKey = (customerId) => `stripe-customer:${customerId}`;
export const accountKey = (userId) => `billing-account:${userId}`;
