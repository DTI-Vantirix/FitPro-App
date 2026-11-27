// Deleting an account that may have a Stripe customer.
//
// Nobody is billed after their account is gone: the customer is deleted at Stripe first,
// which cancels its subscriptions at once, and only then the account. If Stripe cannot
// do it (unreachable, or the keys have been taken out), the account stays so the person
// can try again; deleting it would leave a subscription nobody can reach.
import { accountKey, serialised } from './queue.js';
import { StripeError } from './stripe.js';

/**
 * Deletes the user and, first, their Stripe customer. Throws StripeError when Stripe
 * could not be told; the account is then untouched.
 *
 * `user` only says who: the customer id is read again here, under the row's lock, because
 * the copy a request read when it was authenticated can be out of date (checkout in
 * another tab may have made a customer since). That lock is released before Stripe is
 * called. Checkout for the same account waits in the same queue, so within this process
 * no customer can appear in between; across processes the delete below only goes through
 * if the customer id is still the one that was dealt with, and otherwise starts again.
 */
export function deleteAccount({ db, stripe, config, user }) {
  return serialised(accountKey(user.id), async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const found = await db.tx((tx) => tx.query('select stripe_customer_id from users where id = $1 for update', [user.id]));
      if (!found.length) return; // already gone
      const customerId = found[0].stripe_customer_id || null;

      if (customerId) {
        if (!config.stripe?.ready) throw new StripeError(503, 'Stripe is not set up on this server.');
        // A checkout page still open in some tab must not take a payment for an account that is going.
        for (const open of await stripe.listOpenCheckoutSessions(customerId)) {
          try {
            await stripe.expireCheckoutSession(open.id);
          } catch (error) {
            // "No longer open" (it was paid or expired a moment ago) is fine: deleting the
            // customer below cancels whatever it started. Anything else stops the deletion.
            if (!(error instanceof StripeError) || error.status < 400 || error.status >= 500) throw error;
          }
        }
        await stripe.deleteCustomer(customerId);
      }

      let removed;
      try {
        removed = await db.query(
          'delete from users where id = $1 and stripe_customer_id is not distinct from $2 returning id',
          [user.id, customerId]
        );
      } catch (error) {
        // The customer is gone at Stripe but the account is not: forget the dead id, or the
        // person could neither subscribe again nor delete (both would ask Stripe about it).
        if (customerId) {
          await db
            .query('update users set stripe_customer_id = null, updated_date = now() where id = $1 and stripe_customer_id = $2 returning id', [user.id, customerId])
            .catch(() => {});
        }
        throw error;
      }
      if (removed.length) return;
      // The customer id changed while Stripe was being called (another server made one): go round again.
    }
    throw new StripeError(409, 'The account kept changing while it was being deleted.');
  });
}
