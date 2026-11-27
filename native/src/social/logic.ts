/** Feed, friends and sharing — pure. The rules are the website's (web/src/lib/social.js and
 * web/src/components/social): same handles, same audiences and default, same post record.
 * Gym is hidden there, so workout posts are never shown or made here.
 */
import { NO_BACKGROUND, type Background } from './media';

export type LatLng = { lat: number; lng: number };
/** Who may see a post: anyone on VantraRun, accepted friends, or only its author. */
export type Audience = 'public' | 'friends' | 'private';
export type SocialProfile = {
  id: string;
  ownerId: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  visibility: 'public' | 'private';
};
export type Connection = {
  id: string;
  fromUserId: string;
  toUserId: string;
  fromHandle: string;
  fromName: string;
  toHandle: string;
  toName: string;
  status: 'pending' | 'accepted' | 'declined';
};
export type Post = {
  id: string;
  ownerId: string;
  createdAt: string | null;
  kind: string;
  title: string;
  caption: string;
  distanceMi: number;
  durationSec: number;
  avgPaceSec: number;
  zoneName: string;
  routePoints: LatLng[];
  visibility: string;
  authorHandle: string;
  authorName: string;
  /** 'none', 'photo' or 'video', and where the server keeps the file (src/social/media.ts). */
  backgroundType: Background['type'];
  backgroundUrl: string;
};
/** A run the server holds, with its track: what a post is made from. */
export type ShareRun = {
  id: string;
  routeName: string;
  distanceMi: number;
  durationSec: number;
  avgPaceSec: number;
  targetZoneName: string | null;
  inZonePct: number | null;
  points: LatLng[];
};

const goodPoint = (p: unknown): p is LatLng => {
  const point = p as LatLng | null;
  return !!point && typeof point.lat === 'number' && typeof point.lng === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
};

// ---- handles and profile ----------------------------------------------------------------

export function cleanHandle(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24);
}

/** The handle a first profile starts from: the name, else the part of the email before the @. */
export function defaultHandleBase(account: { fullName: string; email: string }): string {
  return cleanHandle((account.fullName || account.email || 'athlete').replace(/\s+/g, '.').replace(/@.*/, '')) || 'athlete';
}

export const HANDLE_TAKEN = 'That handle is already taken.';

export type ProfileValues = { handle: string; display_name: string; bio: string; visibility: 'public' | 'private' };

export function profileEdit(input: { handle: string; displayName: string; bio: string; visibility: string }):
  { ok: true; values: ProfileValues } | { ok: false; error: string } {
  const handle = cleanHandle(input.handle);
  if (!handle) return { ok: false, error: 'Pick a handle — letters, numbers, dots and underscores.' };
  return { ok: true, values: { handle, display_name: input.displayName.trim() || handle, bio: input.bio.trim(), visibility: input.visibility === 'public' ? 'public' : 'private' } };
}

export function initials(name: string | null | undefined, handle: string | null | undefined): string {
  return (name || handle || '?').slice(0, 2).toUpperCase();
}

// ---- audiences and posts ----------------------------------------------------------------

/** The composer's choices, in the website's order. */
export const AUDIENCES: { id: Audience; label: string; icon: 'globe' | 'users' | 'lock' }[] = [
  { id: 'public', label: 'Public', icon: 'globe' },
  { id: 'friends', label: 'Friends', icon: 'users' },
  { id: 'private', label: 'Only me', icon: 'lock' },
];

export function audienceIcon(visibility: string): 'globe' | 'users' | 'lock' {
  return visibility === 'public' ? 'globe' : visibility === 'private' ? 'lock' : 'users';
}

/** The label on a post card. */
export function audienceLabel(visibility: string): string {
  return visibility === 'public' ? 'Anyone on VantraRun' : visibility === 'private' ? 'Only me' : 'Friends';
}

/** Friends, unless the runner made their account public: the website's default, never wider. */
export function defaultAudience(profile: Pick<SocialProfile, 'visibility'> | null | undefined): Audience {
  return profile?.visibility === 'public' ? 'public' : 'friends';
}

/** The track sent with a post: at most `max` points, thinned exactly as the website's composer
 * thins them, and only latitude and longitude — nothing else a point may carry. */
export function thinTrack(points: unknown, max = 160): LatLng[] {
  const good = (Array.isArray(points) ? points : []).filter(goodPoint);
  const step = good.length <= max ? 1 : Math.ceil(good.length / max);
  return good.filter((_, index) => index % step === 0).map((p) => ({ lat: p.lat, lng: p.lng }));
}

/** The Post record the website's composer creates. `background` is the stock photo the runner
 * chose or the file the server has just stored for them; left out, the post has none. Of the
 * media, the record carries its kind and its address and nothing else. */
export function buildPost(input: { run: ShareRun; caption: string; audience: Audience; profile: SocialProfile; background?: Background }): Record<string, unknown> {
  const { run, profile, audience } = input;
  if (!AUDIENCES.some((choice) => choice.id === audience)) throw new Error('Pick an audience for the post: Public, Friends or Only me.');
  const background = input.background ?? NO_BACKGROUND;
  const none = background.type === 'none';
  if (!none && background.type !== 'photo' && background.type !== 'video') throw new Error('The background of a post is a photo, a video or none.');
  if (!none && !background.url.trim()) throw new Error('The background was not uploaded, so the post cannot name it.');
  return {
    kind: 'run',
    ref_id: run.id,
    title: run.routeName || 'Free run',
    caption: input.caption.trim(),
    distance_mi: run.distanceMi || 0,
    duration_sec: run.durationSec || 0,
    avg_pace_sec: run.avgPaceSec || 0,
    zone_name: run.targetZoneName || '',
    in_zone_pct: run.inZonePct || 0,
    route_points: thinTrack(run.points),
    background_type: none ? 'none' : background.type,
    background_url: none ? '' : background.url,
    visibility: audience,
    author_handle: profile.handle || '',
    author_name: profile.displayName || profile.handle || '',
    author_avatar: profile.avatarUrl || '',
    shared_to: [],
  };
}

export function visiblePosts<T extends { kind?: unknown }>(posts: T[] | null | undefined): T[] {
  return (posts ?? []).filter((post) => post.kind !== 'workout');
}

export function postText(post: { distanceMi: number; zoneName: string }): string {
  const bits = [`${(Number(post.distanceMi) || 0).toFixed(2)} mi`];
  if (post.zoneName) bits.push(post.zoneName);
  return `${bits.join(' · ')} — logged on VantraRun`;
}

const trimSlash = (origin: string) => origin.replace(/\/+$/, '');

/** `origin` is the website's address. Empty when it is not known. */
export function inviteLink(origin: string, handle: string): string {
  return origin && handle ? `${trimSlash(origin)}/friends?add=${encodeURIComponent(handle)}` : '';
}

export function postLink(origin: string, postId: string): string {
  return origin ? `${trimSlash(origin)}/feed?post=${encodeURIComponent(postId)}` : '';
}

/** "5 minutes ago", in the steps the website's feed uses. */
export function timeAgo(iso: string | null | undefined, nowMs: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '';
  const sec = Math.max(0, (nowMs - at) / 1000);
  const many = (n: number, unit: string) => `${n} ${unit}s ago`;
  if (sec < 45) return 'a few seconds ago';
  if (sec < 90) return 'a minute ago';
  const min = sec / 60;
  if (min < 45) return many(Math.round(min), 'minute');
  if (min < 90) return 'an hour ago';
  const hours = min / 60;
  if (hours < 22) return many(Math.round(hours), 'hour');
  if (hours < 36) return 'a day ago';
  const days = hours / 24;
  if (days < 26) return many(Math.round(days), 'day');
  if (days < 45) return 'a month ago';
  if (days < 320) return many(Math.round(days / 30.4), 'month');
  if (days < 548) return 'a year ago';
  return many(Math.round(days / 365), 'year');
}

// ---- friends ----------------------------------------------------------------------------

export function splitConnections(connections: Connection[], userId: string): { friends: Connection[]; incoming: Connection[]; outgoing: Connection[] } {
  return {
    friends: connections.filter((c) => c.status === 'accepted'),
    incoming: connections.filter((c) => c.status === 'pending' && c.toUserId === userId),
    outgoing: connections.filter((c) => c.status === 'pending' && c.fromUserId === userId),
  };
}

export function otherSide(connection: Connection, meId: string): { name: string; handle: string } {
  const mine = connection.fromUserId === meId;
  const handle = mine ? connection.toHandle : connection.fromHandle;
  return { name: (mine ? connection.toName : connection.fromName) || handle, handle };
}

export function connectionWith(connections: Connection[], meId: string, otherId: string): Connection | null {
  return connections.find((c) => (c.fromUserId === meId && c.toUserId === otherId) || (c.toUserId === meId && c.fromUserId === otherId)) ?? null;
}

export function searchProfiles(people: SocialProfile[], query: string, meId: string): SocialProfile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const handle = needle.replace(/^@/, '');
  return people.filter((p) => p.ownerId !== meId && (p.handle.toLowerCase().includes(handle) || p.displayName.toLowerCase().includes(needle)));
}

/** A public account accepts straight away; a private one approves first. */
export function requestStatusFor(target: Pick<SocialProfile, 'visibility'>): 'accepted' | 'pending' {
  return target.visibility === 'public' ? 'accepted' : 'pending';
}

// ---- route trace ------------------------------------------------------------------------

export type TraceSegment = { cx: number; cy: number; length: number; angle: number };
export type Trace = { start: { x: number; y: number }; segments: TraceSegment[] };

/** The line of a route fitted into a square of `size`, as the website's RouteTrace draws it:
 * each segment by its centre, length and angle in degrees, ready to be drawn as a thin bar. */
export function traceSegments(points: unknown, size: number, pad = 4): Trace | null {
  let pts = (Array.isArray(points) ? points : []).filter(goodPoint);
  if (pts.length < 2) return null;
  if (pts.length > 61) {
    const step = Math.ceil(pts.length / 60);
    const last = pts[pts.length - 1];
    pts = pts.filter((_, index) => index % step === 0);
    if (pts[pts.length - 1] !== last) pts.push(last);
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const spanLat = Math.max(maxLat - minLat, 1e-5);
  const spanLng = Math.max(maxLng - minLng, 1e-5);
  const inner = Math.max(1, size - pad * 2);
  const scale = Math.min(inner / spanLng, inner / spanLat);
  const offX = pad + (inner - spanLng * scale) / 2;
  const offY = pad + (inner - spanLat * scale) / 2;
  const xy = pts.map((p) => ({ x: offX + (p.lng - minLng) * scale, y: offY + (maxLat - p.lat) * scale }));
  const segments: TraceSegment[] = [];
  for (let i = 1; i < xy.length; i += 1) {
    const dx = xy[i].x - xy[i - 1].x;
    const dy = xy[i].y - xy[i - 1].y;
    segments.push({ cx: (xy[i].x + xy[i - 1].x) / 2, cy: (xy[i].y + xy[i - 1].y) / 2, length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI });
  }
  return { start: xy[0], segments };
}
