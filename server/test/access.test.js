// The parts of the access check that need no database: is one entitlement row
// still good at a given moment.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GRACE_DAYS, isLive } from '../src/access.js';

const NOW = new Date('2026-11-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const row = (status, days) => ({ status, expires_at: days === undefined ? null : daysFromNow(days) });

describe('isLive', () => {
  test('the renewal allowance is three days', () => {
    assert.equal(GRACE_DAYS, 3);
  });

  test('active with no expiry is live', () => {
    assert.equal(isLive(row('active'), NOW), true);
  });

  test('active and expiring tomorrow is live', () => {
    assert.equal(isLive(row('active', 1), NOW), true);
  });

  test('expired two days ago is still live: the allowance covers a late renewal notice', () => {
    assert.equal(isLive(row('active', -2), NOW), true);
  });

  test('expired four days ago is not live', () => {
    assert.equal(isLive(row('active', -4), NOW), false);
  });

  test('the allowance ends exactly three days after the expiry', () => {
    const expires = new Date(NOW.getTime() - GRACE_DAYS * DAY);
    assert.equal(isLive({ status: 'active', expires_at: expires }, NOW), true, 'on the last moment');
    assert.equal(isLive({ status: 'active', expires_at: new Date(expires.getTime() - 1000) }, NOW), false, 'one second later');
  });

  test('revoked and expired are never live, whatever the date says', () => {
    for (const status of ['revoked', 'expired']) {
      assert.equal(isLive(row(status), NOW), false, `${status}, no expiry`);
      assert.equal(isLive(row(status, 30), NOW), false, `${status}, expiring in a month`);
    }
  });

  test('trial and grace follow the same date rule as active', () => {
    for (const status of ['trial', 'grace']) {
      assert.equal(isLive(row(status), NOW), true, `${status}, no expiry`);
      assert.equal(isLive(row(status, 1), NOW), true, `${status}, expiring tomorrow`);
      assert.equal(isLive(row(status, -2), NOW), true, `${status}, expired two days ago`);
      assert.equal(isLive(row(status, -4), NOW), false, `${status}, expired four days ago`);
    }
  });

  test('a date as a Date object or as text gives the same answer', () => {
    assert.equal(isLive({ status: 'active', expires_at: new Date(daysFromNow(-4)) }, NOW), false);
    assert.equal(isLive({ status: 'active', expires_at: new Date(daysFromNow(1)) }, NOW), true);
  });

  test('a missing row, an unknown status or an unreadable date is not live', () => {
    assert.equal(isLive(null, NOW), false);
    assert.equal(isLive({ status: 'paused', expires_at: null }, NOW), false);
    assert.equal(isLive({ status: 'active', expires_at: 'not a date' }, NOW), false);
  });

  test('without a given moment it uses the current time', () => {
    assert.equal(isLive({ status: 'active', expires_at: new Date(Date.now() + DAY) }), true);
    assert.equal(isLive({ status: 'active', expires_at: new Date(Date.now() - 4 * DAY) }), false);
  });
});
