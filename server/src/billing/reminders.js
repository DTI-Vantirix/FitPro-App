// The email two days before a free trial ends: the date, the amount and how to
// cancel. Ours, not Stripe's: Stripe's reminder goes out seven days before a trial
// ends, which for a seven-day trial is the moment it starts (docs/decisions.md).
// A sweep run every hour from src/index.js; it does not depend on a webhook arriving.
import { sendMail } from '../lib/mail.js';
import { PLANS } from './plans.js';

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

/**
 * Sends the reminder to every trial that ends within the next 48 hours and has not had
 * one. A row is claimed in the same statement that picks it, so two sweeps (or two
 * servers) never mail the same person twice. If the mail provider refuses the message,
 * or cannot be reached, the claim is cleared and the next sweep tries again.
 * Returns how many were sent.
 */
export async function sendTrialReminders({ db, config, now = new Date(), send = sendMail }) {
  const due = await db.query(
    `update entitlements e
        set trial_reminder_sent_at = $1
       from users u
      where u.id = e.user_id
        and e.id in (
          select id from entitlements
           where source = 'stripe' and status = 'trial' and not cancel_at_period_end
             and trial_reminder_sent_at is null
             and plan in ('monthly', 'annual')
             and expires_at > $1 and expires_at <= $1::timestamptz + make_interval(hours => $2::int)
           for update skip locked)
      returning e.id, e.plan, e.expires_at, u.email`,
    [now.toISOString(), WINDOW_HOURS]
  );
  let sent = 0;
  for (const row of due) {
    let refused = false;
    try {
      const result = await send(config, reminderMail(config, row));
      // With no mail key the message is printed, as every email is locally; that is not a refusal.
      refused = Boolean(config.mail?.resendApiKey) && !result?.delivered;
    } catch (error) {
      console.error(`[billing] trial reminder could not be sent: ${error?.message || error}`);
      refused = true;
    }
    if (refused) {
      await db.query('update entitlements set trial_reminder_sent_at = null where id = $1 returning id', [row.id]);
    } else {
      sent += 1;
    }
  }
  return sent;
}

/** Runs the sweep now and then every hour. Never throws; never keeps the process alive. */
export function startTrialReminders({ db, config, everyMs = 60 * 60 * 1000, log = console }) {
  const run = () =>
    sendTrialReminders({ db, config })
      .then((sent) => {
        if (sent) log.log(`[billing] sent ${sent} trial reminder(s)`);
      })
      .catch((error) => log.error('[billing] trial reminder sweep failed', error));
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return timer;
}
