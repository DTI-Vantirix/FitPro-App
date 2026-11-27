// The email two days before a free trial ends: the date, the amount and how to
// cancel. Ours, not Stripe's: Stripe's reminder goes out seven days before a trial
// ends, which for a seven-day trial is the moment it starts (docs/decisions.md).
// A sweep run every hour from src/index.js; it does not depend on a webhook arriving.
// This file also starts billing's other background job, the daily check (at the end).
import { sendMail } from '../lib/mail.js';
import { PLANS } from './plans.js';
import { syncCustomer, syncOverdue } from './sync.js';

const WINDOW_HOURS = 48;
const SUPPORT_EMAIL = 'info@dtisys.com';

/**
 * "December 4, 2026". The service is sold in the United States only, and the day is the
 * one on a Pacific-time calendar: the charge falls on that day or, further east, shortly
 * after midnight on the next. Nobody in the contiguous states is charged before the day named.
 */
export function formatDay(value) {
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

function reminderMail(config, row) {
  const plan = PLANS[row.plan];
  const day = formatDay(row.expires_at);
  return {
    to: row.email,
    subject: `Your VantraRun free trial ends on ${day}`,
    text:
      `Your VantraRun free trial ends on ${day}. On that day your card will be charged ${plan.price} for the ${row.plan} plan, and it renews every ${plan.per} at that price until you cancel.\n\n` +
      `To cancel before you are charged, sign in at ${config.appUrl}/settings and choose "Cancel subscription". You keep access until the trial ends and pay nothing.\n\n` +
      `Questions: ${SUPPORT_EMAIL}`,
  };
}

const CLAIM_MINUTES = 60;

/**
 * Sends the reminder to every trial that ends within the next 48 hours and has not had
 * one. Returns how many were sent. For each such row:
 *
 *  1. it is claimed (`trial_reminder_claimed_at`), in the statement that picks it, so two
 *     sweeps or two servers do not work on the same person. A claim older than an hour is
 *     taken to be left by a sweep that died, and the row is picked up again;
 *  2. Stripe is asked about the customer, with nothing held in the database, and our
 *     copy is brought up to date. Someone who cancelled a minute ago, whose notice has not
 *     arrived, must not be told they are about to be charged;
 *  3. if the trial is still running, still due to be charged and still ends within the two
 *     days, the email is sent, with the date Stripe has now;
 *  4. only then is it marked as sent (`trial_reminder_sent_at`).
 *
 * If Stripe cannot be asked, or the mail provider refuses or cannot be reached, the claim
 * is given back and the next sweep tries again. (A process that dies between 3 and 4
 * leads to a second email an hour later: rare, and better than a missed reminder.)
 */
export async function sendTrialReminders({ db, config, stripe = null, now = new Date(), send = sendMail }) {
  const at = now.toISOString();
  const claimed = await db.query(
    `update entitlements e
        set trial_reminder_claimed_at = $1
       from users u
      where u.id = e.user_id
        and e.id in (
          select id from entitlements
           where source = 'stripe' and status = 'trial' and not cancel_at_period_end
             and trial_reminder_sent_at is null
             and (trial_reminder_claimed_at is null
                  or trial_reminder_claimed_at < $1::timestamptz - make_interval(mins => $3::int))
             and plan in ('monthly', 'annual')
             and expires_at > $1 and expires_at <= $1::timestamptz + make_interval(hours => $2::int)
           for update skip locked)
      returning e.id, u.stripe_customer_id as customer`,
    [at, WINDOW_HOURS, CLAIM_MINUTES]
  );
  const giveBack = (id) =>
    db.query('update entitlements set trial_reminder_claimed_at = null where id = $1 and trial_reminder_sent_at is null returning id', [id]);

  let sent = 0;
  for (const { id, customer } of claimed) {
    try {
      // Outside any transaction. Without Stripe set up (or in a test that passes none) the
      // row is taken as it stands.
      if (stripe && config.stripe?.ready && customer) await syncCustomer(db, stripe, config, customer);
      const [row] = await db.query(
        `select e.id, e.plan, e.expires_at, u.email
           from entitlements e join users u on u.id = e.user_id
          where e.id = $1 and e.status = 'trial' and not e.cancel_at_period_end
            and e.trial_reminder_sent_at is null and e.plan in ('monthly', 'annual')
            and e.expires_at > $2 and e.expires_at <= $2::timestamptz + make_interval(hours => $3::int)`,
        [id, at, WINDOW_HOURS]
      );
      if (!row) {
        // No longer due: cancelled, ended, or moved out of the two days.
        await giveBack(id);
        continue;
      }
      const result = await send(config, reminderMail(config, row));
      // With no mail key the message is printed, as every email is locally; that is not a refusal.
      if (config.mail?.resendApiKey && !result?.delivered) {
        await giveBack(id);
        continue;
      }
      await db.query('update entitlements set trial_reminder_sent_at = $2 where id = $1 returning id', [id, at]);
      sent += 1;
    } catch (error) {
      console.error(`[billing] trial reminder could not be sent: ${error?.message || error}`);
      await giveBack(id).catch(() => {});
    }
  }
  return sent;
}

/**
 * Runs `work` now and then every `everyMs`. A run that fails is logged and the next one
 * still happens; the timer never keeps the process alive.
 */
export function repeat(name, everyMs, work, log = console) {
  const run = () => Promise.resolve().then(work).catch((error) => log.error(`[billing] ${name} failed`, error));
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return timer;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The two background jobs of billing, started from src/index.js when Stripe is set up:
 * the trial reminder every hour, and once a day a check of every subscription whose
 * period has passed without word from Stripe (sync.js, syncOverdue).
 */
export function startBillingSweeps({ db, config, stripe, log = console }) {
  return [
    repeat('trial reminder sweep', HOUR_MS, async () => {
      const sent = await sendTrialReminders({ db, config, stripe });
      if (sent) log.log(`[billing] sent ${sent} trial reminder(s)`);
    }, log),
    repeat('daily subscription check', 24 * HOUR_MS, async () => {
      const { checked, failed } = await syncOverdue({ db, stripe, config });
      if (checked || failed) log.log(`[billing] daily check: ${checked} overdue subscription(s) checked with Stripe, ${failed} could not be`);
    }, log),
  ];
}
