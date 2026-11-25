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
    subject: 'Your FitPro verification code',
    text: `Your FitPro code is ${code}. It expires in ${VERIFY_TTL_MIN} minutes.\n\nIf you didn't sign up, ignore this email.`,
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

    // FitPro is invite-only: no account without a code from the owner. The code
    // is only held here; it is claimed when the email is verified.
    const inviteCode = normalizeCode(ctx.body.invite_code);
    if (!inviteCode) throw new HttpError(400, 'Enter your invite code.');
    const [invite] = await ctx.db.query('select status from invite_codes where code = $1', [inviteCode]);
    if (!invite) throw new HttpError(400, 'That code is not recognised.');
    if (invite.status !== 'available') throw new HttpError(400, 'That code has already been used.');
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
    const ok = user && (await consumeCodeForUser(ctx.db, user.id, 'verify_email', ctx.body.otp_code));
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
      subject: 'Reset your FitPro password',
      text: `Reset your password here (valid for ${RESET_TTL_MIN} minutes):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    });
    return { ok: true, ...(ctx.config.exposeDevCodes ? { dev_token: token } : {}) };
  });

  router.add('POST', '/api/auth/reset-password', async (ctx) => {
    const next = readNewPassword(ctx.body.newPassword ?? ctx.body.new_password);
    const userId = await consumeLinkToken(ctx.db, 'reset_password', ctx.body.resetToken ?? ctx.body.reset_token);
    if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    await ctx.db.query(
      `update users set password_hash = $2, token_version = token_version + 1,
              email_verified_at = coalesce(email_verified_at, now()), updated_date = now()
        where id = $1 returning id`,
      [userId, await hashPassword(next)]
    );
    return { ok: true };
  });

  // What the sign-in screens can offer. Social sign-in and MFA come later.
  router.add('GET', '/api/auth/options', async () => ({
    name: 'FitPro',
    auth_config: { mfa_policy: 'off', providers: [] },
  }));
}
