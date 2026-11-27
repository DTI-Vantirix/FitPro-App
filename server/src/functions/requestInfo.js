import { HttpError, clientIp, forwardedFor, trustedProxyHops } from '../lib/http.js';

// Admin-only: how this request reached the server, and which address the rate limits
// counted it against. For finding the right TRUSTED_PROXY_HOPS on a host: call it from
// a browser on the live site, compare `forwarded_for` with your own public address
// (count its position from the right), set the value, and call it again to see
// `client_ip` show your address. See docs/launch-checklist.md.
export default async function requestInfo({ user, req }) {
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only');
  return {
    forwarded_for: forwardedFor(req),
    socket: req.socket?.remoteAddress || 'unknown',
    client_ip: clientIp(req),
    trusted_proxy_hops: trustedProxyHops(),
  };
}
