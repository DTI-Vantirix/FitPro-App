// Which address a request is counted against (rate limits). No database, no network.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clientIp, forwardedFor, trustedProxyHops } from '../src/lib/http.js';

const request = (forwarded, socket = '10.0.0.9') => ({
  headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  socket: { remoteAddress: socket },
});

describe('clientIp', () => {
  test('without TRUST_PROXY the header is ignored, whatever else is set', () => {
    assert.equal(clientIp(request('1.1.1.1, 2.2.2.2'), {}), '10.0.0.9');
    assert.equal(clientIp(request('1.1.1.1, 2.2.2.2'), { TRUST_PROXY: 'false', TRUSTED_PROXY_HOPS: '1' }), '10.0.0.9');
    assert.equal(clientIp({ headers: {}, socket: {} }, {}), 'unknown');
  });

  test('with TRUST_PROXY and no TRUSTED_PROXY_HOPS it is the leftmost entry, exactly as before', () => {
    const env = { TRUST_PROXY: 'true' };
    assert.equal(clientIp(request('1.1.1.1, 2.2.2.2, 3.3.3.3'), env), '1.1.1.1');
    assert.equal(clientIp(request(' 4.4.4.4 '), env), '4.4.4.4');
    assert.equal(clientIp(request(undefined), env), '10.0.0.9');
    assert.equal(clientIp(request(''), env), '10.0.0.9');
    assert.equal(clientIp(request('1.1.1.1'), { ...env, TRUSTED_PROXY_HOPS: '' }), '1.1.1.1', 'empty counts as unset');
  });

  test('TRUSTED_PROXY_HOPS=n takes the nth entry from the right, which a client cannot forge', () => {
    const one = { TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: '1' };
    // the client sent "9.9.9.9" itself; the one proxy in front of us appended the real address
    assert.equal(clientIp(request('9.9.9.9, 203.0.113.7'), one), '203.0.113.7');
    assert.equal(clientIp(request('203.0.113.7'), one), '203.0.113.7');
    const two = { TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: '2' };
    assert.equal(clientIp(request('9.9.9.9, 8.8.8.8, 203.0.113.7, 172.16.0.1'), two), '203.0.113.7');
    assert.equal(clientIp(request('203.0.113.7, 172.16.0.1'), two), '203.0.113.7');
  });

  test('a list shorter than the hops falls back to the socket address', () => {
    const two = { TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: '2' };
    assert.equal(clientIp(request('203.0.113.7'), two), '10.0.0.9');
    assert.equal(clientIp(request(undefined), two), '10.0.0.9');
    assert.equal(clientIp(request(' , '), two), '10.0.0.9');
  });

  test('a value that is not a whole number of 1 or more trusts no entry at all', () => {
    for (const bad of ['0', '-1', '1.5', 'two', '1e3']) {
      assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: bad }), 0, bad);
      assert.equal(clientIp(request('9.9.9.9, 203.0.113.7'), { TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: bad }), '10.0.0.9', bad);
    }
    assert.equal(trustedProxyHops({}), null);
    assert.equal(trustedProxyHops({ TRUSTED_PROXY_HOPS: ' 2 ' }), 2);
  });

  test('forwardedFor lists the entries as received', () => {
    assert.deepEqual(forwardedFor(request('1.1.1.1,  2.2.2.2 ,3.3.3.3')), ['1.1.1.1', '2.2.2.2', '3.3.3.3']);
    assert.deepEqual(forwardedFor(request(undefined)), []);
  });
});
