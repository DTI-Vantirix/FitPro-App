-- The trial reminder is marked as sent (trial_reminder_sent_at, migration 006) only once
-- the email has actually gone. While a sweep is working on a row it holds a claim instead,
-- so two sweeps do not mail the same person; a claim older than an hour is taken to be
-- left over from a sweep that died, and the row is picked up again.
alter table entitlements add column trial_reminder_claimed_at timestamptz;
