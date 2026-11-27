// The two files that let a friend invite link (https://<site>/friends?add=<handle>) open the
// phone app instead of the website. No database needed: nothing here reads one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { appleAppSiteAssociation, assetLinks, certFingerprints } from '../src/well-known.js';

const FP_A = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const FP_B = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const AASA = '/.well-known/apple-app-site-association';
const LINKS = '/.well-known/assetlinks.json';

const noDb = { query: async () => { throw new Error('These routes must not touch the database.'); } };
const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'fitpro-web-'));
fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>VantraRun</title>');
const servers = [];

async function serve(env = {}) {
  const config = { ...loadConfig({ NODE_ENV: 'test', ...env }), webDist };
  const server = http.createServer(createApp({ db: noDb, config, registry: new Map() }));
  await new Promise((r) => server.listen(0, r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let base;
let log;
before(async () => {
  log = console.log;
  console.log = () => {};
  base = await serve();
});
after(async () => {
  console.log = log;
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(webDist, { recursive: true, force: true });
});

describe('apple-app-site-association', () => {
  test('names the app and only /friends with an add query', () => {
    assert.deepEqual(appleAppSiteAssociation(['LA4YX3HF32.com.vantrarun.app']), {
      applinks: {
        details: [{
          appIDs: ['LA4YX3HF32.com.vantrarun.app'],
          components: [{ '/': '/friends', '?': { add: '?*' }, comment: 'Friend invite links: /friends?add=<handle>' }],
        }],
      },
    });
  });

  test('is served as application/json, with no redirect and no sign-in, ahead of the website', async () => {
    const res = await fetch(base + AASA, { redirect: 'manual' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('location'), null);
    const body = await res.json();
    assert.deepEqual(body.applinks.details.map((d) => d.appIDs), [['LA4YX3HF32.com.vantrarun.app']]);
    assert.deepEqual(body.applinks.details[0].components.map((c) => [c['/'], c['?']]), [['/friends', { add: '?*' }]]);
    // Nothing else on the site is claimed for the app.
    assert.equal(body.applinks.details.length, 1);
    assert.ok(!('webcredentials' in body) && !('appclips' in body));
  });

  test('the app id comes from IOS_APP_ID when it is set', async () => {
    const other = await serve({ IOS_APP_ID: ' ABCDE12345.com.example.one , ABCDE12345.com.example.two ' });
    const body = await (await fetch(other + AASA)).json();
    assert.deepEqual(body.applinks.details[0].appIDs, ['ABCDE12345.com.example.one', 'ABCDE12345.com.example.two']);
  });

  test('the website still answers its own pages, and an unknown well-known file is a 404', async () => {
    const page = await fetch(`${base}/friends?add=ana.r`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const unknown = await fetch(`${base}/.well-known/something-else`);
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get('content-type'), /^application\/json/);
    assert.equal((await fetch(base + AASA, { method: 'POST' })).status, 405);
  });
});

describe('assetlinks.json', () => {
  test('fingerprints: comma separated, tidied, anything that is not a SHA-256 dropped', () => {
    assert.deepEqual(certFingerprints(''), []);
    assert.deepEqual(certFingerprints(undefined), []);
    assert.deepEqual(certFingerprints(` ${FP_A.toLowerCase()} , ${FP_B.replaceAll(':', '')}, nonsense, AA:BB `), [FP_A, FP_B]);
    assert.deepEqual(certFingerprints(`${FP_A},${FP_A}`), [FP_A]);
  });

  test('no fingerprint means no statement', () => {
    assert.deepEqual(assetLinks('com.vantrarun.app', []), []);
  });

  test('with a fingerprint, the package may handle the site\'s links', () => {
    assert.deepEqual(assetLinks('com.vantrarun.app', [FP_A, FP_B]), [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.vantrarun.app', sha256_cert_fingerprints: [FP_A, FP_B] },
    }]);
  });

  test('served as an empty array until ANDROID_CERT_SHA256 is set', async () => {
    const res = await fetch(base + LINKS, { redirect: 'manual' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(await res.text(), '[]');
  });

  test('served with the statement once ANDROID_CERT_SHA256 is set', async () => {
    const signed = await serve({ ANDROID_CERT_SHA256: `${FP_A}, ${FP_B.toLowerCase()}` });
    const res = await fetch(signed + LINKS);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(await res.json(), [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.vantrarun.app', sha256_cert_fingerprints: [FP_A, FP_B] },
    }]);
  });
});
