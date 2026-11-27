import fs from 'node:fs';
import path from 'node:path';
import { registerAuthRoutes } from './auth/routes.js';
import { authenticate } from './auth/users.js';
import { createStripe } from './billing/stripe.js';
import { registerBillingRoutes } from './billing/webhook.js';
import { registerEntityRoutes } from './entities/routes.js';
import { recordServerError, registerErrorRoutes } from './errors.js';
import { createEntityService } from './entities/service.js';
import { registerFunctionRoutes } from './functions/index.js';
import { HttpError, REPLY, Router, readJson, sendJson } from './lib/http.js';
import { HANDLED, registerUploadRoutes, serveFile } from './uploads.js';
import { registerWellKnownRoutes } from './well-known.js';

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Postgres error codes worth turning into a clear 4xx.
function databaseError(error) {
  if (error.code === '23505') return new HttpError(409, 'That already exists.');
  if (error.code === '23503') return new HttpError(400, 'That refers to a record that does not exist.');
  if (error.code === '23514' || error.code === '22P02' || error.code === '22007') {
    return new HttpError(400, 'One of the values is not allowed.');
  }
  return null;
}

// `stripe` is the one object that talks to Stripe (src/billing/stripe.js). Tests pass a fake.
export function createApp({ db, config, registry, stripe = createStripe(config) }) {
  const entities = createEntityService(db, registry);
  const router = new Router();

  router.add('GET', '/api/health', async () => {
    await db.query('select 1 as ok', []);
    return { ok: true };
  });
  // The old app asked Base44 for public app settings before anything else.
  router.add('GET', '/api/app/public-settings', async () => ({ id: 'fitpro', public_settings: {} }));

  registerAuthRoutes(router);
  registerEntityRoutes(router, entities);
  registerFunctionRoutes(router);
  registerBillingRoutes(router);
  registerUploadRoutes(router);
  registerErrorRoutes(router);
  registerWellKnownRoutes(router);

  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  };

  async function serveWeb(res, pathname) {
    const root = config.webDist;
    let file = path.resolve(root, `.${path.posix.normalize(decodeURIComponent(pathname))}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html'); // single-page app fallback
    }
    const ext = path.extname(file);
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    return serveFile(res, file, {
      'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  }

  return async function handle(req, res) {
    const started = Date.now();
    // A fallback so the error path always has something to log if the address is unusable.
    let url = { pathname: String(req.url || '').slice(0, 200) };
    let userId = null;
    try {
      try {
        url = new URL(req.url, 'http://localhost');
        decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, 'That address is not valid.');
      }
      cors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Two-step sign-in (MFA) isn't built yet; the sign-in screens handle this cleanly.
      if (url.pathname.startsWith('/api/auth/mfa')) {
        throw new HttpError(501, "Two-step sign-in isn't available yet.");
      }

      const match = router.match(req.method, url.pathname);
      if (!match) {
        // The website answers every other page; a well-known file that does not exist is a
        // plain 404, never the app's HTML.
        const ownPage = !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/.well-known/');
        if (config.webDist && req.method === 'GET' && ownPage) {
          await serveWeb(res, url.pathname);
          return;
        }
        throw new HttpError(404, 'Not found');
      }
      if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed');

      const type = String(req.headers['content-type'] || '');
      const wantsJson = req.method !== 'GET' && (type === '' || type.startsWith('application/json'));
      const ctx = {
        req,
        res,
        url,
        params: match.params,
        db,
        config,
        stripe,
        body: wantsJson && !match.raw ? await readJson(req) : {},
        user: await authenticate(req, db, config),
      };

      userId = ctx.user?.id ?? null;

      const result = await match.handler(ctx);
      if (result === HANDLED) return;
      if (result && result[REPLY]) sendJson(res, result.status, result.body);
      else sendJson(res, 200, result);
    } catch (raw) {
      // A path segment that cannot be decoded is the caller's mistake, not ours.
      const mapped = raw instanceof URIError ? new HttpError(400, 'That address is not valid.') : raw;
      const error = mapped instanceof HttpError ? mapped : databaseError(mapped) || mapped;
      if (error instanceof HttpError) {
        const headers = error.extra?.retryAfter ? { 'Retry-After': String(error.extra.retryAfter) } : {};
        const { retryAfter, ...extra } = error.extra || {};
        if (!res.headersSent) sendJson(res, error.status, { error: error.message, ...extra }, headers);
      } else {
        console.error(`[error] ${req.method} ${url.pathname}`, error);
        recordServerError(db, error, { method: req.method, pathname: url.pathname, userId });
        const message = config.production ? 'Something went wrong on our side.' : error.message;
        if (!res.headersSent) sendJson(res, 500, { error: message });
        // Part of a file may already be on its way: end the connection rather than leave it hanging.
        else res.destroy();
      }
    } finally {
      if (!config.production && url.pathname.startsWith('/api/')) {
        console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  };
}
