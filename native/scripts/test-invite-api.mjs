import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/access/invite-api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const calls = [];
let nextStatus = 200;
let nextData = { allowed: false };
const module = { exports: {} };
const context = {
  module,
  exports: module.exports,
  require: (id) => {
    assert.equal(id, '../config');
    return { API_URL: 'http://192.168.1.50:4000' };
  },
  setTimeout, clearTimeout, AbortController,
  fetch: async (url, options) => {
    calls.push({ url, options });
    return { status: nextStatus, ok: nextStatus >= 200 && nextStatus < 300, text: async () => JSON.stringify(nextData) };
  },
};
vm.runInNewContext(compiled.outputText, vm.createContext(context));
const { getInviteStatus, redeemInviteCode } = module.exports;

let result = await getInviteStatus('test-user-token');
assert.equal(result.allowed, false);
assert.equal(calls[0].url, 'http://192.168.1.50:4000/api/functions/inviteAccess');
assert.equal(calls[0].options.headers.Authorization, 'Bearer test-user-token');
assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'status' });

nextData = { allowed: true };
result = await redeemInviteCode('test-user-token', ' abcd-1234 ');
assert.equal(result.allowed, true);
assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'redeem', code: 'ABCD-1234' });

nextData = { allowed: false, error: 'That code has already been used.' };
result = await redeemInviteCode('test-user-token', 'USED');
assert.equal(result.allowed, false);
assert.equal(result.error, 'That code has already been used.');

nextStatus = 401;
nextData = { error: 'Unauthorized' };
await assert.rejects(getInviteStatus('expired'), /HTTP 401: Unauthorized/);

nextStatus = 200;
nextData = { unknown: true };
await assert.rejects(getInviteStatus('test-user-token'), /did not include allowed: boolean/);

assert.equal(calls.length, 5);
console.log('PASS: invite status, auth header, code normalization, used-code rejection, 401, and missing allowed fail-closed.');
