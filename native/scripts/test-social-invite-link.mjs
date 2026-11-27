import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const v = load('src/social/invite-link.ts');
const profile = (extra = {}) => ({ id: 'p2', ownerId: 'u2', handle: 'ben.k', displayName: 'Ben K', bio: '', avatarUrl: '', visibility: 'private', ...extra });
const link = (extra = {}) => ({ id: 'c1', fromUserId: 'u1', toUserId: 'u2', fromHandle: 'ana.r', fromName: 'Ana R', toHandle: 'ben.k', toName: 'Ben K', status: 'pending', ...extra });
const me = { id: 'u1', handle: 'ana.r' };
const step = (extra = {}) => v.inviteStep({ add: 'ben.k', me, connections: [], handled: [], ...extra });

await test('the handle in a link is cleaned before anything uses it', () => {
  assert.equal(v.inviteHandle('Ben.K'), 'ben.k');
  assert.equal(v.inviteHandle('@ben.k'), 'ben.k');
  assert.equal(v.inviteHandle(' ben.k&role=admin#x '), 'ben.kroleadminx');
  assert.equal(v.inviteHandle('../../api/auth/me?x=1'), '....apiauthmex1');
  assert.equal(v.inviteHandle('a'.repeat(200)).length, 24);
  assert.equal(v.inviteHandle(['ben.k', 'other']), 'ben.k');
  for (const nothing of [undefined, null, '', '   ', '%%%', [], {}, 42]) assert.equal(v.inviteHandle(nothing), '', String(nothing));
});

await test('no link, or not ready yet: nothing happens', () => {
  assert.deepEqual(step({ add: undefined }), { kind: 'none' });
  assert.deepEqual(step({ add: '!!!' }), { kind: 'none' });
  assert.deepEqual(step({ me: null }), { kind: 'wait' });
  assert.deepEqual(step({ connections: null }), { kind: 'wait' });
});

await test('your own invite link never sends a request', () => {
  assert.deepEqual(step({ add: 'Ana.R' }), { kind: 'self' });
  // The handle differs (you changed yours since) but the profile found is still your own.
  assert.deepEqual(step({ add: 'old.ana', found: profile({ ownerId: 'u1', handle: 'old.ana' }) }), { kind: 'self' });
});

await test('the profile is looked up first, by the cleaned handle', () => {
  assert.deepEqual(step({ add: '@Ben.K' }), { kind: 'lookup', handle: 'ben.k' });
});

await test('nobody with that handle: nothing is sent', () => {
  assert.deepEqual(step({ found: null }), { kind: 'missing', handle: 'ben.k' });
  // A lookup that answers with somebody else is not trusted either.
  assert.deepEqual(step({ found: profile({ handle: 'ben.kk' }) }), { kind: 'missing', handle: 'ben.k' });
});

await test('a found profile with no connection yet gets one request', () => {
  const target = profile();
  assert.deepEqual(step({ found: target }), { kind: 'send', target });
});

await test('a connection that already exists, in either direction and any state, is never sent again', () => {
  const target = profile();
  for (const existing of [link(), link({ status: 'accepted' }), link({ status: 'declined' }), link({ fromUserId: 'u2', toUserId: 'u1' })]) {
    assert.deepEqual(step({ found: target, connections: [existing] }), { kind: 'already', target, connection: existing });
  }
  // Somebody else's connection does not count.
  assert.equal(step({ found: target, connections: [link({ toUserId: 'u3' })] }).kind, 'send');
});

await test('a link already dealt with for this account does nothing more, whatever changed since', () => {
  const handled = [v.inviteKey('u1', 'ben.k')];
  assert.deepEqual(step({ handled }), { kind: 'done' });
  assert.deepEqual(step({ handled, found: profile() }), { kind: 'done' });
  assert.deepEqual(step({ handled, add: 'BEN.K' }), { kind: 'done' });
  // Another account on the same phone, or another handle, is a different link.
  assert.equal(step({ handled: [v.inviteKey('u9', 'ben.k')] }).kind, 'lookup');
  assert.equal(step({ handled: [v.inviteKey('u1', 'cy.d')] }).kind, 'lookup');
});

await test('a re-render or the same link opened again in this session does not send twice', () => {
  v.resetInvites();
  const target = profile();
  const next = () => v.inviteStep({ add: 'ben.k', me, connections: [], handled: v.handledInvites(), found: target });
  assert.equal(next().kind, 'send');
  v.markInviteHandled('u1', 'ben.k');
  assert.equal(next().kind, 'done');
  assert.equal(next().kind, 'done');
  // The request was cancelled afterwards: the list is empty again, and still nothing is sent.
  assert.equal(v.inviteStep({ add: 'ben.k', me, connections: [], handled: v.handledInvites() }).kind, 'done');
  v.resetInvites();
});

await test('a link opened while signed out is kept, cleaned, until Friends is reached', () => {
  v.resetInvites();
  assert.equal(v.pendingInvite(1000), '');
  v.rememberInvite('@Ben.K<script>', 1000);
  assert.equal(v.pendingInvite(2000), 'ben.kscript');
  // Opening Friends with no link does not forget one that is waiting.
  v.rememberInvite(undefined, 3000);
  assert.equal(v.pendingInvite(3000), 'ben.kscript');
  // A newer link replaces it.
  v.rememberInvite('cy.d', 4000);
  assert.equal(v.pendingInvite(4000), 'cy.d');
  // It does not wait for ever: 30 minutes.
  assert.equal(v.pendingInvite(4000 + 30 * 60 * 1000), 'cy.d');
  assert.equal(v.pendingInvite(4001 + 30 * 60 * 1000), '');
  v.rememberInvite('cy.d', 5000);
  v.forgetInvite();
  assert.equal(v.pendingInvite(5000), '');
});

await test('where the gate sends someone who has a link waiting', () => {
  v.resetInvites();
  assert.equal(v.inviteRedirect('/home', 1000), null);
  v.rememberInvite('ben.k', 1000);
  assert.deepEqual(v.inviteRedirect('/home', 2000), { pathname: '/friends', params: { add: 'ben.k' } });
  assert.deepEqual(v.inviteRedirect('/feed', 2000), { pathname: '/friends', params: { add: 'ben.k' } });
  // Already there: no redirect, or it would loop.
  assert.equal(v.inviteRedirect('/friends', 2000), null);
  // A run in progress is never interrupted.
  for (const path of ['/run-start', '/run-live', '/run-summary']) assert.equal(v.inviteRedirect(path, 2000), null);
  v.resetInvites();
});

await test('what the person is told', () => {
  const target = profile();
  assert.equal(v.inviteMessage({ kind: 'looking', handle: 'ben.k' }), 'Opening the invite link from @ben.k…');
  assert.equal(v.inviteMessage({ kind: 'sending', target }), 'Sending a friend request to Ben K (@ben.k)…');
  assert.equal(v.inviteMessage({ kind: 'sending', target: profile({ displayName: '' }) }), 'Sending a friend request to @ben.k…');
  assert.equal(v.inviteMessage({ kind: 'sent', target, status: 'accepted' }), 'You\'re connected with @ben.k.');
  assert.equal(v.inviteMessage({ kind: 'sent', target, status: 'pending' }), 'Friend request sent to @ben.k. You\'ll be connected when they accept it.');
  assert.equal(v.inviteMessage({ kind: 'self' }), 'That is your own invite link. Share it with someone you want to run with.');
  assert.equal(v.inviteMessage({ kind: 'missing', handle: 'ben.k' }), 'Nobody on VantraRun has the handle @ben.k. Check the link with whoever sent it.');
  assert.equal(v.inviteMessage({ kind: 'already', target, connection: link({ status: 'accepted' }) }, 'u1'), 'You and @ben.k are already friends.');
  assert.equal(v.inviteMessage({ kind: 'already', target, connection: link() }, 'u1'), 'You already sent @ben.k a friend request. It is waiting for them to accept.');
  assert.equal(v.inviteMessage({ kind: 'already', target, connection: link({ fromUserId: 'u2', toUserId: 'u1' }) }, 'u1'), '@ben.k already sent you a friend request. Accept it under Requests.');
  assert.equal(v.inviteMessage({ kind: 'already', target, connection: link({ status: 'declined' }) }, 'u1'), 'A friend request between you and @ben.k was declined, so no new one was sent.');
});

done('invite links');
