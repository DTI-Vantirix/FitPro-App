-- Sign-up requires an invite code. The code a person registers with is held
-- here until they verify their email, and only then claimed, so an abandoned
-- sign-up never uses a code up.
alter table users add column pending_invite_code text;
