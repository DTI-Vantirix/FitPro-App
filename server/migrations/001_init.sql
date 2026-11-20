-- FitPro initial schema.
--
-- One table per former Base44 entity. Every entity table carries the same
-- bookkeeping columns Base44 added implicitly:
--   id            uuid primary key
--   created_date  when the record was created
--   updated_date  when it last changed
--   created_by_id the user who owns it (deleting the user deletes their records)
--   created_by    that user's email at creation time
--
-- Column names match the old entity field names exactly, so the web app's
-- records keep the same shape.

create table users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  full_name           text,
  role                text not null default 'user' check (role in ('admin', 'user')),
  password_hash       text,
  email_verified_at   timestamptz,
  token_version       integer not null default 0,
  consent_version     text,
  consent_accepted_at timestamptz,
  created_date        timestamptz not null default now(),
  updated_date        timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

-- One-time codes: email verification and password reset. Only a hash is stored.
create table auth_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  purpose      text not null check (purpose in ('verify_email', 'reset_password')),
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  used_at      timestamptz,
  created_date timestamptz not null default now()
);
create index auth_codes_lookup on auth_codes (user_id, purpose) where used_at is null;

-- ---------------------------------------------------------------- training

create table profiles (
  id                 uuid primary key default gen_random_uuid(),
  created_date       timestamptz not null default now(),
  updated_date       timestamptz not null default now(),
  created_by_id      uuid references users (id) on delete cascade,
  created_by         text,
  age                double precision,
  sex                text check (sex in ('male', 'female')),
  height_in          double precision,
  weight_lb          double precision,
  hr_max             double precision,
  vo2max             double precision,
  threshold_sec      double precision,
  auto_threshold_sec double precision
);
create index profiles_owner on profiles (created_by_id, created_date desc);

create table pace_zones (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete cascade,
  created_by    text,
  name          text not null,
  zone_number   double precision,
  intensity     text,
  hr_min_pct    double precision,
  hr_max_pct    double precision,
  fast_sec      double precision not null,
  slow_sec      double precision not null,
  color         text,
  purpose       text,
  feel          text,
  sort_order    double precision
);
create index pace_zones_owner on pace_zones (created_by_id);

create table routes (
  id               uuid primary key default gen_random_uuid(),
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now(),
  created_by_id    uuid references users (id) on delete cascade,
  created_by       text,
  name             text not null,
  distance_mi      double precision,
  points           jsonb,
  path             jsonb,
  target_zone_id   uuid references pace_zones (id) on delete set null,
  target_zone_name text,
  gym_stop         text,
  gym_point        jsonb,
  notes            text
);
create index routes_owner on routes (created_by_id, created_date desc);

create table runs (
  id               uuid primary key default gen_random_uuid(),
  created_date     timestamptz not null default now(),
  updated_date     timestamptz not null default now(),
  created_by_id    uuid references users (id) on delete cascade,
  created_by       text,
  route_id         uuid references routes (id) on delete set null,
  route_name       text,
  distance_mi      double precision not null,
  duration_sec     double precision not null,
  avg_pace_sec     double precision,
  started_at       timestamptz,
  target_zone_name text,
  target_fast_sec  double precision,
  target_slow_sec  double precision,
  in_zone_pct      double precision,
  splits           jsonb,
  points           jsonb,
  legs             jsonb,
  avg_hr           double precision,
  max_hr           double precision,
  hr_device        text,
  gym_name         text,
  gym_point        jsonb,
  source           text,
  external_id      text,
  notes            text
);
create index runs_owner on runs (created_by_id, started_at desc);
-- Health-sync dedupe: one record per user per (source, external_id).
create unique index runs_external_key on runs (created_by_id, source, external_id) where external_id is not null;

create table workouts (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete cascade,
  created_by    text,
  name          text not null,
  performed_at  timestamptz,
  duration_min  double precision,
  total_volume  double precision,
  set_count     double precision,
  exercises     jsonb,
  notes         text,
  source        text,
  external_id   text
);
create index workouts_owner on workouts (created_by_id, performed_at desc);
create unique index workouts_external_key on workouts (created_by_id, source, external_id) where external_id is not null;

-- ---------------------------------------------------------------- social

create table social_profiles (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete cascade,
  created_by    text,
  handle        text not null,
  display_name  text,
  bio           text,
  avatar_url    text,
  visibility    text default 'private' check (visibility in ('public', 'private'))
);
create unique index social_profiles_handle_key on social_profiles (lower(handle));
create index social_profiles_owner on social_profiles (created_by_id);

create table connections (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete cascade,
  created_by    text,
  from_user_id  uuid not null references users (id) on delete cascade,
  to_user_id    uuid not null references users (id) on delete cascade,
  from_handle   text,
  from_name     text,
  to_handle     text,
  to_name       text,
  status        text default 'pending' check (status in ('pending', 'accepted', 'declined'))
);
create index connections_from on connections (from_user_id);
create index connections_to on connections (to_user_id);

create table posts (
  id              uuid primary key default gen_random_uuid(),
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now(),
  created_by_id   uuid references users (id) on delete cascade,
  created_by      text,
  kind            text not null default 'run' check (kind in ('run', 'workout')),
  ref_id          uuid,
  title           text,
  caption         text,
  distance_mi     double precision,
  duration_sec    double precision,
  avg_pace_sec    double precision,
  zone_name       text,
  in_zone_pct     double precision,
  volume_lb       double precision,
  set_count       double precision,
  route_points    jsonb,
  background_type text default 'none' check (background_type in ('none', 'photo', 'video')),
  background_url  text,
  visibility      text default 'friends' check (visibility in ('public', 'friends', 'private')),
  author_handle   text,
  author_name     text,
  author_avatar   text,
  shared_to       jsonb
);
create index posts_owner on posts (created_by_id, created_date desc);
create index posts_public on posts (created_date desc) where visibility = 'public';

create table challenges (
  id             uuid primary key default gen_random_uuid(),
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now(),
  created_by_id  uuid references users (id) on delete cascade,
  created_by     text,
  name           text not null,
  description    text,
  metric         text not null default 'distance' check (metric in ('distance', 'runs', 'workouts')),
  target_value   double precision not null,
  month          text not null,
  start_date     timestamptz,
  end_date       timestamptz,
  creator_handle text
);

create table challenge_members (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete cascade,
  created_by    text,
  challenge_id  uuid not null references challenges (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  handle        text,
  name          text
);
create unique index challenge_members_key on challenge_members (challenge_id, user_id);

-- ---------------------------------------------------------------- beta access

create table invite_codes (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete set null,
  created_by    text,
  code          text not null unique,
  status        text not null default 'available' check (status in ('available', 'used', 'revoked')),
  note          text,
  used_by_id    uuid references users (id) on delete set null,
  used_by_email text,
  used_at       timestamptz
);

create table access_grants (
  id            uuid primary key default gen_random_uuid(),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by_id uuid references users (id) on delete set null,
  created_by    text,
  user_id       uuid not null unique references users (id) on delete cascade,
  email         text,
  code          text,
  granted_at    timestamptz
);
