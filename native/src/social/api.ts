/** Everything the Feed, Friends and Challenges screens ask of the VantraRun API. These are
 * the calls the website makes (web/src/lib/social.js, its social and challenge components),
 * to the same routes, with the same bodies; nothing here is new on the server and nothing
 * goes to any other host. Who may read or change a record is decided by the server.
 * Run and workout records are never touched from here: a post is made from a run that
 * src/run/api.ts has already read.
 *
 * A post's photo or video goes to the server's own upload route (uploadMedia) and nowhere
 * else, and only when the composer calls it: after the runner taps Post.
 */
import { API_URL, APP_AUTH_URL, FUNCTIONS_URL, UPLOADS_URL } from '../config';
import { ApiError, entityUrl, items, num, record, request, str, toPath } from '../run/api';
import { visibleChallenges, type Board, type BoardRow, type Challenge, type ChallengeRecord } from './challenges';
import { BAD_TYPE, UPLOAD_TYPES, mediaUrl, uploadPercent } from './media';
import { HANDLE_TAKEN, defaultHandleBase, requestStatusFor, visiblePosts, type Connection, type Post, type ProfileValues, type SocialProfile } from './logic';

export type Account = { id: string; email: string; fullName: string };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const idUrl = (name: string, id: string) => entityUrl(name, `/${encodeURIComponent(id)}`);
const query = (token: string, name: string, body: Record<string, unknown>) => request('POST', entityUrl(name, '/query'), { token, body });

// ---- account and social profile ---------------------------------------------------------

export async function fetchAccount(token: string): Promise<Account> {
  const data = record(await request('GET', `${APP_AUTH_URL}/me`, { token }));
  if (typeof data.id !== 'string' || !data.id) throw new ApiError('The server did not return your account.', 0);
  return { id: data.id, email: text(data.email), fullName: text(data.full_name) };
}

function toProfile(row: Record<string, unknown>): SocialProfile | null {
  const id = str(row.id);
  const ownerId = str(row.created_by_id);
  const handle = str(row.handle);
  if (!id || !ownerId || !handle) return null;
  return { id, ownerId, handle, displayName: text(row.display_name), bio: text(row.bio), avatarUrl: text(row.avatar_url),
    visibility: row.visibility === 'public' ? 'public' : 'private' };
}

export async function findProfileByHandle(token: string, handle: string): Promise<SocialProfile | null> {
  const [row] = items(await query(token, 'SocialProfile', { q: { handle }, limit: 1 }));
  return row ? toProfile(row) : null;
}

const profileLoads = new Map<string, Promise<SocialProfile>>();

/** The runner's social profile. The first time, one is created — private, with a handle made
 * from their name — exactly as the website does on its Feed, Friends and Challenges pages. */
export function loadMyProfile(token: string, account: Account, random: () => number = Math.random): Promise<SocialProfile> {
  const key = `${account.id}:${token.slice(-24)}`;
  const running = profileLoads.get(key);
  if (running) return running;
  const load = (async () => {
    const [row] = items(await query(token, 'SocialProfile', { q: { created_by_id: account.id }, limit: 1 }));
    const existing = row ? toProfile(row) : null;
    if (existing) return existing;
    let handle = defaultHandleBase(account);
    if (await findProfileByHandle(token, handle)) handle = `${handle}${Math.floor(1000 + random() * 9000)}`;
    const created = toProfile(record(await request('POST', entityUrl('SocialProfile'), { token,
      body: { handle, display_name: account.fullName || handle, visibility: 'private' } })));
    if (!created) throw new ApiError('The server did not confirm your social profile. Try again.', 0);
    return created;
  })().finally(() => { profileLoads.delete(key); });
  profileLoads.set(key, load);
  return load;
}

/** Saves the profile editor. A handle someone else holds is refused with the website's words,
 * whether the check or the server's own unique rule catches it. */
export async function saveProfile(token: string, profile: SocialProfile, values: ProfileValues): Promise<SocialProfile> {
  const taken = await findProfileByHandle(token, values.handle);
  if (taken && taken.id !== profile.id) throw new ApiError(HANDLE_TAKEN, 409);
  let data: unknown;
  try {
    data = await request('PUT', idUrl('SocialProfile', profile.id), { token, body: values });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) throw new ApiError(HANDLE_TAKEN, 409);
    throw cause;
  }
  return toProfile({ created_by_id: profile.ownerId, ...record(data) }) ?? { ...profile, handle: values.handle, displayName: values.display_name, bio: values.bio, visibility: values.visibility };
}

/** The directory the friend search looks through, as the website's search loads it. */
export async function listProfiles(token: string): Promise<SocialProfile[]> {
  return items(await query(token, 'SocialProfile', { q: {}, limit: 100 })).map(toProfile).filter((p): p is SocialProfile => p !== null);
}

// ---- feed and posts ---------------------------------------------------------------------

function toPost(row: Record<string, unknown>): Post | null {
  const id = str(row.id);
  const ownerId = str(row.created_by_id);
  if (!id || !ownerId) return null;
  return {
    id,
    ownerId,
    createdAt: str(row.created_date),
    kind: text(row.kind) || 'run',
    title: text(row.title),
    caption: text(row.caption),
    distanceMi: num(row.distance_mi) ?? 0,
    durationSec: num(row.duration_sec) ?? 0,
    avgPaceSec: num(row.avg_pace_sec) ?? 0,
    zoneName: text(row.zone_name),
    routePoints: toPath(row.route_points),
    visibility: text(row.visibility) || 'friends',
    authorHandle: text(row.author_handle),
    authorName: text(row.author_name),
    ...background(row),
  };
}

function background(row: Record<string, unknown>): Pick<Post, 'backgroundType' | 'backgroundUrl'> {
  const type = row.background_type;
  const url = text(row.background_url);
  return (type === 'photo' || type === 'video') && url ? { backgroundType: type, backgroundUrl: url } : { backgroundType: 'none', backgroundUrl: '' };
}

const posts = (rows: unknown): Post[] =>
  visiblePosts((Array.isArray(rows) ? rows : []).map((row) => toPost(record(row))).filter((p): p is Post => p !== null));

/** Your circle: your own posts and your accepted friends' posts that are not private. The
 * server picks them; the phone sends nothing but the sign-in. */
export async function loadFeed(token: string): Promise<Post[]> {
  return posts(record(await request('POST', `${FUNCTIONS_URL}/socialFeed`, { token, body: {} })).posts);
}

/** Discover: posts their authors made public. */
export async function loadDiscover(token: string): Promise<Post[]> {
  const rows = items(await query(token, 'Post', { q: { visibility: 'public' }, sort: '-created_date', limit: 30 }));
  return posts(rows).filter((post) => post.visibility === 'public');
}

/** Creates a post from the record buildPost made (src/social/logic.ts). */
export async function createPost(token: string, payload: Record<string, unknown>): Promise<Post> {
  const post = toPost(record(await request('POST', entityUrl('Post'), { token, body: payload })));
  if (!post) throw new ApiError('The server did not confirm the post. Check your feed before posting it again.', 0);
  return post;
}

/** Sends one file's bytes. The app's sender is src/social/upload-file.ts; tests pass their own. */
export type SendFile = (request: {
  url: string;
  uri: string;
  mimeType: string;
  headers: Record<string, string>;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}) => Promise<{ status: number; body: string }>;

/** Uploads the photo or video of a post the way the website does: the file's own bytes as
 * the body of a POST to the upload route (UPLOADS_URL), its type in Content-Type, the sign-in as a bearer token.
 * Returns the address the server stored it at, which is what the post then names. Nothing
 * about the file but its bytes and type is sent: no name, no album, no place. */
export async function uploadMedia(token: string, file: { uri: string; mimeType: string }, send: SendFile,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {}): Promise<string> {
  if (!API_URL) throw new ApiError('EXPO_PUBLIC_API_URL is not set. Add it to native/.env and restart Expo.', 0);
  if (!token) throw new ApiError('You are signed out. Sign in again.', 0);
  if (!file.uri || !UPLOAD_TYPES[file.mimeType]) throw new ApiError(BAD_TYPE, 0);
  const { onProgress, signal } = options;
  let reply: { status: number; body: string };
  try {
    reply = await send({
      url: UPLOADS_URL,
      uri: file.uri,
      mimeType: file.mimeType,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': file.mimeType },
      ...(onProgress ? { onProgress: (sent: number, total: number) => onProgress(uploadPercent(sent, total)) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) throw new ApiError('The upload was cancelled.', 0);
    throw new ApiError("Can't reach VantraRun. Check your connection and try again.", 0);
  }
  let data: unknown = null;
  try {
    data = reply.body ? JSON.parse(reply.body) : null;
  } catch {
    data = null;
  }
  if (reply.status < 200 || reply.status >= 300) {
    const error = record(data).error;
    throw new ApiError(typeof error === 'string' && error ? error : reply.status === 413 ? 'That upload is too large.' : `Request failed (${reply.status}).`, reply.status, data);
  }
  const fileUrl = record(data).file_url;
  if (typeof fileUrl !== 'string' || !mediaUrl(API_URL, fileUrl)) throw new ApiError('The server did not say where it stored the file. Try again.', 0);
  return fileUrl;
}

export async function deletePost(token: string, postId: string): Promise<void> {
  await request('DELETE', idUrl('Post', postId), { token });
}

// ---- friends ----------------------------------------------------------------------------

function toConnection(row: Record<string, unknown>): Connection | null {
  const id = str(row.id);
  const fromUserId = str(row.from_user_id);
  const toUserId = str(row.to_user_id);
  if (!id || !fromUserId || !toUserId) return null;
  return { id, fromUserId, toUserId, fromHandle: text(row.from_handle), fromName: text(row.from_name), toHandle: text(row.to_handle), toName: text(row.to_name),
    status: row.status === 'accepted' ? 'accepted' : row.status === 'declined' ? 'declined' : 'pending' };
}

/** Every connection the runner is one side of. */
export async function loadConnections(token: string, userId: string): Promise<Connection[]> {
  const rows = items(await query(token, 'Connection', { q: { $or: [{ from_user_id: userId }, { to_user_id: userId }] }, sort: '-created_date', limit: 200 }));
  return rows.map(toConnection).filter((c): c is Connection => c !== null);
}

/** Sends a friend request, unless the two are already connected or one is waiting, in either
 * direction: then that connection is returned and nothing is written. */
export async function sendRequest(token: string, input: { meId: string; myProfile: SocialProfile; target: SocialProfile }): Promise<Connection> {
  const { meId, myProfile, target } = input;
  if (target.ownerId === meId) throw new ApiError('You cannot send a request to yourself.', 0);
  const [found] = items(await query(token, 'Connection', { q: { $or: [{ from_user_id: meId, to_user_id: target.ownerId }, { from_user_id: target.ownerId, to_user_id: meId }] }, limit: 1 }))
    .map(toConnection);
  if (found) return found;
  const created = toConnection(record(await request('POST', entityUrl('Connection'), { token, body: {
    from_user_id: meId,
    to_user_id: target.ownerId,
    from_handle: myProfile.handle,
    from_name: myProfile.displayName || myProfile.handle,
    to_handle: target.handle,
    to_name: target.displayName || target.handle,
    status: requestStatusFor(target),
  } })));
  if (!created) throw new ApiError('The server did not confirm the request. Pull down to check before sending it again.', 0);
  return created;
}

export async function acceptConnection(token: string, connectionId: string): Promise<void> {
  await request('PUT', idUrl('Connection', connectionId), { token, body: { status: 'accepted' } });
}

/** Declines a request, cancels one that was sent, or ends a friendship: the record is deleted. */
export async function removeConnection(token: string, connectionId: string): Promise<void> {
  await request('DELETE', idUrl('Connection', connectionId), { token });
}

// ---- challenges -------------------------------------------------------------------------

function toChallenge(row: Record<string, unknown>): Challenge | null {
  const id = str(row.id);
  const name = str(row.name);
  if (!id || !name) return null;
  return { id, ownerId: text(row.created_by_id), name, description: text(row.description), metric: text(row.metric) || 'distance',
    targetValue: num(row.target_value) ?? 0, month: text(row.month), startDate: str(row.start_date), endDate: str(row.end_date) };
}

export async function listChallenges(token: string): Promise<Challenge[]> {
  const rows = items(await query(token, 'Challenge', { q: {}, sort: '-created_date', limit: 30 }));
  return visibleChallenges(rows.map(toChallenge).filter((c): c is Challenge => c !== null));
}

/** Ids of the challenges the runner has joined. */
export async function listJoinedIds(token: string, userId: string): Promise<string[]> {
  return items(await query(token, 'ChallengeMember', { q: { user_id: userId }, limit: 100 })).flatMap((row) => (str(row.challenge_id) ? [str(row.challenge_id) as string] : []));
}

export async function createChallenge(token: string, challenge: ChallengeRecord): Promise<Challenge> {
  const created = toChallenge(record(await request('POST', entityUrl('Challenge'), { token, body: challenge })));
  if (!created) throw new ApiError('The server did not confirm the challenge. Check the list before creating it again.', 0);
  return created;
}

/** A challenge and its leaderboard. The server adds up each member's one number; no run,
 * route or time of anyone's is in the answer. */
export async function loadBoard(token: string, challengeId: string): Promise<Board> {
  const data = record(await request('POST', `${FUNCTIONS_URL}/challengeBoard`, { token, body: { challenge_id: challengeId } }));
  const challenge = toChallenge(record(data.challenge));
  if (!challenge) throw new ApiError('This challenge is not available.', 0);
  const rows = (Array.isArray(data.rows) ? data.rows : []).flatMap((value): BoardRow[] => {
    const row = record(value);
    const userId = str(row.user_id);
    return userId ? [{ userId, name: text(row.name) || text(row.handle) || 'Athlete', handle: text(row.handle), value: num(row.value) ?? 0 }] : [];
  });
  return { challenge, rows, memberCount: num(data.member_count) ?? rows.length, joined: data.joined === true };
}

async function membershipId(token: string, challengeId: string, meId: string): Promise<string | null> {
  const [row] = items(await query(token, 'ChallengeMember', { q: { challenge_id: challengeId, user_id: meId }, limit: 1 }));
  return row ? str(row.id) : null;
}

export async function joinChallenge(token: string, input: { challengeId: string; meId: string; handle: string; name: string }): Promise<void> {
  if (await membershipId(token, input.challengeId, input.meId)) return;
  await request('POST', entityUrl('ChallengeMember'), { token, body: { challenge_id: input.challengeId, user_id: input.meId, handle: input.handle, name: input.name } });
}

export async function leaveChallenge(token: string, input: { challengeId: string; meId: string }): Promise<void> {
  const id = await membershipId(token, input.challengeId, input.meId);
  if (id) await request('DELETE', idUrl('ChallengeMember', id), { token });
}
