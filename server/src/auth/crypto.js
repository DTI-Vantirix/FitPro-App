import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ------------------------------------------------------------------ passwords

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [algo, N, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

// A hash that costs as much as a real check, so unknown emails take as long as known ones.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ||= await hashPassword('not-a-real-password');
  await verifyPassword(String(password || ''), dummyHash);
  return false;
}

// ------------------------------------------------------------------ access tokens (JWT, HS256)

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signToken(claims, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec }));
  const sig = createHmac('sha256', secret).update(`${HEADER}.${body}`).digest('base64url');
  return `${HEADER}.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ one-time codes

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const longToken = () => randomBytes(32).toString('base64url');
