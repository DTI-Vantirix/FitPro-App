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
const globals = { fetch, AbortController, setTimeout, clearTimeout };
const api = load('src/social/api.ts', {}, globals);
const runApi = load('src/run/api.ts', {}, globals);
const reset = (fn) => { calls.length = 0; responder = fn; };
const last = () => calls[calls.length - 1];
const seen = () => calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`);
const pt = (lat, lng) => ({ lat, lng });
const E = '/api/entities';

const profileRow = (extra = {}) => ({ id: 'p1', created_by_id: 'u1', handle: 'ana.r', display_name: 'Ana R', bio: '', avatar_url: '', visibility: 'private', ...extra });
const profile = (extra = {}) => ({ id: 'p1', ownerId: 'u1', handle: 'ana.r', displayName: 'Ana R', bio: '', avatarUrl: '', visibility: 'private', ...extra });

await test('the account: id, email and name from /auth/me', async () => {
  reset(() => ({ status: 200, data: { id: 'u1', email: 'ana@example.com', full_name: 'Ana Ruiz', role: 'user' } }));
  assert.deepEqual(await api.fetchAccount('tok'), { id: 'u1', email: 'ana@example.com', fullName: 'Ana Ruiz' });
  assert.deepEqual([last().method, last().url, last().headers.Authorization], ['GET', `${BASE}/api/auth/me`, 'Bearer tok']);
});

await test('my social profile: found by owner, nothing created', async () => {
  reset(() => ({ status: 200, data: { items: [profileRow()] } }));
  assert.deepEqual(await api.loadMyProfile('tok', { id: 'u1', email: 'a@b.c', fullName: 'Ana Ruiz' }), profile());
  assert.deepEqual(seen(), [`POST ${E}/SocialProfile/query`]);
  assert.deepEqual(last().body, { q: { created_by_id: 'u1' }, limit: 1 });
});

await test('my social profile: created private on first use, as the website does', async () => {
  reset((call) => {
    if (call.url.endsWith('/query')) return { status: 200, data: { items: [] } };
    return { status: 201, data: profileRow({ id: 'new', created_by_id: 'u9', ...call.body }) };
  });
  const made = await api.loadMyProfile('tok', { id: 'u9', email: 'a@b.c', fullName: 'Ana Ruiz' });
  assert.deepEqual(seen(), [`POST ${E}/SocialProfile/query`, `POST ${E}/SocialProfile/query`, `POST ${E}/SocialProfile`]);
  assert.deepEqual(calls[1].body, { q: { handle: 'ana.ruiz' }, limit: 1 });
  assert.deepEqual(last().body, { handle: 'ana.ruiz', display_name: 'Ana Ruiz', visibility: 'private' });
  assert.deepEqual([made.id, made.handle, made.visibility], ['new', 'ana.ruiz', 'private']);
});

await test('my social profile: a taken handle gets four digits; two screens asking at once create one profile', async () => {
  reset((call) => {
    if (call.url.endsWith('/query')) return { status: 200, data: { items: call.body.q.handle ? [profileRow({ id: 'other', created_by_id: 'u2', handle: 'ana.ruiz' })] : [] } };
    return { status: 201, data: profileRow({ id: 'new', created_by_id: 'u8', ...call.body }) };
  });
  const account = { id: 'u8', email: 'a@b.c', fullName: 'Ana Ruiz' };
  const [a, b] = await Promise.all([api.loadMyProfile('tok8', account, () => 0.5), api.loadMyProfile('tok8', account, () => 0.5)]);
  assert.equal(a.handle, 'ana.ruiz5500');
  assert.deepEqual(a, b);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url === `${BASE}${E}/SocialProfile`).length, 1);
});

await test('saving the profile: handle checked first, then the four fields the website sends', async () => {
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 200, data: profileRow({ handle: 'ana', display_name: 'Ana', bio: 'x', visibility: 'public' }) }));
  const values = { handle: 'ana', display_name: 'Ana', bio: 'x', visibility: 'public' };
  const saved = await api.saveProfile('tok', profile(), values);
  assert.deepEqual(seen(), [`POST ${E}/SocialProfile/query`, `PUT ${E}/SocialProfile/p1`]);
  assert.deepEqual(calls[0].body, { q: { handle: 'ana' }, limit: 1 });
  assert.deepEqual(last().body, values);
  assert.deepEqual([saved.handle, saved.visibility], ['ana', 'public']);
});

await test('saving the profile: someone else\'s handle is refused before anything is written', async () => {
  reset(() => ({ status: 200, data: { items: [profileRow({ id: 'other', created_by_id: 'u2', handle: 'ben' })] } }));
  await assert.rejects(api.saveProfile('tok', profile(), { handle: 'ben', display_name: 'Ana', bio: '', visibility: 'private' }),
    (e) => e.message === 'That handle is already taken.' && e.status === 409);
  assert.deepEqual(seen(), [`POST ${E}/SocialProfile/query`]);
  // My own handle is not "taken".
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [profileRow()] } } : { status: 200, data: profileRow() }));
  await api.saveProfile('tok', profile(), { handle: 'ana.r', display_name: 'Ana R', bio: '', visibility: 'private' });
  assert.equal(last().method, 'PUT');
  // Taken between the check and the save: the server's 409 reads the same.
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 409, data: { error: 'That already exists.' } }));
  await assert.rejects(api.saveProfile('tok', profile(), { handle: 'ben', display_name: 'Ana', bio: '', visibility: 'private' }),
    (e) => e.message === 'That handle is already taken.');
});

const postRow = (extra = {}) => ({ id: 'post1', created_by_id: 'u2', created_date: '2026-11-27T10:00:00.000Z', kind: 'run', ref_id: 'r1', title: 'Loop',
  caption: 'Easy', distance_mi: 3.1, duration_sec: 1800, avg_pace_sec: 580, zone_name: 'Zone 2', in_zone_pct: 80,
  route_points: [pt(42, -71), pt(999, 0), pt(42.01, -71)], visibility: 'friends', author_handle: 'ben', author_name: 'Ben', shared_to: [], ...extra });

await test('the feed is the website\'s request: socialFeed with an empty body; workouts hidden', async () => {
  reset(() => ({ status: 200, data: { posts: [postRow(), postRow({ id: 'w', kind: 'workout' }), { kind: 'run' }], friend_ids: ['u2'] } }));
  const posts = await api.loadFeed('tok');
  assert.deepEqual([last().method, last().url, last().body, last().headers.Authorization], ['POST', `${BASE}/api/functions/socialFeed`, {}, 'Bearer tok']);
  assert.deepEqual(posts, [{ id: 'post1', ownerId: 'u2', createdAt: '2026-11-27T10:00:00.000Z', kind: 'run', title: 'Loop', caption: 'Easy',
    distanceMi: 3.1, durationSec: 1800, avgPaceSec: 580, zoneName: 'Zone 2', routePoints: [pt(42, -71), pt(42.01, -71)],
    visibility: 'friends', authorHandle: 'ben', authorName: 'Ben', backgroundType: 'none', backgroundUrl: '' }]);
  reset(() => 'offline');
  await assert.rejects(api.loadFeed('tok'), (e) => e.status === 0 && /Can't reach VantraRun/.test(e.message));
});

await test('a post\'s background is read as the server stores it; an unknown kind is none', async () => {
  reset(() => ({ status: 200, data: { posts: [
    postRow({ id: 'a', background_type: 'photo', background_url: '/backgrounds/trees.jpg' }),
    postRow({ id: 'b', background_type: 'video', background_url: '/uploads/v.mp4' }),
    postRow({ id: 'c', background_type: 'hologram', background_url: '/uploads/x.bin' }),
    postRow({ id: 'd', background_type: 'photo', background_url: 42 }),
    postRow({ id: 'e' }),
  ] } }));
  const posts = await api.loadFeed('tok');
  assert.deepEqual(posts.map((p) => [p.id, p.backgroundType, p.backgroundUrl]),
    [['a', 'photo', '/backgrounds/trees.jpg'], ['b', 'video', '/uploads/v.mp4'], ['c', 'none', ''], ['d', 'none', ''], ['e', 'none', '']]);
});

const NAME = '0b0e6c1e-6f0a-4a57-9a43-5d0b8f0f2a11';
const sends = [];
let sendReply = () => ({ status: 201, body: JSON.stringify({ file_url: `/uploads/${NAME}.mp4` }) });
const send = async (request) => { sends.push(request); return sendReply(request); };
const video = { uri: 'file:///cache/clip.mp4', mimeType: 'video/mp4' };

await test('uploading media: the file\'s own bytes to /api/uploads, with the sign-in and the file\'s type, as the website sends it', async () => {
  reset(() => ({ status: 500, data: {} }));
  sends.length = 0;
  const url = await api.uploadMedia('tok', video, send);
  assert.equal(url, `/uploads/${NAME}.mp4`);
  assert.equal(sends.length, 1);
  assert.deepEqual([sends[0].url, sends[0].uri, sends[0].mimeType], [`${BASE}/api/uploads`, 'file:///cache/clip.mp4', 'video/mp4']);
  assert.deepEqual(sends[0].headers, { Accept: 'application/json', Authorization: 'Bearer tok', 'Content-Type': 'video/mp4' });
  // Nothing else is sent anywhere: no second request, no JSON call beside it.
  assert.equal(calls.length, 0);
});

await test('uploading media: an address on this server is accepted whether it is written short or in full', async () => {
  sendReply = () => ({ status: 201, body: JSON.stringify({ file_url: `${BASE}/uploads/${NAME}.jpg` }) });
  assert.equal(await api.uploadMedia('tok', { uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, send), `${BASE}/uploads/${NAME}.jpg`);
  for (const body of [JSON.stringify({ file_url: `https://elsewhere.example/uploads/${NAME}.jpg` }), JSON.stringify({ file_url: '' }), JSON.stringify({}), 'not json', '']) {
    sendReply = () => ({ status: 201, body });
    await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.name === 'ApiError' && /did not say where/.test(e.message), body);
  }
});

await test('uploading media: progress is passed on as a whole percent, and the cancel signal reaches the sender', async () => {
  const seen = [];
  const controller = new AbortController();
  sendReply = (request) => { request.onProgress(0, 2000); request.onProgress(500, 2000); request.onProgress(2000, 2000); return { status: 201, body: JSON.stringify({ file_url: `/uploads/${NAME}.mp4` }) }; };
  await api.uploadMedia('tok', video, send, { onProgress: (percent) => seen.push(percent), signal: controller.signal });
  assert.deepEqual(seen, [0, 25, 100]);
  assert.equal(sends[sends.length - 1].signal, controller.signal);
});

await test('uploading media: the server\'s refusals come back in its words', async () => {
  sendReply = () => ({ status: 413, body: JSON.stringify({ error: 'That upload is too large.' }) });
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 413 && e.message === 'That upload is too large.');
  sendReply = () => ({ status: 415, body: JSON.stringify({ error: 'Upload a photo (JPEG, PNG, WebP, GIF, HEIC) or a video (MP4, MOV, WebM).' }) });
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 415 && /Upload a photo/.test(e.message));
  sendReply = () => ({ status: 401, body: JSON.stringify({ error: 'Sign in again.' }) });
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 401);
  sendReply = () => ({ status: 413, body: '<html>Request Entity Too Large</html>' });
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 413 && /too large/i.test(e.message));
  sendReply = () => ({ status: 502, body: '<html>Bad gateway</html>' });
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 502 && e.message === 'Request failed (502).');
});

await test('uploading media: no connection and a cancelled upload are told apart, and nothing is sent without a type or a file', async () => {
  sendReply = () => { throw new TypeError('Network request failed'); };
  await assert.rejects(api.uploadMedia('tok', video, send), (e) => e.status === 0 && /Can't reach VantraRun/.test(e.message));
  const controller = new AbortController();
  sendReply = () => { controller.abort(); throw new Error('AbortError'); };
  await assert.rejects(api.uploadMedia('tok', video, send, { signal: controller.signal }), (e) => e.status === 0 && e.message === 'The upload was cancelled.');
  sends.length = 0;
  await assert.rejects(api.uploadMedia('tok', { uri: 'file:///a.tiff', mimeType: 'image/tiff' }, send), /cannot be used/);
  await assert.rejects(api.uploadMedia('tok', { uri: '', mimeType: 'image/jpeg' }, send), /cannot be used/);
  await assert.rejects(api.uploadMedia('', video, send), /signed out/i);
  assert.equal(sends.length, 0);
});

await test('discover asks for public posts only', async () => {
  reset(() => ({ status: 200, data: { items: [postRow({ visibility: 'public' }), postRow({ id: 'leak', visibility: 'friends' }), postRow({ id: 'w', kind: 'workout', visibility: 'public' })] } }));
  const posts = await api.loadDiscover('tok');
  assert.deepEqual([last().url, last().body], [`${BASE}${E}/Post/query`, { q: { visibility: 'public' }, sort: '-created_date', limit: 30 }]);
  // Belt and braces: anything not public that came back is dropped.
  assert.deepEqual(posts.map((p) => p.id), ['post1']);
});

await test('creating and deleting a post', async () => {
  const payload = { kind: 'run', ref_id: 'r1', visibility: 'private', caption: 'x' };
  reset((call) => ({ status: 201, data: postRow({ ...call.body, id: 'new', created_by_id: 'u1' }) }));
  const post = await api.createPost('tok', payload);
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}${E}/Post`, payload]);
  assert.deepEqual([post.id, post.visibility], ['new', 'private']);
  reset(() => ({ status: 201, data: {} }));
  await assert.rejects(api.createPost('tok', payload), /did not confirm/);
  reset(() => ({ status: 200, data: { ok: true } }));
  await api.deletePost('tok', 'p/1');
  assert.deepEqual([last().method, last().url, last().body], ['DELETE', `${BASE}${E}/Post/p%2F1`, undefined]);
  reset(() => ({ status: 403, data: { error: 'Forbidden' } }));
  await assert.rejects(api.deletePost('tok', 'x'), (e) => e.status === 403);
});

const linkRow = (extra = {}) => ({ id: 'c1', from_user_id: 'u1', to_user_id: 'u2', from_handle: 'ana.r', from_name: 'Ana R', to_handle: 'ben', to_name: 'Ben', status: 'pending', ...extra });

await test('people and connections are read as the website reads them', async () => {
  reset(() => ({ status: 200, data: { items: [profileRow(), { id: 'bad' }] } }));
  assert.deepEqual(await api.listProfiles('tok'), [profile()]);
  assert.deepEqual([last().url, last().body], [`${BASE}${E}/SocialProfile/query`, { q: {}, limit: 100 }]);
  reset(() => ({ status: 200, data: { items: [linkRow(), { id: 'bad' }] } }));
  const links = await api.loadConnections('tok', 'u1');
  assert.deepEqual(last().body, { q: { $or: [{ from_user_id: 'u1' }, { to_user_id: 'u1' }] }, sort: '-created_date', limit: 200 });
  assert.deepEqual(links, [{ id: 'c1', fromUserId: 'u1', toUserId: 'u2', fromHandle: 'ana.r', fromName: 'Ana R', toHandle: 'ben', toName: 'Ben', status: 'pending' }]);
});

await test('a friend request: from me only, pending for a private account, accepted for a public one', async () => {
  const target = profile({ id: 'p2', ownerId: 'u2', handle: 'ben', displayName: 'Ben' });
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 201, data: { id: 'c9', ...call.body } }));
  const made = await api.sendRequest('tok', { meId: 'u1', myProfile: profile(), target });
  assert.deepEqual(calls[0].body, { q: { $or: [{ from_user_id: 'u1', to_user_id: 'u2' }, { from_user_id: 'u2', to_user_id: 'u1' }] }, limit: 1 });
  assert.deepEqual([last().method, last().url], ['POST', `${BASE}${E}/Connection`]);
  assert.deepEqual(last().body, { from_user_id: 'u1', to_user_id: 'u2', from_handle: 'ana.r', from_name: 'Ana R', to_handle: 'ben', to_name: 'Ben', status: 'pending' });
  assert.equal(made.status, 'pending');
  await api.sendRequest('tok', { meId: 'u1', myProfile: profile(), target: { ...target, visibility: 'public' } });
  assert.equal(last().body.status, 'accepted');
});

await test('a friend request is never sent twice, or to myself', async () => {
  const target = profile({ id: 'p2', ownerId: 'u2', handle: 'ben', displayName: 'Ben' });
  reset(() => ({ status: 200, data: { items: [linkRow({ from_user_id: 'u2', to_user_id: 'u1' })] } }));
  const found = await api.sendRequest('tok', { meId: 'u1', myProfile: profile(), target });
  assert.equal(found.id, 'c1');
  assert.deepEqual(seen(), [`POST ${E}/Connection/query`]);
  reset(() => ({ status: 200, data: {} }));
  await assert.rejects(api.sendRequest('tok', { meId: 'u1', myProfile: profile(), target: profile() }), /yourself/);
  assert.equal(calls.length, 0);
});

await test('accepting, declining, cancelling and removing', async () => {
  reset(() => ({ status: 200, data: linkRow({ status: 'accepted' }) }));
  await api.acceptConnection('tok', 'c1');
  assert.deepEqual([last().method, last().url, last().body], ['PUT', `${BASE}${E}/Connection/c1`, { status: 'accepted' }]);
  reset(() => ({ status: 200, data: { ok: true } }));
  await api.removeConnection('tok', 'c1');
  assert.deepEqual([last().method, last().url, last().body], ['DELETE', `${BASE}${E}/Connection/c1`, undefined]);
});

const challengeRow = (extra = {}) => ({ id: 'ch1', created_by_id: 'u1', name: 'November 100', description: '', metric: 'distance', target_value: 100,
  month: '2026-11', start_date: '2026-11-01T05:00:00.000Z', end_date: '2026-12-01T05:00:00.000Z', creator_handle: 'ana.r', ...extra });
const challenge = { id: 'ch1', ownerId: 'u1', name: 'November 100', description: '', metric: 'distance', targetValue: 100,
  month: '2026-11', startDate: '2026-11-01T05:00:00.000Z', endDate: '2026-12-01T05:00:00.000Z' };

await test('challenges: the list, without workout challenges, and which ones I joined', async () => {
  reset(() => ({ status: 200, data: { items: [challengeRow(), challengeRow({ id: 'gym', metric: 'workouts' }), { id: 'bad' }] } }));
  assert.deepEqual(await api.listChallenges('tok'), [challenge]);
  assert.deepEqual([last().url, last().body], [`${BASE}${E}/Challenge/query`, { q: {}, sort: '-created_date', limit: 30 }]);
  reset(() => ({ status: 200, data: { items: [{ id: 'm1', challenge_id: 'ch1', user_id: 'u1' }, { id: 'm2', challenge_id: 'ch7', user_id: 'u1' }] } }));
  assert.deepEqual(await api.listJoinedIds('tok', 'u1'), ['ch1', 'ch7']);
  assert.deepEqual([last().url, last().body], [`${BASE}${E}/ChallengeMember/query`, { q: { user_id: 'u1' }, limit: 100 }]);
});

await test('creating a challenge posts the record as given', async () => {
  const record = { name: 'November 100', description: '', metric: 'distance', target_value: 100, month: '2026-11', start_date: 'a', end_date: 'b', creator_handle: 'ana.r' };
  reset((call) => ({ status: 201, data: challengeRow({ ...call.body, id: 'new' }) }));
  const made = await api.createChallenge('tok', record);
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}${E}/Challenge`, record]);
  assert.equal(made.id, 'new');
  reset(() => ({ status: 201, data: {} }));
  await assert.rejects(api.createChallenge('tok', record), /did not confirm/);
});

await test('the leaderboard: one number per member and nothing else', async () => {
  reset(() => ({ status: 200, data: { challenge: challengeRow(), member_count: 2, joined: true,
    rows: [{ user_id: 'u2', name: 'Ben', handle: 'ben', value: 12.5, secret: 'x' }, { user_id: 'u1', name: 'Ana R', handle: 'ana.r', value: '3.1' }, { name: 'nobody' }] } }));
  const board = await api.loadBoard('tok', 'ch1');
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}/api/functions/challengeBoard`, { challenge_id: 'ch1' }]);
  assert.deepEqual(board, { challenge, memberCount: 2, joined: true,
    rows: [{ userId: 'u2', name: 'Ben', handle: 'ben', value: 12.5 }, { userId: 'u1', name: 'Ana R', handle: 'ana.r', value: 3.1 }] });
  reset(() => ({ status: 404, data: { error: 'Challenge not found' } }));
  await assert.rejects(api.loadBoard('tok', 'nope'), (e) => e.status === 404);
  reset(() => ({ status: 200, data: { rows: [] } }));
  await assert.rejects(api.loadBoard('tok', 'ch1'), /not available/);
});

await test('joining: my own membership only, never twice; leaving deletes it', async () => {
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 201, data: { id: 'm1', ...call.body } }));
  await api.joinChallenge('tok', { challengeId: 'ch1', meId: 'u1', handle: 'ana.r', name: 'Ana R' });
  assert.deepEqual(calls[0].body, { q: { challenge_id: 'ch1', user_id: 'u1' }, limit: 1 });
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}${E}/ChallengeMember`, { challenge_id: 'ch1', user_id: 'u1', handle: 'ana.r', name: 'Ana R' }]);
  reset(() => ({ status: 200, data: { items: [{ id: 'm1', challenge_id: 'ch1', user_id: 'u1' }] } }));
  await api.joinChallenge('tok', { challengeId: 'ch1', meId: 'u1', handle: 'ana.r', name: 'Ana R' });
  assert.deepEqual(seen(), [`POST ${E}/ChallengeMember/query`]);
  await api.leaveChallenge('tok', { challengeId: 'ch1', meId: 'u1' });
  assert.deepEqual([last().method, last().url], ['DELETE', `${BASE}${E}/ChallengeMember/m1`]);
  reset(() => ({ status: 200, data: { items: [] } }));
  await api.leaveChallenge('tok', { challengeId: 'ch1', meId: 'u1' });
  assert.deepEqual(seen(), [`POST ${E}/ChallengeMember/query`]);
});

await test('runs to share: the same single run query, now with each run\'s track', async () => {
  reset(() => ({ status: 200, data: { items: [
    { id: 'a', route_name: 'Loop', distance_mi: 3.1, duration_sec: 1800, avg_pace_sec: 580.6, started_at: '2026-11-20T07:00:00.000Z',
      target_zone_name: 'Zone 2', in_zone_pct: 82, external_id: 'x-1', points: [{ lat: 42, lng: -71, hr: 150 }, pt(999, 0), pt(42.01, -71)] },
    { id: 'b', distance_mi: 5, duration_sec: 3000 },
    { id: 'c', distance_mi: 0, duration_sec: 60 }] } }));
  const runs = await runApi.listRunsToShare('tok', 'u1', { limit: 8 });
  assert.equal(calls.length, 1);
  assert.deepEqual([last().method, last().url, last().body], ['POST', `${BASE}${E}/Run/query`, { q: { created_by_id: 'u1' }, sort: '-started_at', limit: 8 }]);
  assert.deepEqual(runs.map((r) => [r.id, r.routeName, r.externalId, r.points]), [['a', 'Loop', 'x-1', [pt(42, -71), pt(42.01, -71)]], ['b', 'Free run', null, []]]);
});

await test('no social call touches the run or workout records, or any other host', async () => {
  reset((call) => (call.url.endsWith('/query') ? { status: 200, data: { items: [] } } : { status: 200, data: {} }));
  await api.loadFeed('tok'); await api.loadDiscover('tok'); await api.listProfiles('tok'); await api.loadConnections('tok', 'u1');
  await api.listChallenges('tok'); await api.listJoinedIds('tok', 'u1'); await api.findProfileByHandle('tok', 'ben');
  assert.ok(calls.every((c) => c.url.startsWith(`${BASE}/api/`) && !/entities\/(Run|Workout)\b/.test(c.url) && c.headers.Authorization === 'Bearer tok'));
});

done('social API client');
