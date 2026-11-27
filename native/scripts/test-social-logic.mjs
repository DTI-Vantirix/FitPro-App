import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const s = load('src/social/logic.ts');
const pt = (lat, lng, extra = {}) => ({ lat, lng, ...extra });
const profile = (extra = {}) => ({ id: 'p1', ownerId: 'u1', handle: 'ana.r', displayName: 'Ana R', bio: '', avatarUrl: '', visibility: 'private', ...extra });
const run = (extra = {}) => ({ id: 'run-1', routeName: 'River loop', distanceMi: 3.1, durationSec: 1800, avgPaceSec: 580.6,
  targetZoneName: 'Zone 2', inZonePct: 82, points: [pt(42, -71), pt(42.01, -71)], ...extra });

await test('handles: lower case, letters digits dot underscore, 24 at most', () => {
  assert.equal(s.cleanHandle('  Ana María_99!.x '), 'anamara_99.x');
  assert.equal(s.cleanHandle('@Runner'), 'runner');
  assert.equal(s.cleanHandle('a'.repeat(40)).length, 24);
  assert.equal(s.cleanHandle(null), '');
});

await test('the first handle comes from the name, else the email, else "athlete"', () => {
  assert.equal(s.defaultHandleBase({ fullName: 'Ana  Ruiz', email: 'x@y.z' }), 'ana.ruiz');
  assert.equal(s.defaultHandleBase({ fullName: '', email: 'Ana.R+test@example.com' }), 'ana.rtest');
  assert.equal(s.defaultHandleBase({ fullName: '', email: '' }), 'athlete');
  assert.equal(s.defaultHandleBase({ fullName: '!!!', email: '' }), 'athlete');
});

await test('audiences: the website\'s three, in its order, with its labels', () => {
  assert.deepEqual(s.AUDIENCES.map((a) => [a.id, a.label]), [['public', 'Public'], ['friends', 'Friends'], ['private', 'Only me']]);
  assert.equal(s.audienceLabel('public'), 'Anyone on VantraRun');
  assert.equal(s.audienceLabel('friends'), 'Friends');
  assert.equal(s.audienceLabel('private'), 'Only me');
  assert.equal(s.audienceLabel('something else'), 'Friends');
});

await test('the default audience is never wider than the website\'s: friends, public only for a public account', () => {
  assert.equal(s.defaultAudience(profile({ visibility: 'private' })), 'friends');
  assert.equal(s.defaultAudience(profile({ visibility: 'public' })), 'public');
  assert.equal(s.defaultAudience(null), 'friends');
  assert.equal(s.defaultAudience(profile({ visibility: 'PUBLIC' })), 'friends');
});

await test('route points for a post: thinned as the website thins them, lat and lng only', () => {
  const many = Array.from({ length: 500 }, (_, i) => pt(42 + i / 1e5, -71, { hr: 150, t: i, accuracy: 4 }));
  const thin = s.thinTrack(many);
  // step = ceil(500 / 160) = 4 -> every fourth point, 125 of them.
  assert.equal(thin.length, 125);
  assert.deepEqual(thin[0], { lat: 42, lng: -71 });
  assert.deepEqual(thin[1], { lat: 42 + 4 / 1e5, lng: -71 });
  assert.ok(thin.every((p) => Object.keys(p).join() === 'lat,lng'));
  assert.equal(s.thinTrack(many.slice(0, 160)).length, 160);
  assert.deepEqual(s.thinTrack([pt(42, -71), pt(999, 0), pt('x', 1), null, pt(42.01, -71)]), [pt(42, -71), pt(42.01, -71)]);
  assert.deepEqual(s.thinTrack(undefined), []);
});

await test('a post carries exactly the website composer\'s fields and nothing else', () => {
  const post = s.buildPost({ run: run(), caption: '  Legs felt heavy.  ', audience: 'private', profile: profile({ avatarUrl: '/uploads/a.png' }) });
  assert.deepEqual(post, {
    kind: 'run', ref_id: 'run-1', title: 'River loop', caption: 'Legs felt heavy.',
    distance_mi: 3.1, duration_sec: 1800, avg_pace_sec: 580.6, zone_name: 'Zone 2', in_zone_pct: 82,
    route_points: [pt(42, -71), pt(42.01, -71)],
    background_type: 'none', background_url: '',
    visibility: 'private', author_handle: 'ana.r', author_name: 'Ana R', author_avatar: '/uploads/a.png', shared_to: [],
  });
});

await test('a post: missing values fall back as on the website', () => {
  const post = s.buildPost({ run: run({ routeName: '', targetZoneName: null, inZonePct: null, points: [] }), caption: '', audience: 'friends', profile: profile({ displayName: '' }) });
  assert.deepEqual([post.title, post.zone_name, post.in_zone_pct, post.route_points, post.author_name, post.visibility],
    ['Free run', '', 0, [], 'ana.r', 'friends']);
});

await test('a post goes to the audience picked and never to an unknown one', () => {
  for (const audience of ['public', 'friends', 'private']) assert.equal(s.buildPost({ run: run(), caption: '', audience, profile: profile() }).visibility, audience);
  assert.throws(() => s.buildPost({ run: run(), caption: '', audience: 'everyone', profile: profile() }), /audience/i);
  assert.throws(() => s.buildPost({ run: run(), caption: '', audience: undefined, profile: profile() }), /audience/i);
});

await test('a post with a background carries the website\'s two fields: the type and the address', () => {
  const base = { run: run(), caption: '', audience: 'friends', profile: profile() };
  const plain = s.buildPost(base);
  const photo = s.buildPost({ ...base, background: { type: 'photo', url: '/backgrounds/trees.jpg' } });
  const video = s.buildPost({ ...base, background: { type: 'video', url: '/uploads/0b0e6c1e-6f0a-4a57-9a43-5d0b8f0f2a11.mp4' } });
  assert.deepEqual([photo.background_type, photo.background_url], ['photo', '/backgrounds/trees.jpg']);
  assert.deepEqual([video.background_type, video.background_url], ['video', '/uploads/0b0e6c1e-6f0a-4a57-9a43-5d0b8f0f2a11.mp4']);
  // Nothing else about the record changes, and no field is added: no file name, size, place or time of the media.
  assert.deepEqual({ ...photo, background_type: 'none', background_url: '' }, plain);
  assert.deepEqual(Object.keys(video), Object.keys(plain));
  assert.deepEqual([s.buildPost({ ...base, background: { type: 'none', url: '' } }).background_type, s.buildPost({ ...base, background: undefined }).background_url], ['none', '']);
});

await test('a post never names a background it does not have, or a kind the server does not know', () => {
  const base = { run: run(), caption: '', audience: 'friends', profile: profile() };
  assert.throws(() => s.buildPost({ ...base, background: { type: 'photo', url: '' } }), /background/i);
  assert.throws(() => s.buildPost({ ...base, background: { type: 'video', url: '   ' } }), /background/i);
  assert.throws(() => s.buildPost({ ...base, background: { type: 'gif', url: '/uploads/x.gif' } }), /background/i);
  // "None" never carries an address, even if one is left over from an earlier choice.
  assert.equal(s.buildPost({ ...base, background: { type: 'none', url: '/uploads/left-over.jpg' } }).background_url, '');
});

await test('gym is hidden: workout posts are not shown', () => {
  assert.deepEqual(s.visiblePosts([{ id: 'a', kind: 'run' }, { id: 'b', kind: 'workout' }, { id: 'c', kind: 'run' }]).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(s.visiblePosts(null), []);
});

const link = (id, from, to, status, extra = {}) => ({ id, fromUserId: from, toUserId: to, fromHandle: `h${from}`, fromName: `N${from}`, toHandle: `h${to}`, toName: `N${to}`, status, ...extra });

await test('connections split into friends, requests for me and requests I sent', () => {
  const all = [link('1', 'me', 'a', 'accepted'), link('2', 'b', 'me', 'accepted'), link('3', 'c', 'me', 'pending'), link('4', 'me', 'd', 'pending'), link('5', 'e', 'me', 'declined')];
  const split = s.splitConnections(all, 'me');
  assert.deepEqual([split.friends.map((c) => c.id), split.incoming.map((c) => c.id), split.outgoing.map((c) => c.id)], [['1', '2'], ['3'], ['4']]);
});

await test('the other person on a connection, whichever side I am', () => {
  assert.deepEqual(s.otherSide(link('1', 'me', 'a', 'accepted'), 'me'), { name: 'Na', handle: 'ha' });
  assert.deepEqual(s.otherSide(link('2', 'b', 'me', 'accepted'), 'me'), { name: 'Nb', handle: 'hb' });
  assert.deepEqual(s.otherSide(link('3', 'b', 'me', 'pending', { fromName: '' }), 'me'), { name: 'hb', handle: 'hb' });
  assert.equal(s.connectionWith([link('1', 'me', 'a', 'accepted'), link('2', 'b', 'me', 'pending')], 'me', 'b').id, '2');
  assert.equal(s.connectionWith([link('1', 'me', 'a', 'accepted')], 'me', 'z'), null);
});

await test('search: by @handle or name, never myself, nothing for an empty query', () => {
  const people = [profile(), profile({ id: 'p2', ownerId: 'u2', handle: 'ben', displayName: 'Ben Stone' }), profile({ id: 'p3', ownerId: 'u3', handle: 'stoneman', displayName: '' })];
  assert.deepEqual(s.searchProfiles(people, '  ', 'u1'), []);
  assert.deepEqual(s.searchProfiles(people, '@BEN', 'u1').map((p) => p.id), ['p2']);
  assert.deepEqual(s.searchProfiles(people, 'stone', 'u1').map((p) => p.id), ['p2', 'p3']);
  assert.deepEqual(s.searchProfiles(people, 'ana', 'u1'), []);
  assert.deepEqual(s.searchProfiles(people, 'ana', 'u2').map((p) => p.id), ['p1']);
});

await test('a request to a private account waits for approval; a public account connects at once', () => {
  assert.equal(s.requestStatusFor(profile({ visibility: 'private' })), 'pending');
  assert.equal(s.requestStatusFor(profile({ visibility: 'public' })), 'accepted');
  assert.equal(s.requestStatusFor(profile({ visibility: undefined })), 'pending');
});

await test('editing the social profile: the website\'s checks and wording', () => {
  assert.deepEqual(s.profileEdit({ handle: ' !! ', displayName: 'Ana', bio: '', visibility: 'private' }),
    { ok: false, error: 'Pick a handle — letters, numbers, dots and underscores.' });
  assert.deepEqual(s.profileEdit({ handle: 'Ana.R', displayName: '  ', bio: '  Chasing a sub-20 5k ', visibility: 'public' }),
    { ok: true, values: { handle: 'ana.r', display_name: 'ana.r', bio: 'Chasing a sub-20 5k', visibility: 'public' } });
  // Anything but a plain "public" keeps the account private.
  assert.equal(s.profileEdit({ handle: 'ana', displayName: 'Ana', bio: '', visibility: 'open' }).values.visibility, 'private');
  assert.equal(s.HANDLE_TAKEN, 'That handle is already taken.');
});

await test('links and share text', () => {
  assert.equal(s.inviteLink('https://vantrarun.example', 'ana.r'), 'https://vantrarun.example/friends?add=ana.r');
  assert.equal(s.inviteLink('https://vantrarun.example/', 'a b'), 'https://vantrarun.example/friends?add=a%20b');
  assert.equal(s.inviteLink('', 'ana'), '');
  assert.equal(s.postLink('https://vantrarun.example', 'p 1'), 'https://vantrarun.example/feed?post=p%201');
  assert.equal(s.postText({ distanceMi: 3.104, zoneName: 'Zone 2' }), '3.10 mi · Zone 2 — logged on VantraRun');
  assert.equal(s.postText({ distanceMi: 0, zoneName: '' }), '0.00 mi — logged on VantraRun');
});

await test('time since a post, in plain words', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  const ago = (ms) => s.timeAgo(new Date(now - ms).toISOString(), now);
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  assert.equal(ago(5000), 'a few seconds ago');
  assert.equal(ago(70 * 1000), 'a minute ago');
  assert.equal(ago(5 * MIN), '5 minutes ago');
  assert.equal(ago(50 * MIN), 'an hour ago');
  assert.equal(ago(3 * HOUR), '3 hours ago');
  assert.equal(ago(23 * HOUR), 'a day ago');
  assert.equal(ago(4 * DAY), '4 days ago');
  assert.equal(ago(30 * DAY), 'a month ago');
  assert.equal(ago(90 * DAY), '3 months ago');
  assert.equal(ago(400 * DAY), 'a year ago');
  assert.equal(ago(800 * DAY), '2 years ago');
  assert.equal(ago(-5000), 'a few seconds ago'); // a phone clock a little behind the server
  assert.equal(s.timeAgo('not a date', now), '');
  assert.equal(s.timeAgo(null, now), '');
});

await test('initials for the avatar circle', () => {
  assert.equal(s.initials('Ana Ruiz', 'ana'), 'AN');
  assert.equal(s.initials('', 'ben'), 'BE');
  assert.equal(s.initials('', ''), '?');
});

await test('route trace: fitted and centred in the box, north up, start first', () => {
  // A track twice as tall as it is wide, drawn in a 100 box with no padding.
  const trace = s.traceSegments([pt(42, -71), pt(42.02, -71), pt(42.02, -70.99)], 100, 0);
  assert.equal(trace.segments.length, 2);
  // Longitude span 0.01 scaled by 5000 = 50 wide, centred: x from 25 to 75. South is at the bottom.
  assert.deepEqual([Math.round(trace.start.x), Math.round(trace.start.y)], [25, 100]);
  const [up, right] = trace.segments;
  assert.deepEqual([Math.round(up.length), Math.round(up.angle)], [100, -90]);
  assert.deepEqual([Math.round(up.cx), Math.round(up.cy)], [25, 50]);
  assert.deepEqual([Math.round(right.length), Math.round(right.angle)], [50, 0]);
  assert.deepEqual([Math.round(right.cx), Math.round(right.cy)], [50, 0]);
});

await test('route trace: nothing to draw without two good points; long tracks are thinned', () => {
  assert.equal(s.traceSegments([pt(42, -71)], 100), null);
  assert.equal(s.traceSegments([pt(42, -71), pt('x', 2)], 100), null);
  assert.equal(s.traceSegments(null, 100), null);
  const long = Array.from({ length: 160 }, (_, i) => pt(42 + i / 1e4, -71 + Math.sin(i) / 1e4));
  const trace = s.traceSegments(long, 96);
  assert.ok(trace.segments.length <= 60 && trace.segments.length >= 30);
  assert.ok(trace.segments.every((seg) => seg.cx >= 0 && seg.cx <= 96 && seg.cy >= 0 && seg.cy <= 96 && Number.isFinite(seg.angle)));
  // A run on the spot (no span) still gives finite numbers.
  const still = s.traceSegments([pt(42, -71), pt(42, -71)], 100, 0);
  assert.ok(Number.isFinite(still.start.x) && Number.isFinite(still.segments[0].length));
});

done('social logic');
