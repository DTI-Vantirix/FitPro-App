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

  add(method, pattern, handler) {
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
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
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
      return { handler: route.handler, params };
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

export function clientIp(req) {
  // Trust X-Forwarded-For only behind a proxy you control (TRUST_PROXY=true).
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
