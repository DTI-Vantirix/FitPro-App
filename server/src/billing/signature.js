import crypto from 'node:crypto';

// Checks the `Stripe-Signature` header of a webhook delivery, as Stripe documents it:
//   t=<unix seconds>,v1=<hex>[,v1=<hex>...]
// The signed string is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's signing
// secret. Several v1 values appear while a secret is being rolled; any one may match.
// Other schemes (v0) are ignored. A timestamp further than the tolerance from now,
// either way, is refused, so a captured delivery cannot be replayed later.
export function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now } = {}) {
  if (!secret || typeof header !== 'string' || !header) return false;
  let timestamp = null;
  const candidates = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || !candidates.length) return false;
  if (Math.abs(now() / 1000 - Number(timestamp)) > toleranceSec) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  let matched = false;
  for (const candidate of candidates) {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) continue;
    // Every candidate is compared, in constant time, whether or not one has matched.
    if (crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), expected)) matched = true;
  }
  return matched;
}
