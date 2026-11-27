-- Who may use the product, and why. One row per source of access per account:
-- an invite code, a free pass from the owner, and later a Stripe or an Apple
-- subscription. src/access.js is the only code that decides from these rows.
--
-- Admins need no row: they pass by role.
create table entitlements (
  id                   uuid primary key default gen_random_uuid(),
  created_date         timestamptz not null default now(),
  updated_date         timestamptz not null default now(),
  user_id              uuid not null references users (id) on delete cascade,
  source               text not null check (source in ('stripe', 'apple', 'invite', 'admin')),
  status               text not null check (status in ('trial', 'active', 'grace', 'expired', 'revoked')),
  -- 'monthly' or 'annual'; empty for free passes
  plan                 text,
  -- end of the period paid for; empty for free passes
  expires_at           timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Stripe subscription id or Apple original transaction id
  external_id          text,
  -- the admin who granted it, or the invite code used
  granted_by           text,
  note                 text,
  -- Only a free pass may be open-ended. A paid row always says when its period ends.
  constraint entitlements_paid_has_end check (source in ('invite', 'admin') or expires_at is not null)
);
create index entitlements_user_idx on entitlements (user_id);
-- One row per subscription at the payment provider.
create unique index entitlements_external_key on entitlements (source, external_id) where external_id is not null;
-- One invite row and one admin-grant row per account at most.
create unique index entitlements_free_key on entitlements (user_id, source) where source in ('invite', 'admin');

-- An account gets one free trial, whichever store it starts in.
alter table users add column trial_used_at timestamptz;

-- Invite codes already redeemed carry over, so every tester keeps access.
insert into entitlements (user_id, source, status, granted_by, created_date)
select user_id, 'invite', 'active', code, coalesce(granted_at, created_date)
  from access_grants
on conflict (user_id, source) where source in ('invite', 'admin') do nothing;
