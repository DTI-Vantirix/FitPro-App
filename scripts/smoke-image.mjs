// Checks a running copy of the production image end to end:
//   node scripts/smoke-image.mjs http://127.0.0.1:10000 owner@example.com 'the-admin-password'
// The admin account is the one ADMIN_EMAIL / ADMIN_PASSWORD created at start-up.
// It leaves behind one uploaded test image and one unused invite code, so point it
// at a throwaway database, not the live one.
import assert from 'node:assert/strict';

const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) {
  console.error('usage: node scripts/smoke-image.mjs <base-url> <admin-email> <admin-password>');
  process.exit(2);
}

const json = { 'Content-Type': 'application/json' };

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok && (await res.json()).ok === true) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The API did not become healthy within 60 seconds.');
}

await waitForHealth();
console.log('ok  API is healthy and reaches its database');

for (const page of ['/', '/privacy', '/login']) {
  const res = await fetch(base + page);
  const html = await res.text();
  assert.equal(res.status, 200, `${page} -> ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /text\/html/, `${page} is not HTML`);
  assert.match(html, /<div id="root">/, `${page} is not the website`);
}
console.log('ok  the website is served, including the public privacy page');

const missing = await fetch(`${base}/api/nope`);
assert.equal(missing.status, 404);
assert.match(missing.headers.get('content-type') || '', /json/);

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password }) });
const session = await login.json();
assert.equal(login.status, 200, `admin sign-in -> ${login.status} ${JSON.stringify(session)}`);
assert.equal(session.user.role, 'admin');
console.log('ok  the first admin exists and can sign in');
const auth = { Authorization: `Bearer ${session.access_token}` };
const admin = (name, body) => fetch(`${base}/api/functions/${name}`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify(body) });

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const upload = await fetch(`${base}/api/uploads`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: png });
const uploaded = await upload.json();
assert.equal(upload.status, 201, `upload -> ${upload.status} ${JSON.stringify(uploaded)}`);
const back = await fetch(new URL(uploaded.file_url, base));
assert.equal(back.status, 200);
assert.deepEqual(Buffer.from(await back.arrayBuffer()), png);
console.log('ok  an upload is stored and read back');

const codes = await admin('adminInviteCodes', { action: 'generate', count: 1, note: 'smoke test' });
assert.equal(codes.status, 200, `invite code -> ${codes.status}`);
console.log('ok  the admin can create an invite code');

// In production the emailed code must never come back in a reply.
const register = await fetch(`${base}/api/auth/register`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ email: 'nobody@example.com', password: 'not-a-real-account', invite_code: 'FP-NOPE-NOPE' }),
});
assert.equal(register.status, 400);
assert.equal((await register.json()).dev_code, undefined);

const crash = await admin('adminClientErrors', { action: 'test-crash' });
assert.equal(crash.status, 500);
assert.equal((await crash.json()).error, 'Something went wrong on our side.');
await new Promise((r) => setTimeout(r, 500));
const listed = await (await admin('adminClientErrors', { action: 'list' })).json();
const recorded = listed.errors.filter((item) => item.platform === 'server').some((item) => item.message.includes('Test error'));
assert.ok(recorded, 'the server error was not recorded');
await admin('adminClientErrors', { action: 'clear' });
console.log('ok  an unexpected error is hidden from the caller and recorded for the admin');

console.log('\nImage smoke test passed.');
