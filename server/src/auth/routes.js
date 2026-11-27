import { StripeError } from '../billing/stripe.js';
import { claimInvite, normalizeCode } from '../functions/inviteAccess.js';
import { HttpError, clientIp, rateLimiter } from '../lib/http.js';
import { sendMail } from '../lib/mail.js';
import { burnPasswordCheck, hashPassword, longToken, sixDigitCode, verifyPassword } from './crypto.js';
import {
  consumeCodeForUser,
  consumeLinkToken,
  issueAccessToken,
  publicUser,
  requireUser,
  storeCode,
} from './users.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TTL_MIN = 15;
const RESET_TTL_MIN = 60;

const loginLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
// The address a request claims to come from can be forged behind some proxies, so wrong
// passwords are also counted per account, whatever address they arrive from.
const loginEmailLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 25 });
const codeLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
// Per email address: stops one inbox being flooded. Per IP: stops mass sign-ups,
// but loose enough for many people on one network (a gym's Wi-Fi).
const mailLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 6, message: 'Too many emails requested. Try again later.' });
const signupLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 30, message: 'Too many sign-ups from this network. Try again later.' });

function readEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  return email;
}

function readNewPassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  return password;
}

const findByEmail = async (db, email) =>
  (await db.query('select * from users where lower(email) = lower($1)', [email]))[0] || null;

async function sendVerifyCode(ctx, user) {
  const code = sixDigitCode();
  await storeCode(ctx.db, user.id, 'verify_email', code, VERIFY_TTL_MIN);
  await sendMail(ctx.config, {
    to: user.email,
    subject: 'Your VantraRun verification code',
    text: `Your VantraRun code is ${code}. It expires in ${VERIFY_TTL_MIN} minutes.\n\nIf you didn't sign up, ignore this email.`,
  });
  return ctx.config.exposeDevCodes ? { dev_code: code } : {};
}

function signedIn(ctx, user) {
  return { access_token: issueAccessToken(ctx.config, user), user: publicUser(user) };
}

export function registerAuthRoutes(router) {
  router.add('POST', '/api/auth/register', async (ctx) => {
    const email = readEmail(ctx.body.email);
    const password = readNewPassword(ctx.body.password);
    const fullName = ctx.body.full_name ? String(ctx.body.full_name).trim().slice(0, 120) : null;
    signupLimit(`signup:${clientIp(ctx.req)}`);

    // Invite-only (SUBSCRIPTIONS off): no account without a code from the owner.
    // With subscriptions on the code is optional: an account made without one is
    // verified with no access and meets the paywall. A code that is given is
    // checked the same way either way, and only held here; it is claimed when the
    // email is verified.
    const inviteCode = normalizeCode(ctx.body.invite_code) || null;
    if (!inviteCode && !ctx.config.subscriptions) throw new HttpError(400, 'Enter your invite code.');
    if (inviteCode) {
      const [invite] = await ctx.db.query('select status from invite_codes where code = $1', [inviteCode]);
      if (!invite) throw new HttpError(400, 'That code is not recognised.');
      if (invite.status !== 'available') throw new HttpError(400, 'That code has already been used.');
    }
    mailLimit(`mail:${email}`);

    const existing = await findByEmail(ctx.db, email);
    if (existing?.email_verified_at) {
      throw new HttpError(409, 'An account with that email already exists. Log in instead.');
    }
    const hash = await hashPassword(password);
    let user;
    if (existing) {
      // Unfinished sign-up: let them start over with a new password and code.
      [user] = await ctx.db.query(
        `update users set password_hash = $2, full_name = coalesce($3, full_name),
                pending_invite_code = $4, updated_date = now()
          where id = $1 returning *`,
        [existing.id, hash, fullName, inviteCode]
      );
    } else {
      [user] = await ctx.db.query(
        `insert into users (email, password_hash, full_name, pending_invite_code)
         values ($1, $2, $3, $4) returning *`,
        [email, hash, fullName, inviteCode]
      );
    }
    return { ok: true, ...(await sendVerifyCode(ctx, user)) };
  });

  router.add('POST', '/api/auth/verify-otp', async (ctx) => {
    const email = readEmail(ctx.body.email);
    codeLimit(`code:${email}`);
    const user = await findByEmail(ctx.db, email);
    // Anyone can sign up again with an address that is not verified yet, which replaces
    // the password and mails the address a new code. The owner of the address must not
    // then confirm somebody else's password by typing that code, so the password chosen
    // at sign-up comes back with the code and has to match. It is checked first: a
    // mismatch leaves the code unused and answers exactly like a wrong code.
    // Builds of the phone app from before this check send no password. That is still
    // accepted while sign-up needs an invite code, and required once sign-up is open.
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    let passwordOk = !ctx.config.subscriptions;
    if (password) {
      passwordOk = user?.password_hash
        ? await verifyPassword(password, user.password_hash)
        : await burnPasswordCheck(password);
    }
    const ok = passwordOk && user && (await consumeCodeForUser(ctx.db, user.id, 'verify_email', ctx.body.otp_code));
    if (!ok) throw new HttpError(400, 'That code is wrong or has expired.');
    const verified = await ctx.db.tx(async (tx) => {
      // The code they registered with is claimed here, together with the
      // verification, so the account never ends up verified without access.
      if (user.pending_invite_code && !(await claimInvite(tx, user, user.pending_invite_code))) {
        throw new HttpError(409, 'That invite code was just used by someone else. Ask for a new one.');
      }
      const [row] = await tx.query(
        `update users set email_verified_at = coalesce(email_verified_at, now()),
                pending_invite_code = null, updated_date = now()
          where id = $1 returning *`,
        [user.id]
      );
      return row;
    });
    return signedIn(ctx, verified);
  });

  router.add('POST', '/api/auth/resend-otp', async (ctx) => {
    const email = readEmail(ctx.body.email);
    mailLimit(`mail:${email}`);
    const user = await findByEmail(ctx.db, email);
    if (!user || user.email_verified_at) return { ok: true };
    return { ok: true, ...(await sendVerifyCode(ctx, user)) };
  });

  router.add('POST', '/api/auth/login', async (ctx) => {
    const email = readEmail(ctx.body.email);
    loginLimit(`login:${clientIp(ctx.req)}:${email}`);
    loginEmailLimit(`login-email:${email}`);
    const user = await findByEmail(ctx.db, email);
    const ok = user?.password_hash
      ? await verifyPassword(String(ctx.body.password || ''), user.password_hash)
      : await burnPasswordCheck(ctx.body.password);
    if (!ok) throw new HttpError(401, 'Invalid email or password.');
    if (!user.email_verified_at) {
      const dev = await sendVerifyCode(ctx, user);
      throw new HttpError(403, 'Verify your email first. We just sent you a new code.', {
        needs_verification: true,
        ...dev,
      });
    }
    return signedIn(ctx, user);
  });

  router.add('POST', '/api/auth/logout', async () => ({ ok: true }));

  router.add('GET', '/api/auth/me', async (ctx) => publicUser(requireUser(ctx)));

  // Only the fields a user may set on themselves. role is never writable here.
  router.add('PUT', '/api/auth/me', async (ctx) => {
    const user = requireUser(ctx);
    const sets = [];
    const params = [user.id];
    if ('full_name' in ctx.body) {
      params.push(ctx.body.full_name ? String(ctx.body.full_name).trim().slice(0, 120) : null);
      sets.push(`full_name = $${params.length}`);
    }
    if ('consent_version' in ctx.body) {
      params.push(ctx.body.consent_version ? String(ctx.body.consent_version).slice(0, 40) : null);
      sets.push(`consent_version = $${params.length}`);
    }
    if ('consent_accepted_at' in ctx.body) {
      const value = ctx.body.consent_accepted_at ? new Date(ctx.body.consent_accepted_at) : null;
      if (value && Number.isNaN(value.getTime())) throw new HttpError(400, 'consent_accepted_at must be a date.');
      params.push(value ? value.toISOString() : null);
      sets.push(`consent_accepted_at = $${params.length}`);
    }
    if (!sets.length) return publicUser(user);
    const [updated] = await ctx.db.query(
      `update users set ${sets.join(', ')}, updated_date = now() where id = $1 returning *`,
      params
    );
    return publicUser(updated);
  });

  // Account deletion (required by both app stores). Removes the user and, through
  // the foreign keys, every record they own.
  router.add('DELETE', '/api/auth/me', async (ctx) => {
    const user = requireUser(ctx);
    if (user.password_hash && !(await verifyPassword(String(ctx.body.password || ''), user.password_hash))) {
      throw new HttpError(401, 'Enter your current password to delete your account.');
    }
    // Nobody is billed after their account is gone: the customer is deleted at Stripe
    // first, which cancels its subscriptions at once. If that cannot be done (Stripe is
    // unreachable, or the keys have been taken out), the account stays so the person can
    // try again; deleting it would leave a subscription nobody can reach.
    if (user.stripe_customer_id) {
      try {
        if (!ctx.config.stripe?.ready) throw new StripeError(503, 'Stripe is not set up on this server.');
        await ctx.stripe.deleteCustomer(user.stripe_customer_id);
      } catch (error) {
        if (!(error instanceof StripeError)) throw error;
        console.error(`[billing] account deletion stopped: ${error.message}`);
        throw new HttpError(502, 'We could not cancel your subscription, so your account was not deleted. Try again in a few minutes, or email info@dtisys.com.');
      }
    }
    await ctx.db.query('delete from users where id = $1 returning id', [user.id]);
    return { ok: true, deleted: true };
  });

  router.add('POST', '/api/auth/change-password', async (ctx) => {
    const user = requireUser(ctx);
    const current = ctx.body.currentPassword ?? ctx.body.current_password;
    const next = readNewPassword(ctx.body.newPassword ?? ctx.body.new_password);
    loginLimit(`pw:${user.id}`);
    if (!(await verifyPassword(String(current || ''), user.password_hash))) {
      throw new HttpError(400, 'Your current password is wrong.');
    }
    // Bumping token_version signs out every other device.
    const [updated] = await ctx.db.query(
      `update users set password_hash = $2, token_version = token_version + 1, updated_date = now()
        where id = $1 returning *`,
      [user.id, await hashPassword(next)]
    );
    return { ok: true, ...signedIn(ctx, updated) };
  });

  router.add('POST', '/api/auth/reset-password-request', async (ctx) => {
    const email = readEmail(ctx.body.email);
    mailLimit(`mail:${email}`);
    const user = await findByEmail(ctx.db, email);
    // Same answer whether or not the account exists.
    if (!user) return { ok: true };
    const token = longToken();
    await storeCode(ctx.db, user.id, 'reset_password', token, RESET_TTL_MIN);
    const link = `${ctx.config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail(ctx.config, {
      to: user.email,
      subject: 'Reset your VantraRun password',
      text: `Reset your password here (valid for ${RESET_TTL_MIN} minutes):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    });
    return { ok: true, ...(ctx.config.exposeDevCodes ? { dev_token: token } : {}) };
  });

  router.add('POST', '/api/auth/reset-password', async (ctx) => {
    const next = readNewPassword(ctx.body.newPassword ?? ctx.body.new_password);
    const userId = await consumeLinkToken(ctx.db, 'reset_password', ctx.body.resetToken ?? ctx.body.reset_token);
    if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    // Opening the reset link proves the email, so it verifies the account, except
    // for a sign-up that hasn't claimed its invite code yet: that one still has
    // to go through verify-otp, which is where the code is claimed.
    await ctx.db.query(
      `update users set password_hash = $2, token_version = token_version + 1,
              email_verified_at = case when pending_invite_code is null
                                       then coalesce(email_verified_at, now())
                                       else email_verified_at end,
              updated_date = now()
        where id = $1 returning id`,
      [userId, await hashPassword(next)]
    );
    return { ok: true };
  });

  // What the sign-in screens can offer. Social sign-in and MFA come later.
  // `subscriptions` tells the sign-up form whether an invite code is still required.
  router.add('GET', '/api/auth/options', async (ctx) => ({
    name: 'VantraRun',
    auth_config: { mfa_policy: 'off', providers: [] },
    subscriptions: Boolean(ctx.config.subscriptions),
  }));
}
