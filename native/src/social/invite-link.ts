/** A friend invite link opened in the app: /friends?add=<handle>, as a universal link, an
 * Android app link or vantrarun://friends?add=<handle>. Plain TypeScript, no device or
 * network code. The rule is the website's (web/src/pages/Friends.jsx): look the handle up and
 * send that person one friend request, never to yourself.
 *
 * Anyone can write such a link, so the handle is only ever used after cleanHandle, and only
 * as a value: in the body of a lookup, or as a route parameter the router encodes.
 */
import { cleanHandle, connectionWith, type Connection, type SocialProfile } from './logic';

/** The handle a link names, cleaned. Empty when there is none worth acting on. */
export function inviteHandle(add: unknown): string {
  const first = Array.isArray(add) ? add[0] : add;
  return typeof first === 'string' ? cleanHandle(first) : '';
}

export const inviteKey = (meId: string, handle: string) => `${meId}:${handle}`;

export type InviteStep =
  /** No link. */
  | { kind: 'none' }
  /** The account or its connections are not loaded yet. */
  | { kind: 'wait' }
  /** This link was already dealt with for this account since the app started. */
  | { kind: 'done' }
  | { kind: 'self' }
  | { kind: 'lookup'; handle: string }
  | { kind: 'missing'; handle: string }
  | { kind: 'already'; target: SocialProfile; connection: Connection }
  | { kind: 'send'; target: SocialProfile };

/** What to do about the link, one step at a time. `found` is left out until the handle has
 * been looked up, then the profile or null. A request is sent only on `send`: a found profile
 * that is not yours, with no connection between you in either direction or any state, for a
 * link not already dealt with. */
export function inviteStep(input: {
  add: unknown;
  me: { id: string; handle: string } | null;
  connections: Connection[] | null;
  handled: readonly string[];
  found?: SocialProfile | null;
}): InviteStep {
  const handle = inviteHandle(input.add);
  if (!handle) return { kind: 'none' };
  const { me, connections, found } = input;
  if (!me || !connections) return { kind: 'wait' };
  if (input.handled.includes(inviteKey(me.id, handle))) return { kind: 'done' };
  if (handle === cleanHandle(me.handle)) return { kind: 'self' };
  if (found === undefined) return { kind: 'lookup', handle };
  if (found && found.ownerId === me.id) return { kind: 'self' };
  if (!found || found.handle !== handle) return { kind: 'missing', handle };
  const connection = connectionWith(connections, me.id, found.ownerId);
  return connection ? { kind: 'already', target: found, connection } : { kind: 'send', target: found };
}

// ---- kept while the app is open: never written to the phone ------------------------------

/** A link opened by someone signed out waits this long for them to sign in. */
const WAIT_MS = 30 * 60 * 1000;
let waiting: { handle: string; at: number } | null = null;
const handled: string[] = [];

/** Called with whatever `add` the Friends route was opened with, before the access gate. */
export function rememberInvite(add: unknown, nowMs: number): void {
  const handle = inviteHandle(add);
  if (handle) waiting = { handle, at: nowMs };
}

export function pendingInvite(nowMs: number): string {
  if (waiting && nowMs - waiting.at > WAIT_MS) waiting = null;
  return waiting?.handle ?? '';
}

export function forgetInvite(): void {
  waiting = null;
}

export function markInviteHandled(meId: string, handle: string): void {
  const key = inviteKey(meId, handle);
  if (!handled.includes(key)) handled.push(key);
}

export function handledInvites(): readonly string[] {
  return handled;
}

/** For tests. */
export function resetInvites(): void {
  waiting = null;
  handled.length = 0;
}

/** Screens that are never left for an invite link: a run being started, recorded or reviewed. */
const NEVER_LEFT = ['/run-start', '/run-live', '/run-summary'];

/** Where the access gate sends someone who opened a link before they could use the app: the
 * Friends screen, with the cleaned handle. The destination is fixed; a link cannot choose it. */
export function inviteRedirect(path: string, nowMs: number): { pathname: '/friends'; params: { add: string } } | null {
  const handle = pendingInvite(nowMs);
  if (!handle || path === '/friends' || NEVER_LEFT.includes(path)) return null;
  return { pathname: '/friends', params: { add: handle } };
}

// ---- what the person is told -------------------------------------------------------------

export type InviteNews =
  | { kind: 'looking'; handle: string }
  | { kind: 'sending'; target: SocialProfile }
  | { kind: 'sent'; target: SocialProfile; status: Connection['status'] }
  | { kind: 'self' }
  | { kind: 'missing'; handle: string }
  | { kind: 'already'; target: SocialProfile; connection: Connection };

export function inviteMessage(news: InviteNews, meId = ''): string {
  switch (news.kind) {
    case 'looking':
      return `Opening the invite link from @${news.handle}…`;
    case 'sending':
      return `Sending a friend request to ${news.target.displayName ? `${news.target.displayName} (@${news.target.handle})` : `@${news.target.handle}`}…`;
    case 'sent':
      return news.status === 'accepted'
        ? `You're connected with @${news.target.handle}.`
        : `Friend request sent to @${news.target.handle}. You'll be connected when they accept it.`;
    case 'self':
      return 'That is your own invite link. Share it with someone you want to run with.';
    case 'missing':
      return `Nobody on VantraRun has the handle @${news.handle}. Check the link with whoever sent it.`;
    case 'already': {
      const who = `@${news.target.handle}`;
      if (news.connection.status === 'accepted') return `You and ${who} are already friends.`;
      if (news.connection.status === 'declined') return `A friend request between you and ${who} was declined, so no new one was sent.`;
      return news.connection.fromUserId === meId
        ? `You already sent ${who} a friend request. It is waiting for them to accept.`
        : `${who} already sent you a friend request. Accept it under Requests.`;
    }
  }
}
