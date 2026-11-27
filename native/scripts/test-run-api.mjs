import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const BASE = 'http://192.168.1.50:4000';
process.env.EXPO_PUBLIC_API_URL = BASE;
const calls = [];
let responder = () => ({ status: 200, data: {} });
const fetch = async (url, options) => {
  const call = { url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined };
  calls.push(call);
  const reply = await responder(call);
  if (reply === 'offline') throw new TypeError('Network request failed');
  const text = typeof reply.data === 'string' ? reply.data : JSON.stringify(reply.data);
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, text: async () => text };
};
const api = load('src/run/api.ts', {}, { fetch, AbortController, setTimeout, clearTimeout });
const reset = (fn) => { calls.length = 0; responder = fn; };
const last = () => calls[calls.length - 1];

await test('sign-up sends the invite code, tidied', async () => {
  reset(() => ({ status: 200, data: { ok: true } }));
  await api.register({ email: ' new@runner.test ', password: 'longenough', fullName: ' Ada Runner ', inviteCode: ' fp-ab12-cd34 ' });
  assert.equal(last().url, `${BASE}/api/auth/register`);
  assert.deepEqual(last().body, { email: 'new@runner.test', password: 'longenough', full_name: 'Ada Runner', invite_code: 'FP-AB12-CD34' });
  assert.equal(last().headers.Authorization, undefined);
});
await test('a refused sign-up shows the server\'s own sentence', async () => {
  reset(() => ({ status: 400, data: { error: 'That code has already been used.' } }));
  await assert.rejects(api.register({ email: 'a@b.test', password: 'longenough', fullName: '', inviteCode: 'X' }),
    (e) => e.status === 400 && e.message === 'That code has already been used.');
});
await test('the emailed code signs the runner in', async () => {
  reset(() => ({ status: 200, data: { access_token: 'tok-1', user: { id: 'u1' } } }));
  assert.equal(await api.verifyEmailCode('a@b.test', ' 123456 '), 'tok-1');
  assert.deepEqual([last().url, last().body], [`${BASE}/api/auth/verify-otp`, { email: 'a@b.test', otp_code: '123456' }]);
  reset(() => ({ status: 409, data: { error: 'That invite code was just used by someone else. Ask for a new one.' } }));
  await assert.rejects(api.verifyEmailCode('a@b.test', '123456'), (e) => e.status === 409 && /just used by someone else/.test(e.message));
  reset(() => ({ status: 200, data: { ok: true } }));
  await api.resendEmailCode('a@b.test');
  assert.equal(last().url, `${BASE}/api/auth/resend-otp`);
});
await test('offline is said plainly', async () => {
  reset(() => 'offline');
  await assert.rejects(api.fetchMe('tok'), (e) => e.status === 0 && /Can't reach VantraRun/.test(e.message));
});
await test('account deletion is DELETE /api/auth/me with the password', async () => {
  reset(() => ({ status: 200, data: { ok: true, deleted: true } }));
  await api.deleteAccount('tok', 'secret-pass');
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization],
    ['DELETE', `${BASE}/api/auth/me`, { password: 'secret-pass' }, 'Bearer tok']);
  reset(() => ({ status: 401, data: { error: 'Enter your current password to delete your account.' } }));
  await assert.rejects(api.deleteAccount('tok', 'wrong'), /current password/);
});
await test('profile: only the caller\'s own, created or updated', async () => {
  reset(() => ({ status: 200, data: { items: [] } }));
  assert.equal(await api.loadProfile('tok', 'u1'), null);
  assert.deepEqual(last().body, { q: { created_by_id: 'u1' }, sort: '-created_date', limit: 1 });
  reset((c) => (c.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 201, data: { id: 'p1' } }));
  await api.saveProfile('tok', 'u1', { hr_max: 190, threshold_sec: 510 });
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}/api/entities/Profile`, { hr_max: 190, threshold_sec: 510 }]);
  reset((c) => (c.url.endsWith('/query') ? { status: 200, data: { items: [{ id: 'p1', hr_max: 185 }] } } : { status: 200, data: { id: 'p1' } }));
  await api.saveProfile('tok', 'u1', { hr_max: 190, threshold_sec: 510 });
  assert.deepEqual([last().method, last().url], ['PUT', `${BASE}/api/entities/Profile/p1`]);
});
await test('zones: five existing zones are updated in place', async () => {
  const existing = [1, 2, 3, 4, 5].map((n) => ({ id: `z${n}`, zone_number: n, name: `Zone ${n}`, fast_sec: 500, slow_sec: 600, hr_min_pct: 50, hr_max_pct: 60 }));
  reset((c) => (c.url.endsWith('/query') ? { status: 200, data: { items: existing } } : { status: 200, data: [] }));
  const zones = await api.applyZones('tok', 'u1', 600);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, `${BASE}/api/entities/PaceZone/bulk`);
  assert.equal(put.body.length, 5);
  assert.deepEqual([put.body[1].id, put.body[1].fast_sec, put.body[1].slow_sec, put.body[1].hr_min_pct], ['z2', 690, 768, 60]);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
  assert.equal(calls[0].body.q.created_by_id, 'u1');
  assert.equal(zones.length, 5);
});
await test('zones: anything else is cleared and the five are created', async () => {
  const odd = [{ id: 'old1', zone_number: 1, name: 'Easy', fast_sec: 500, slow_sec: 600 }, { id: 'old2', zone_number: 7, name: 'Odd', fast_sec: 400, slow_sec: 450 }];
  reset((c) => (c.url.endsWith('/query') ? { status: 200, data: { items: odd } } : { status: 200, data: [] }));
  await api.applyZones('tok', 'u1', 510);
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url), [`${BASE}/api/entities/PaceZone/old1`, `${BASE}/api/entities/PaceZone/old2`]);
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/PaceZone/bulk'));
  assert.equal(post.body.length, 5);
  assert.equal(post.body[0].name, 'Zone 1');
  assert.ok(!('id' in post.body[0]));
});
await test('zones list: unusable rows dropped, sorted by number', async () => {
  reset(() => ({ status: 200, data: { items: [
    { id: 'b', zone_number: 3, name: 'Zone 3', fast_sec: 600, slow_sec: 650, hr_min_pct: 70, hr_max_pct: 80 },
    { id: 'x', zone_number: 9, name: 'Broken', fast_sec: 0, slow_sec: 10 },
    { id: 'a', zone_number: 2, name: 'Zone 2', fast_sec: '690', slow_sec: 768 }] } }));
  const zones = await api.listZones('tok', 'u1');
  assert.deepEqual(zones.map((z) => z.id), ['a', 'b']);
  assert.deepEqual([zones[0].fast_sec, zones[0].hr_min_pct], [690, null]);
});
await test('zones list: intensity, purpose and feel come through when stored', async () => {
  reset(() => ({ status: 200, data: { items: [
    { id: 'a', zone_number: 2, name: 'Zone 2', fast_sec: 690, slow_sec: 768, hr_min_pct: 60, hr_max_pct: 70, intensity: 'Light', purpose: 'Base', feel: 'Easy talk', color: '#A6A6AE' },
    { id: 'b', zone_number: 3, name: 'Zone 3', fast_sec: 600, slow_sec: 650 }] } }));
  const zones = await api.listZones('tok', 'u1');
  assert.deepEqual(zones[0], { id: 'a', name: 'Zone 2', zone_number: 2, fast_sec: 690, slow_sec: 768, hr_min_pct: 60, hr_max_pct: 70, color: '#A6A6AE', intensity: 'Light', purpose: 'Base', feel: 'Easy talk' });
  assert.ok(!('intensity' in zones[1]) && !('purpose' in zones[1]) && !('feel' in zones[1]));
});
await test('updateZone changes one zone\'s name and pace range and nothing else', async () => {
  reset(() => ({ status: 200, data: { id: 'z 2', zone_number: 2, name: 'Easy', fast_sec: 700, slow_sec: 780, hr_min_pct: 60, hr_max_pct: 70 } }));
  const zone = await api.updateZone('tok', 'z 2', { name: 'Easy', fast_sec: 700, slow_sec: 780 });
  assert.equal(calls.length, 1);
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization],
    ['PUT', `${BASE}/api/entities/PaceZone/z%202`, { name: 'Easy', fast_sec: 700, slow_sec: 780 }, 'Bearer tok']);
  assert.deepEqual([zone.id, zone.name, zone.fast_sec, zone.slow_sec, zone.zone_number], ['z 2', 'Easy', 700, 780, 2]);
  reset(() => ({ status: 403, data: { error: "You can't change this PaceZone." } }));
  await assert.rejects(api.updateZone('tok', 'z9', { name: 'Easy', fast_sec: 700, slow_sec: 780 }), (e) => e.status === 403 && /can't change/.test(e.message));
  reset(() => ({ status: 200, data: {} }));
  await assert.rejects(api.updateZone('tok', 'z2', { name: 'Easy', fast_sec: 700, slow_sec: 780 }), /did not confirm/);
});
await test('routes: the dense path when there is one, waypoints otherwise, nothing undrawable', async () => {
  const pt = (lat, lng) => ({ lat, lng });
  reset(() => ({ status: 200, data: { items: [
    { id: 'r1', name: 'Loop', distance_mi: 3.2, points: [pt(42, -71), pt(42.01, -71)], path: [pt(42, -71), pt(42.005, -71), pt(42.01, -71)], target_zone_id: 'z3', target_zone_name: 'Zone 3' },
    { id: 'r2', name: 'Waypoints only', points: [pt(42, -71), pt(42.01, -71)] },
    { id: 'r3', name: 'One point', points: [pt(42, -71)] },
    { id: 'r4', name: 'Bad', points: [pt(999, 0), pt('x', 1)] }] } }));
  const routes = await api.listRoutes('tok', 'u1');
  assert.deepEqual(routes.map((r) => [r.id, r.path.length, r.targetZoneId]), [['r1', 3, 'z3'], ['r2', 2, null]]);
  assert.equal(last().body.q.created_by_id, 'u1');
});
await test('directions: available, unavailable, and failing all come back without throwing', async () => {
  reset(() => ({ status: 200, data: { available: true, maneuvers: [
    { index: 0, instruction: 'Walk east on Elm St.', verbal: 'Walk east on Elm Street.', type: 1, lat: 42.36, lng: -71.06, at_mi: 0 },
    { index: 1, instruction: '', lat: 42.36, lng: -71.06, at_mi: 0.1 },
    { index: 2, instruction: 'Turn left.', type: 15, lat: 42.37, lng: -71.06, at_mi: 0.2 }] } }));
  const d = await api.fetchDirections('tok', 'r1');
  assert.deepEqual([last().url, last().body], [`${BASE}/api/functions/routeDirections`, { route_id: 'r1' }]);
  assert.equal(d.available, true);
  assert.deepEqual(d.maneuvers.map((m) => [m.index, m.verbal]), [[0, 'Walk east on Elm Street.'], [1, 'Turn left.']]);
  reset(() => ({ status: 200, data: { available: false, maneuvers: [] } }));
  assert.deepEqual(await api.fetchDirections('tok', 'r1'), { available: false, maneuvers: [] });
  reset(() => 'offline');
  assert.deepEqual(await api.fetchDirections('tok', 'r1'), { available: false, maneuvers: [] });
  reset(() => ({ status: 404, data: { error: 'Route not found.' } }));
  assert.deepEqual(await api.fetchDirections('tok', 'r1'), { available: false, maneuvers: [] });
});
await test('saving a run goes to ingestActivity and nowhere else', async () => {
  const payload = { kind: 'run', source: 'fitpro', external_id: 'run-1', distance_mi: 3.1, duration_sec: 1800 };
  reset(() => ({ status: 200, data: { ok: true, kind: 'run', action: 'created', run_id: 'srv-1' } }));
  assert.deepEqual(await api.sendRun('tok', payload), { kind: 'ok', runId: 'srv-1' });
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization],
    ['POST', `${BASE}/api/functions/ingestActivity`, payload, 'Bearer tok']);
  reset(() => 'offline');
  assert.deepEqual((await api.sendRun('tok', payload)).kind, 'retry');
  reset(() => ({ status: 403, data: { error: 'Redeem your invite code before syncing activities.' } }));
  const refused = await api.sendRun('tok', payload);
  assert.deepEqual([refused.kind, refused.error], ['retry', 'Redeem your invite code before syncing activities.']);
  reset(() => ({ status: 400, data: { error: 'distance_mi must be a number greater than 0.' } }));
  assert.equal((await api.sendRun('tok', payload)).kind, 'rejected');
  reset(() => ({ status: 502, data: '<html>Bad gateway</html>' }));
  assert.equal((await api.sendRun('tok', payload)).kind, 'retry');
  assert.ok(!calls.some((c) => /entities\/Run/.test(c.url)));
});
done('run API client');
