-- Subscriptions bought on the website (Stripe). Nothing about a card is stored:
-- only the ids Stripe gives a customer, a subscription and a webhook event.

-- One Stripe customer per account. Not in entities/User.json: that file lists what a
-- client may write, and this is not one.
alter table users add column stripe_customer_id text;
create unique index users_stripe_customer_key on users (stripe_customer_id) where stripe_customer_id is not null;

-- Webhook events already handled, so a repeat delivery changes nothing. Rows older
-- than 30 days are removed as new ones arrive (Stripe stops retrying after 3 days).
create table stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
create index stripe_events_received_idx on stripe_events (received_at);

-- When the "your trial ends in two days" email was sent, so it is sent once.
alter table entitlements add column trial_reminder_sent_at timestamptz;
-- Who took a free pass away, and when.
alter table entitlements add column revoked_by text;
alter table entitlements add column revoked_at timestamptz;
