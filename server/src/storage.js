import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

// Where uploaded media lives. Two choices behind one small interface:
//
//   disk  UPLOAD_DIR on this machine (development, or a host with a persistent disk)
//   s3    any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3, MinIO),
//         used when S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and
//         S3_SECRET_ACCESS_KEY are all set
//
//   put(name, buffer, contentType)   store a file
//   open(name) -> { stream, size }   read it back, or null when it does not exist
//
// The bucket stays private: files are read back through this API, so the URL
// the apps use (/uploads/<name>) is the same for both.

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986 encoding as Signature V4 requires it (encodeURIComponent leaves !*'() alone).
const encode = (value) => encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * AWS Signature Version 4 for one request. Returns the headers to send:
 * the ones given, plus host, x-amz-date, x-amz-content-sha256 and Authorization.
 */
export function signV4({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', now = new Date() }) {
  const target = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);

  const all = { ...headers, host: target.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const canonical = Object.entries(all)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = canonical.map(([name]) => name).join(';');

  const canonicalPath = target.pathname.split('/').map((part) => encode(decodeURIComponent(part))).join('/') || '/';
  const canonicalQuery = [...target.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonical.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const out = { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  out.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return out;
}

function diskStorage(dir) {
  return {
    kind: 'disk',
    async put(name, buffer) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, name), buffer);
    },
    async open(name) {
      const file = path.join(dir, name);
      let stat;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        return null;
      }
      if (!stat.isFile()) return null;
      return { stream: fs.createReadStream(file), size: stat.size };
    },
  };
}

function s3Storage({ endpoint, bucket, region, accessKeyId, secretAccessKey }) {
  const urlFor = (name) => `${endpoint}/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`;
  const sign = (method, url, headers, payloadHash) =>
    signV4({ method, url, headers, payloadHash, accessKeyId, secretAccessKey, region });

  // Errors name the operation and the status only: never the URL's query, the
  // headers or anything else that could carry a credential into a log.
  const failure = (what, detail) => new Error(`Upload storage ${what} failed (${detail}).`);

  // The timer runs until the bucket answers (plus a second per megabyte sent), then
  // stops: a large file may take as long as the reader's connection needs.
  async function request(what, method, name, headers, body, payloadHash) {
    const url = urlFor(name);
    const controller = new AbortController();
    const allowed = 30000 + Math.ceil((body?.length || 0) / (1024 * 1024)) * 1000;
    const timer = setTimeout(() => controller.abort(), allowed);
    try {
      return await fetch(url, { method, headers: sign(method, url, headers, payloadHash), body, signal: controller.signal });
    } catch {
      throw failure(what, controller.signal.aborted ? 'timed out' : 'could not reach the bucket');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 's3',
    async put(name, buffer, contentType) {
      const res = await request('write', 'PUT', name, { 'Content-Type': contentType }, buffer, sha256Hex(buffer));
      if (!res.ok) throw failure('write', `the bucket answered ${res.status}`);
      await res.arrayBuffer().catch(() => {});
    },
    async open(name) {
      const res = await request('read', 'GET', name, {}, undefined, sha256Hex(''));
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => {});
        return null;
      }
      if (!res.ok || !res.body) throw failure('read', `the bucket answered ${res.status}`);
      const length = Number(res.headers.get('content-length'));
      return { stream: Readable.fromWeb(res.body), size: Number.isFinite(length) && length >= 0 ? length : null };
    },
  };
}

const cache = new WeakMap();

/** The storage for a config. One instance per config object. */
export function createStorage(config) {
  let storage = cache.get(config);
  if (!storage) {
    storage = config.storage?.s3 ? s3Storage(config.storage.s3) : diskStorage(config.uploadDir);
    cache.set(config, storage);
  }
  return storage;
}
