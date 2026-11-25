import { requireUser } from './auth/users.js';
import { HttpError, rateLimiter, reply } from './lib/http.js';

// Error reports, kept in our own database (table client_errors). This is the
// whole of FitPro's "error monitoring": no third-party SDK sees anything.
//
//   POST /api/client-errors   the phone app reports a crash (signed-in users only)
//   recordServerError()       the API records its own unexpected (500) errors
//
// Admins read them through the adminClientErrors function (Settings on the website).
// A report holds a message, a stack trace and a few labels. Never a request body,
// a header or a token.

const LIMITS = { message: 500, stack: 4000, context: 200, platform: 20, app_version: 40 };

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Decides whether an error from the API itself is worth a row: the same error in the same
 * place is recorded once per `repeatMs`, and never more than `perMinute` rows a minute. */
export function createErrorGate({ perMinute = 20, repeatMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const lastSeen = new Map();
  let windowStart = 0;
  let inWindow = 0;
  return function shouldRecord(message, context) {
    const t = now();
    const key = `${context}\n${message}`;
    const seen = lastSeen.get(key);
    if (seen !== undefined && t - seen < repeatMs) return false;
    if (t - windowStart >= 60000) {
      windowStart = t;
      inWindow = 0;
    }
    if (inWindow >= perMinute) return false;
    inWindow += 1;
    lastSeen.set(key, t);
    if (lastSeen.size > 500) for (const [k, v] of lastSeen) if (t - v >= repeatMs) lastSeen.delete(k);
    return true;
  };
}
const serverGate = createErrorGate();

/** How many reports are kept. Older ones are dropped as new ones arrive. */
export const MAX_REPORTS = 2000;
let sinceTrim = 0;
function trim(db) {
  sinceTrim += 1;
  if (sinceTrim < 50) return;
  sinceTrim = 0;
  db.query(
    `delete from client_errors where id in (
       select id from client_errors order by created_date desc, id desc offset $1) returning id`,
    [MAX_REPORTS]
  ).catch(() => {});
}

const reportLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many error reports. Try again later.' });

async function insert(db, userId, fields) {
  await db.query(
    `insert into client_errors (user_id, platform, app_version, message, stack, context)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [userId, fields.platform, fields.app_version, fields.message, fields.stack, fields.context]
  );
}

export function registerErrorRoutes(router) {
  router.add('POST', '/api/client-errors', async (ctx) => {
    const user = requireUser(ctx);
    const message = text(ctx.body?.message, LIMITS.message);
    if (!message) throw new HttpError(400, 'An error report needs a message.');
    reportLimit(`errors:${user.id}`);
    await insert(ctx.db, user.id, {
      message,
      stack: text(ctx.body.stack, LIMITS.stack),
      context: text(ctx.body.context, LIMITS.context),
      // 'server' is reserved for the API's own reports.
      platform: ((p) => (p && p.toLowerCase() !== 'server' ? p : 'app'))(text(ctx.body.platform, LIMITS.platform)),
      app_version: text(ctx.body.app_version, LIMITS.app_version),
    });
    trim(ctx.db);
    return reply(201, { ok: true });
  });
}

/** Records an unexpected error from the API itself. Never throws and never waits on the caller.
 * `userId` is the signed-in person whose request hit the error, when there was one. */
export function recordServerError(db, error, { method, pathname, userId = null } = {}) {
  const label = `${method || ''} ${pathname || ''}`;
  if (!serverGate(String(error?.message || error), label)) return;
  trim(db);
  const fields = {
    message: text(String(error?.message || error), LIMITS.message) || 'Unknown error',
    stack: text(error?.stack, LIMITS.stack),
    // Method and path only: the query string and the body are left out on purpose.
    context: text(label, LIMITS.context),
    platform: 'server',
    app_version: null,
  };
  insert(db, userId, fields).catch(() => {
    // The database may be the thing that is failing; the error is already in the log.
  });
}
