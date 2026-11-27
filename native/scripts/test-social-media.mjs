import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const m = load('src/social/media.ts');
const API = 'https://api.example.com';
const MB = 1024 * 1024;
const NAME = '0b0e6c1e-6f0a-4a57-9a43-5d0b8f0f2a11';

await test('limits are the server\'s: its eight types and 50 MB', () => {
  assert.deepEqual(Object.keys(m.UPLOAD_TYPES).sort(), ['image/gif', 'image/heic', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
  assert.equal(m.MAX_UPLOAD_BYTES, 50 * MB);
  assert.equal(m.UPLOAD_TYPES['image/heic'], 'photo');
  assert.equal(m.UPLOAD_TYPES['video/quicktime'], 'video');
});

await test('the stock backgrounds are the website\'s three, by the website\'s paths', () => {
  assert.deepEqual(m.STOCK_BACKGROUNDS, [
    { id: 'trees', label: 'Tree-lined road', url: '/backgrounds/trees.jpg' },
    { id: 'river', label: 'Riverside dusk', url: '/backgrounds/river.jpg' },
    { id: 'trail', label: 'Mountain trail', url: '/backgrounds/trail.jpg' },
  ]);
});

await test('a picked photo or video is accepted with its type, kind and size', () => {
  assert.deepEqual(m.checkMedia({ uri: 'file:///c/a.jpg', mimeType: 'image/jpeg', fileSize: 2 * MB, width: 4000, height: 3000 }),
    { ok: true, media: { uri: 'file:///c/a.jpg', mimeType: 'image/jpeg', kind: 'photo', sizeBytes: 2 * MB } });
  assert.deepEqual(m.checkMedia({ uri: 'file:///c/v.mov', mimeType: 'video/quicktime', fileSize: 50 * MB }).media,
    { uri: 'file:///c/v.mov', mimeType: 'video/quicktime', kind: 'video', sizeBytes: 50 * MB });
});

await test('the type: tidied, or worked out from the file name when the picker gives none', () => {
  const type = (asset) => m.checkMedia({ fileSize: 10, ...asset }).media?.mimeType;
  assert.equal(type({ uri: 'file:///a', mimeType: 'IMAGE/JPG' }), 'image/jpeg');
  assert.equal(type({ uri: 'file:///a', mimeType: 'video/mp4; codecs=avc1' }), 'video/mp4');
  assert.equal(type({ uri: 'file:///cache/IMG_1.HEIC' }), 'image/heic');
  assert.equal(type({ uri: 'content://x/1', fileName: 'clip.MOV' }), 'video/quicktime');
  assert.equal(type({ uri: 'file:///cache/x.jpeg?v=1', mimeType: null }), 'image/jpeg');
  assert.equal(type({ uri: 'file:///cache/x.webm', mimeType: '' }), 'video/webm');
  // A type the picker did name wins over the file's name: Android copies every video to ".mp4".
  assert.equal(m.checkMedia({ uri: 'file:///c/x.mp4', mimeType: 'video/3gpp', fileSize: 10 }).ok, false);
});

await test('a type the server refuses is refused first, in the server\'s words', () => {
  for (const asset of [{ uri: 'file:///a.tiff', mimeType: 'image/tiff' }, { uri: 'file:///a.avif' }, { uri: 'file:///a', mimeType: 'video/3gpp' },
    { uri: 'file:///a.pdf', mimeType: 'application/pdf' }, { uri: 'file:///noext' }]) {
    const result = m.checkMedia({ fileSize: 10, ...asset });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'That file cannot be used. Pick a photo (JPEG, PNG, WebP, GIF, HEIC) or a video (MP4, MOV, WebM).');
  }
});

await test('a file over 50 MB is refused before anything is sent, saying how big it is', () => {
  const big = m.checkMedia({ uri: 'file:///v.mp4', mimeType: 'video/mp4', fileSize: 50 * MB + 1 });
  assert.equal(big.ok, false);
  assert.match(big.error, /50 MB/);
  assert.match(m.checkMedia({ uri: 'file:///v.mp4', mimeType: 'video/mp4', fileSize: 131.4 * MB }).error, /^That video is 131 MB\./);
  assert.match(m.checkMedia({ uri: 'file:///p.png', mimeType: 'image/png', fileSize: 60 * MB }).error, /^That photo is 60 MB\./);
  assert.equal(m.checkMedia({ uri: 'file:///v.mp4', mimeType: 'video/mp4', fileSize: 50 * MB }).ok, true);
});

await test('an empty file is refused; an unknown size is left for the server to judge', () => {
  assert.deepEqual(m.checkMedia({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileSize: 0 }), { ok: false, error: 'That file is empty. Pick another one.' });
  for (const fileSize of [undefined, null, NaN, -1]) {
    assert.deepEqual(m.checkMedia({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', fileSize }).media, { uri: 'file:///a.jpg', mimeType: 'image/jpeg', kind: 'photo', sizeBytes: null });
  }
  assert.equal(m.checkMedia({ uri: '', mimeType: 'image/jpeg', fileSize: 5 }).ok, false);
  assert.equal(m.checkMedia(null).ok, false);
});

await test('media addresses: only the VantraRun server\'s own uploads and backgrounds', () => {
  assert.equal(m.mediaUrl(API, `/uploads/${NAME}.jpg`), `${API}/uploads/${NAME}.jpg`);
  assert.equal(m.mediaUrl(`${API}/`, '/backgrounds/trees.jpg'), `${API}/backgrounds/trees.jpg`);
  assert.equal(m.mediaUrl(API, `${API}/uploads/${NAME}.mov`), `${API}/uploads/${NAME}.mov`);
  assert.equal(m.mediaUrl('http://192.168.1.50:4000', `http://192.168.1.50:4000/uploads/${NAME}.mp4`), `http://192.168.1.50:4000/uploads/${NAME}.mp4`);
  for (const url of [`https://evil.example/uploads/${NAME}.jpg`, `${API}.evil.example/uploads/${NAME}.jpg`, `//evil.example/uploads/${NAME}.jpg`,
    `http://api.example.com/uploads/${NAME}.jpg`, `${API}/api/entities/Post`, '/api/auth/me', '/uploads/../api/auth/me', `/uploads/${NAME}.jpg?next=https://evil.example`,
    '/backgrounds/../uploads/x.jpg', '/backgrounds/trees.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '', null, undefined, 42]) {
    assert.equal(m.mediaUrl(API, url), null, String(url));
  }
  assert.equal(m.mediaUrl('', `/uploads/${NAME}.jpg`), null);
});

await test('how a post\'s background is shown: nothing, a photo, or a video', () => {
  const show = (backgroundType, backgroundUrl) => m.backgroundOf({ backgroundType, backgroundUrl }, API);
  assert.deepEqual(show('none', ''), { kind: 'none' });
  assert.deepEqual(show('photo', '/backgrounds/river.jpg'), { kind: 'photo', uri: `${API}/backgrounds/river.jpg` });
  assert.deepEqual(show('photo', `/uploads/${NAME}.heic`), { kind: 'photo', uri: `${API}/uploads/${NAME}.heic` });
  assert.deepEqual(show('video', `${API}/uploads/${NAME}.mp4`), { kind: 'video', uri: `${API}/uploads/${NAME}.mp4` });
  // Anything else is shown as a post without a background, never fetched.
  assert.deepEqual(show('photo', 'https://tracker.example/pixel.gif'), { kind: 'none' });
  assert.deepEqual(show('photo', ''), { kind: 'none' });
  assert.deepEqual(show('none', `/uploads/${NAME}.jpg`), { kind: 'none' });
  assert.deepEqual(show('gif', `/uploads/${NAME}.gif`), { kind: 'none' });
  assert.deepEqual(show(undefined, undefined), { kind: 'none' });
  assert.deepEqual(m.backgroundOf(null, API), { kind: 'none' });
});

await test('the composer\'s choice becomes the post\'s two background fields', () => {
  assert.deepEqual(m.NO_BACKGROUND, { type: 'none', url: '' });
  assert.deepEqual(m.stockBackground('river'), { type: 'photo', url: '/backgrounds/river.jpg' });
  assert.deepEqual(m.stockBackground('nope'), { type: 'none', url: '' });
  assert.deepEqual(m.uploadedBackground('video', `/uploads/${NAME}.mp4`), { type: 'video', url: `/uploads/${NAME}.mp4` });
  assert.deepEqual(m.uploadedBackground('photo', `/uploads/${NAME}.jpg`), { type: 'photo', url: `/uploads/${NAME}.jpg` });
});

await test('upload progress: a whole percent between 0 and 100, whatever the numbers', () => {
  assert.equal(m.uploadPercent(0, 1000), 0);
  assert.equal(m.uploadPercent(333, 1000), 33);
  assert.equal(m.uploadPercent(1000, 1000), 100);
  assert.equal(m.uploadPercent(1200, 1000), 100);
  assert.equal(m.uploadPercent(5, 0), 0);
  assert.equal(m.uploadPercent(5, -1), 0);
  assert.equal(m.uploadPercent(NaN, 10), 0);
});

await test('the date on the card: day, month and year in capitals, as the website prints it', () => {
  assert.equal(m.cardDate(new Date(2026, 10, 27, 12, 0).toISOString()), '27 NOV 2026');
  assert.equal(m.cardDate(new Date(2027, 0, 3, 12, 0).toISOString()), '03 JAN 2027');
  assert.equal(m.cardDate(null), '');
  assert.equal(m.cardDate('not a date'), '');
});

done('social media rules');
