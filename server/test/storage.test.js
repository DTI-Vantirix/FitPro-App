// Upload storage: local disk, or any S3-compatible bucket. No database needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createStorage, signV4 } from '../src/storage.js';

const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('Signature V4 matches the example in the AWS S3 documentation (GET Object)', () => {
  const headers = signV4({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { Range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA256,
    accessKeyId: KEY,
    secretAccessKey: SECRET,
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(headers['x-amz-date'], '20130524T000000Z');
  assert.equal(
    headers.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );
});

test('Signature V4 matches the AWS example for a query string (GET Bucket Lifecycle)', () => {
  const headers = signV4({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/?lifecycle',
    headers: {},
    payloadHash: EMPTY_SHA256,
    accessKeyId: KEY,
    secretAccessKey: SECRET,
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(headers.Authorization, /Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543$/);
});

test('storage is the disk unless every bucket setting is present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-storage-'));
  assert.equal(createStorage(loadConfig({ UPLOAD_DIR: dir })).kind, 'disk');
  assert.equal(createStorage(loadConfig({ UPLOAD_DIR: dir, S3_ENDPOINT: 'https://x.example', S3_BUCKET: 'b' })).kind, 'disk');
  assert.equal(
    createStorage(loadConfig({ UPLOAD_DIR: dir, S3_ENDPOINT: 'https://x.example', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })).kind,
    's3'
  );
});

test('disk: a file written can be read back; a missing one is null', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-storage-')), 'not-yet-created');
  const storage = createStorage(loadConfig({ UPLOAD_DIR: dir }));
  await storage.put('a.png', Buffer.from([1, 2, 3]), 'image/png');
  const found = await storage.open('a.png');
  assert.equal(found.size, 3);
  assert.deepEqual(await read(found.stream), Buffer.from([1, 2, 3]));
  assert.equal(await storage.open('missing.png'), null);
});

// ---- a stand-in bucket ----
let bucket;
let endpoint;
const objects = new Map();
const seen = [];
let failNext = 0;

before(async () => {
  bucket = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (failNext) {
      failNext -= 1;
      res.writeHead(500, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>InternalError</Code></Error>');
      return;
    }
    if (!/^AWS4-HMAC-SHA256 Credential=test-key\//.test(req.headers.authorization || '')) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      objects.set(req.url, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
      res.writeHead(200);
      res.end();
    } else if (req.method === 'GET' && objects.has(req.url)) {
      const object = objects.get(req.url);
      res.writeHead(200, { 'Content-Length': object.body.length, 'Content-Type': object.type });
      res.end(object.body);
    } else {
      res.writeHead(404);
      res.end('<Error><Code>NoSuchKey</Code></Error>');
    }
  });
  await new Promise((r) => bucket.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${bucket.address().port}`;
});
after(() => new Promise((r) => bucket.close(r)));

const s3Config = () =>
  loadConfig({ S3_ENDPOINT: `${endpoint}/`, S3_BUCKET: 'media', S3_ACCESS_KEY_ID: 'test-key', S3_SECRET_ACCESS_KEY: 'test-secret-value', S3_REGION: 'auto' });

test('bucket: put then open round-trips the bytes, path-style, signed', async () => {
  const storage = createStorage(s3Config());
  const bytes = Buffer.from('not really a png');
  await storage.put('0b0e7c0e-1111-4222-8333-444455556666.png', bytes, 'image/png');
  assert.deepEqual(objects.get('/media/0b0e7c0e-1111-4222-8333-444455556666.png'), { body: bytes, type: 'image/png' });
  const put = seen.find((r) => r.method === 'PUT');
  assert.match(put.headers.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,/);
  assert.match(put.headers['x-amz-content-sha256'], /^[0-9a-f]{64}$/);
  const found = await storage.open('0b0e7c0e-1111-4222-8333-444455556666.png');
  assert.equal(found.size, bytes.length);
  assert.deepEqual(await read(found.stream), bytes);
});

test('bucket: a missing object is null, not an error', async () => {
  assert.equal(await createStorage(s3Config()).open('nope.png'), null);
});

test('bucket: a failure is reported without leaking the keys', async () => {
  const storage = createStorage(s3Config());
  for (const attempt of [() => storage.put('x.png', Buffer.from('x'), 'image/png'), () => storage.open('x.png')]) {
    failNext = 1;
    await assert.rejects(attempt, (error) => {
      const text = `${error.message} ${error.stack}`;
      assert.match(error.message, /storage/i);
      assert.ok(!text.includes('test-secret-value') && !text.includes('test-key') && !/AWS4-HMAC/.test(text), text);
      return true;
    });
  }
});
