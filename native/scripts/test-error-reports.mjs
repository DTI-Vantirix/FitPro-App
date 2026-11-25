import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.50:4000';
const r = load('src/diagnostics/error-reports.ts', {}, { fetch: async () => { throw new Error('global fetch must not be used in tests'); } });
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9abc.eyJzdWIiOiIxMjM0NTY3ODkwIn0xyz.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

await test('a report is a message, a stack and labels, cut to the server limits', () => {
  const error = new TypeError('x'.repeat(900));
  error.stack = 's'.repeat(9000);
  const report = r.buildErrorReport(error, { platform: 'ios', appVersion: '1.0.0 (12)', context: 'run-live', fatal: true });
  assert.equal(report.message.length, 500);
  assert.ok(report.message.startsWith('TypeError: xxx'));
  assert.equal(report.stack.length, 4000);
  assert.deepEqual([report.platform, report.app_version, report.context], ['ios', '1.0.0 (12)', 'fatal · run-live']);
  assert.deepEqual(Object.keys(report).sort(), ['app_version', 'context', 'message', 'platform', 'stack']);
});

await test('things that are not Errors still make a report', () => {
  assert.equal(r.buildErrorReport('plain string', { platform: 'android' }).message, 'plain string');
  assert.equal(r.buildErrorReport({ code: 7 }, { platform: 'android' }).message, '{"code":7}');
  assert.equal(r.buildErrorReport(undefined, { platform: 'android' }).message, 'undefined');
  const circular = {}; circular.self = circular;
  assert.equal(typeof r.buildErrorReport(circular, { platform: 'android' }).message, 'string');
  assert.deepEqual(Object.keys(r.buildErrorReport('x', { platform: 'android' })).sort(), ['message', 'platform']);
});

await test('a sign-in token never leaves in a report', () => {
  const error = new Error(`Request failed with Authorization: Bearer ${TOKEN}`);
  error.stack = `Error: token ${TOKEN}\n    at fetch (app.js:1:1)`;
  const text = JSON.stringify(r.buildErrorReport(error, { platform: 'ios' }));
  assert.ok(!text.includes(TOKEN) && !text.includes(TOKEN.slice(0, 30)), text);
  assert.match(text, /\[removed\]/);
});

await test('sending: to our own API with the bearer token, and never throwing', async () => {
  const calls = [];
  const ok = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  const report = r.buildErrorReport(new Error('boom'), { platform: 'ios' });
  assert.equal(await r.sendErrorReport('tok', report, ok), true);
  assert.equal(calls[0].url, 'http://192.168.1.50:4000/api/client-errors');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(calls[0].options.body).message, 'boom');
  assert.equal(await r.sendErrorReport(null, report, ok), false, 'signed out: nothing is sent');
  assert.equal(calls.length, 1);
  assert.equal(await r.sendErrorReport('tok', report, async () => { throw new Error('offline'); }), false);
  assert.equal(await r.sendErrorReport('tok', report, async () => ({ ok: false })), false);
});

await test('the global handler reports, then always hands on to the original handler', async () => {
  const handled = [];
  const sent = [];
  let handler = (error, fatal) => { handled.push([error.message, fatal]); };
  const errorUtils = { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } };
  r.installErrorReporting({
    errorUtils,
    getToken: async () => 'tok',
    meta: () => ({ platform: 'android', appVersion: '1.0.0' }),
    fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  handler(new Error('first'), true);
  await settle();
  assert.deepEqual(handled, [['first', true]]);
  assert.deepEqual([sent[0].message, sent[0].context, sent[0].platform, sent[0].app_version], ['first', 'fatal', 'android', '1.0.0']);
  // a crash loop cannot flood the server
  for (let i = 0; i < 20; i++) handler(new Error(`again ${i}`), false);
  await settle();
  assert.equal(sent.length, r.MAX_REPORTS_PER_LAUNCH);
  assert.equal(handled.length, 21);
});

await test('a broken reporter never swallows the crash', async () => {
  const handled = [];
  let handler = (error) => { handled.push(error.message); };
  r.installErrorReporting({
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    getToken: () => { throw new Error('secure store unavailable'); },
    meta: () => { throw new Error('no constants'); },
  });
  handler(new Error('still handled'));
  await settle();
  assert.deepEqual(handled, ['still handled']);
  r.installErrorReporting({ errorUtils: undefined, getToken: async () => null, meta: () => ({ platform: 'ios' }) });
});
await test('a fatal crash is written down first and sent the next time the app opens', async () => {
  const disk = { saved: null };
  const sent = [];
  const pending = {
    save: (report) => { disk.saved = JSON.stringify(report); },
    take: () => { const raw = disk.saved; return raw ? JSON.parse(raw) : null; },
    clear: () => { disk.saved = null; },
  };
  let killed = false;
  let handler = () => { killed = true; };
  const install = (fetcher) => r.installErrorReporting({
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    getToken: async () => 'tok',
    meta: () => ({ platform: 'ios', appVersion: '1.0.0' }),
    pending,
    // the app dies before any request can finish
    fetcher,
  });
  await install(async () => new Promise(() => {}));
  handler(new Error('fatal one'), true);
  assert.equal(killed, true);
  assert.equal(JSON.parse(disk.saved).message, 'fatal one', 'saved before the original handler ran');

  // next launch, still offline: the report is kept
  handler = () => {};
  await install(async () => { throw new Error('offline'); });
  await settle();
  assert.equal(JSON.parse(disk.saved).message, 'fatal one');

  // next launch with a connection: sent once and forgotten
  handler = () => {};
  await install(async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; });
  await settle();
  assert.deepEqual(sent.map((s) => [s.message, s.context]), [['fatal one', 'fatal']]);
  assert.equal(disk.saved, null);
});

await test('a storage failure while saving a crash never hides the crash', async () => {
  const handled = [];
  let handler = (error) => { handled.push(error.message); };
  await r.installErrorReporting({
    errorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (next) => { handler = next; } },
    getToken: async () => 'tok',
    meta: () => ({ platform: 'ios' }),
    pending: { save: () => { throw new Error('disk full'); }, take: () => { throw new Error('unreadable'); }, clear: () => {} },
    fetcher: async () => ({ ok: true }),
  });
  handler(new Error('still fatal'), true);
  assert.deepEqual(handled, ['still fatal']);
});
done('error reports');
