-- Error reports from the phone app and from the API itself, kept in our own
-- database instead of a third-party monitoring service. A report belongs to the
-- person whose app sent it and is deleted with their account. Reports from the
-- API have no user.
create table client_errors (
  id           uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  user_id      uuid references users (id) on delete cascade,
  platform     text not null default 'app',
  app_version  text,
  message      text not null,
  stack        text,
  context      text
);
create index client_errors_created_idx on client_errors (created_date desc);
create index client_errors_user_idx on client_errors (user_id);
