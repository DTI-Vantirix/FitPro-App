// Minimal HTTP plumbing on node:http: a router, JSON helpers and a typed error.

export class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Handlers return a plain value for 200, or reply(status, body) for anything else.
export const REPLY = Symbol('reply');
export const reply = (status, body) => ({ [REPLY]: true, status, body });

export function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, 'That upload is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limitBytes = 5 * 1024 * 1024) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

// Patterns look like "/api/entities/:entity/:id". Routes match in the order added.
export class Router {
  constructor() {
    this.routes = [];
  }

  // `raw`: the handler reads the request body itself (a webhook checks a signature over
  // the exact bytes), so the app must not read or parse it first.
  add(method, pattern, handler, { raw = false } = {}) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((part) => {
        if (part.startsWith(':')) {
          keys.push(part.slice(1));
          return '([^/]+)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler, raw });
    return this;
  }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params, raw: route.raw };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

// Fixed-window in-memory rate limiter. Fine for one process; swap for Redis when
// the API runs on more than one instance.
export function rateLimiter({ windowMs, max, message = 'Too many attempts. Wait a few minutes and try again.' }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      }
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      throw new HttpError(429, message, { retryAfter: Math.ceil((entry.reset - now) / 1000) });
    }
  };
}

/** The entries of X-Forwarded-For as received, left to right. Empty when there is none. */
export function forwardedFor(req) {
  return String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * TRUSTED_PROXY_HOPS: how many proxies we control stand between the internet and this
 * process. null when unset; 0 when set to something that is not a whole number of 1 or
 * more (which trusts no entry: a typo must never make the header more trusted).
 */
export function trustedProxyHops(env = process.env) {
  const raw = String(env.TRUSTED_PROXY_HOPS ?? '').trim();
  if (!raw) return null;
  return /^[1-9]\d{0,2}$/.test(raw) ? Number(raw) : 0;
}

/**
 * The address a request is counted against (rate limits).
 *
 * X-Forwarded-For is only read behind a proxy you control (TRUST_PROXY=true). Each proxy
 * appends the address it received the request from, so the entries a client can forge
 * are on the left and the ones our own proxies wrote are on the right.
 *  - TRUSTED_PROXY_HOPS unset: the leftmost entry, as this server has always done. That
 *    is only right when the proxy replaces the header instead of appending to it.
 *  - TRUSTED_PROXY_HOPS=n: the nth entry from the right, the one written by the outermost
 *    proxy we trust. A list shorter than n did not come through those proxies, so the
 *    socket address is used.
 * The `requestInfo` function shows an admin what arrives, to find the right n on a host.
 */
export function clientIp(req, env = process.env) {
  const socket = req.socket?.remoteAddress || 'unknown';
  if (env.TRUST_PROXY !== 'true') return socket;
  const list = forwardedFor(req);
  const hops = trustedProxyHops(env);
  if (hops === null) return list[0] || socket;
  if (hops < 1 || list.length < hops) return socket;
  return list[list.length - hops];
}
