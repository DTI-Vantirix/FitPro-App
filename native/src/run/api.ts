/** Everything the run experience asks of the VantraRun API, over HTTP only.
 * Runs are written through ingestActivity and nowhere else (docs/native-contract.md).
 * Profile, zones and routes use the same entity routes the website uses. Runs are read
 * (never written) with one entity query, shared by listServerRuns and listRunsToShare.
 */
import { API_URL, APP_AUTH_URL, ENTITIES_URL, FUNCTIONS_URL, INGEST_URL } from '../config';
import type { Maneuver } from './directions';
import { validLatLng, type LatLng } from './geo';
import { classifyResponse, type SendResult } from './queue';
import type { RouteRecord, SnapResult, Waypoint } from './route-draft';
import { sortZones, zoneTemplate, type Profile, type Zone, type ZoneEdit } from './zones';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: unknown = null) {
    super(message);
    this.name = 'ApiError';
  }
}

export type SavedRoute = {
  id: string;
  name: string;
  distanceMi: number | null;
  /** The line to draw and follow: the road-following geometry when the route has it, else its waypoints. */
  path: LatLng[];
  targetZoneId: string | null;
  targetZoneName: string | null;
};
export type Directions = { available: boolean; maneuvers: Maneuver[] };
/** A run as the server holds it, whichever device or import it came from. */
export type ServerRun = {
  id: string;
  routeId: string | null;
  routeName: string;
  distanceMi: number;
  durationSec: number;
  avgPaceSec: number;
  startedAt: string | null;
  targetZoneName: string | null;
  inZonePct: number | null;
  avgHr: number | null;
  source: string | null;
  externalId: string | null;
};

const OFFLINE = "Can't reach VantraRun. Check your connection and try again.";

type Reply = { status: number; data: unknown };

async function call(method: string, url: string, opts: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<Reply> {
  if (!API_URL) throw new ApiError('EXPO_PUBLIC_API_URL is not set. Add it to native/.env and restart Expo.', 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function request(method: string, url: string, opts: { token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> {
  const reply = await call(method, url, opts);
  if (reply.status < 200 || reply.status >= 300) {
    const error = record(reply.data).error;
    throw new ApiError(typeof error === 'string' && error ? error : `Request failed (${reply.status}).`, reply.status, reply.data);
  }
  return reply.data;
}

export function items(data: unknown): Record<string, unknown>[] {
  const list = Array.isArray(data) ? data : record(data).items;
  return Array.isArray(list) ? list.map(record) : [];
}

export const num = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
export const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

// ---- account -------------------------------------------------------------

export async function register(input: { email: string; password: string; fullName: string; inviteCode: string }): Promise<void> {
  await request('POST', `${APP_AUTH_URL}/register`, {
    body: {
      email: input.email.trim(),
      password: input.password,
      ...(input.fullName.trim() ? { full_name: input.fullName.trim() } : {}),
      invite_code: input.inviteCode.trim().toUpperCase(),
    },
  });
}

/** Confirms the emailed 6-digit code and returns the access token. */
export async function verifyEmailCode(email: string, code: string): Promise<string> {
  const data = record(await request('POST', `${APP_AUTH_URL}/verify-otp`, { body: { email: email.trim(), otp_code: code.trim() } }));
  if (typeof data.access_token !== 'string' || !data.access_token) throw new ApiError('The server did not sign you in. Try signing in.', 0);
  return data.access_token;
}

export async function resendEmailCode(email: string): Promise<void> {
  await request('POST', `${APP_AUTH_URL}/resend-otp`, { body: { email: email.trim() } });
}

export async function fetchMe(token: string): Promise<{ id: string; email: string }> {
  const data = record(await request('GET', `${APP_AUTH_URL}/me`, { token }));
  if (typeof data.id !== 'string' || !data.id) throw new ApiError('The server did not return your account.', 0);
  return { id: data.id, email: typeof data.email === 'string' ? data.email : '' };
}

/** Permanently deletes the account and, on the server, every record it owns. */
export async function deleteAccount(token: string, password: string): Promise<void> {
  await request('DELETE', `${APP_AUTH_URL}/me`, { token, body: { password } });
}

// ---- profile and zones ---------------------------------------------------

export const entityUrl = (name: string, suffix = '') => `${ENTITIES_URL}/${name}${suffix}`;
// An admin may read everyone's records, so every list asks for the caller's own.
const mine = (ownerId: string) => ({ created_by_id: ownerId });

export async function loadProfile(token: string, ownerId: string): Promise<Profile | null> {
  const [row] = items(await request('POST', entityUrl('Profile', '/query'), { token, body: { q: mine(ownerId), sort: '-created_date', limit: 1 } }));
  const id = str(row?.id);
  return id ? { id, hr_max: num(row.hr_max), threshold_sec: num(row.threshold_sec) } : null;
}

export async function saveProfile(token: string, ownerId: string, values: { hr_max: number; threshold_sec?: number }): Promise<void> {
  const existing = await loadProfile(token, ownerId);
  if (existing) await request('PUT', entityUrl('Profile', `/${encodeURIComponent(existing.id)}`), { token, body: values });
  else await request('POST', entityUrl('Profile'), { token, body: values });
}

function toZone(row: Record<string, unknown>): Zone | null {
  const fast = num(row.fast_sec);
  const slow = num(row.slow_sec);
  const name = str(row.name);
  if (!name || fast == null || slow == null || fast <= 0 || slow < fast) return null;
  return {
    ...(str(row.id) ? { id: str(row.id)! } : {}),
    name,
    zone_number: num(row.zone_number) ?? 0,
    fast_sec: fast,
    slow_sec: slow,
    hr_min_pct: num(row.hr_min_pct),
    hr_max_pct: num(row.hr_max_pct),
    ...(str(row.color) ? { color: str(row.color)! } : {}),
    ...(str(row.intensity) ? { intensity: str(row.intensity)! } : {}),
    ...(str(row.purpose) ? { purpose: str(row.purpose)! } : {}),
    ...(str(row.feel) ? { feel: str(row.feel)! } : {}),
  };
}

export async function listZones(token: string, ownerId: string): Promise<Zone[]> {
  const rows = items(await request('POST', entityUrl('PaceZone', '/query'), { token, body: { q: mine(ownerId), sort: 'fast_sec', limit: 40 } }));
  return sortZones(rows.map(toZone).filter((z): z is Zone => z !== null));
}

/** Writes the five zones for a threshold pace, replacing any previous set — the same
 * steps as the website's applyZones (web/src/lib/profile.js). */
export async function applyZones(token: string, ownerId: string, thresholdSec: number): Promise<Zone[]> {
  const spec = zoneTemplate(thresholdSec);
  const existing = items(await request('POST', entityUrl('PaceZone', '/query'), { token, body: { q: mine(ownerId), sort: 'fast_sec', limit: 40 } }));
  const byNumber = new Map(existing.map((zone) => [num(zone.zone_number) ?? 0, zone]));
  if (existing.length === spec.length && spec.every((s) => str(byNumber.get(s.zone_number)?.id))) {
    await request('PUT', entityUrl('PaceZone', '/bulk'), { token, body: spec.map((s) => ({ id: byNumber.get(s.zone_number)!.id, ...s })) });
  } else {
    for (const zone of existing) {
      const id = str(zone.id);
      if (id) await request('DELETE', entityUrl('PaceZone', `/${encodeURIComponent(id)}`), { token });
    }
    await request('POST', entityUrl('PaceZone', '/bulk'), { token, body: spec });
  }
  return listZones(token, ownerId);
}

/** Changes one zone's name and pace range, as the website's zone editor does. Nothing else
 * about the zone is sent, so its number, heart-rate band and text stay as they are. */
export async function updateZone(token: string, zoneId: string, values: ZoneEdit): Promise<Zone> {
  const body = { name: values.name, fast_sec: values.fast_sec, slow_sec: values.slow_sec };
  const zone = toZone(record(await request('PUT', entityUrl('PaceZone', `/${encodeURIComponent(zoneId)}`), { token, body })));
  if (!zone) throw new ApiError('The server did not confirm the change. Check your zones before saving it again.', 0);
  return zone;
}

// ---- routes and directions -----------------------------------------------

export function toPath(value: unknown): LatLng[] {
  if (!Array.isArray(value)) return [];
  return value.map((p) => ({ lat: Number(record(p).lat), lng: Number(record(p).lng) })).filter(validLatLng);
}

export async function listRoutes(token: string, ownerId: string): Promise<SavedRoute[]> {
  const rows = items(await request('POST', entityUrl('Route', '/query'), { token, body: { q: mine(ownerId), sort: '-created_date', limit: 100 } }));
  return rows.flatMap((row) => {
    const id = str(row.id);
    const dense = toPath(row.path);
    const path = dense.length >= 2 ? dense : toPath(row.points);
    if (!id || path.length < 2) return [];
    return [{ id, name: str(row.name) ?? 'Route', distanceMi: num(row.distance_mi), path, targetZoneId: str(row.target_zone_id), targetZoneName: str(row.target_zone_name) }];
  });
}

/** Road-following line for the waypoints of a route being drawn. A waypoint with
 * `offroad: true` is joined to the one before by a straight line. `snapped: false` means
 * a road section could not be routed and straight lines were used. Throws when the
 * server cannot be reached or refuses. */
export async function snapRoute(token: string, points: Waypoint[]): Promise<SnapResult> {
  const body = { points: points.map((p) => ({ lat: p.lat, lng: p.lng, ...(p.offroad === true ? { offroad: true } : {}) })) };
  const data = record(await request('POST', `${FUNCTIONS_URL}/snapRoute`, { token, body, timeoutMs: 15000 }));
  return { snapped: data.snapped === true, path: toPath(data.path), distanceMi: num(data.distance_mi) };
}

/** Saves a drawn route and returns its id. */
export async function createRoute(token: string, route: RouteRecord): Promise<string> {
  const id = str(record(await request('POST', entityUrl('Route'), { token, body: route })).id);
  if (!id) throw new ApiError('The server did not confirm the route was saved. Check your routes before saving it again.', 0);
  return id;
}

export async function deleteRoute(token: string, routeId: string): Promise<void> {
  await request('DELETE', entityUrl('Route', `/${encodeURIComponent(routeId)}`), { token });
}

function toManeuver(value: unknown, index: number): Maneuver | null {
  const m = record(value);
  const lat = num(m.lat);
  const lng = num(m.lng);
  const at = num(m.at_mi);
  const instruction = str(m.instruction);
  if (lat == null || lng == null || at == null || at < 0 || !instruction || !validLatLng({ lat, lng })) return null;
  return { index, instruction, verbal: str(m.verbal) ?? instruction, type: num(m.type) ?? 0, lat, lng, at_mi: at };
}

/** Turn instructions for a saved route. Never throws: without them the route is still drawn. */
export async function fetchDirections(token: string, routeId: string): Promise<Directions> {
  try {
    const data = record(await request('POST', `${FUNCTIONS_URL}/routeDirections`, { token, body: { route_id: routeId }, timeoutMs: 15000 }));
    const maneuvers = (Array.isArray(data.maneuvers) ? data.maneuvers : [])
      .map((m) => toManeuver(m, 0))
      .filter((m): m is Maneuver => m !== null)
      .sort((a, b) => a.at_mi - b.at_mi)
      .map((m, index) => ({ ...m, index }));
    return data.available === true && maneuvers.length ? { available: true, maneuvers } : { available: false, maneuvers: [] };
  } catch {
    return { available: false, maneuvers: [] };
  }
}

// ---- reading runs --------------------------------------------------------

function toServerRun(row: Record<string, unknown>): ServerRun | null {
  const id = str(row.id);
  const distanceMi = num(row.distance_mi);
  const durationSec = num(row.duration_sec);
  if (!id || distanceMi == null || durationSec == null || distanceMi <= 0 || durationSec <= 0) return null;
  // A run saved without a start time is dated by when it was created, as the website does.
  const when = [str(row.started_at), str(row.created_date)].find((value) => value && Number.isFinite(Date.parse(value))) ?? null;
  return {
    id,
    routeId: str(row.route_id),
    routeName: str(row.route_name) ?? 'Free run',
    distanceMi,
    durationSec,
    avgPaceSec: num(row.avg_pace_sec) ?? durationSec / distanceMi,
    startedAt: when,
    targetZoneName: str(row.target_zone_name),
    inZonePct: num(row.in_zone_pct),
    avgHr: num(row.avg_hr),
    source: str(row.source),
    externalId: str(row.external_id),
  };
}

/** The one query that reads runs: the caller's own, newest first. */
async function queryRuns(token: string, ownerId: string, options: { limit?: number }): Promise<Record<string, unknown>[]> {
  const asked = options.limit;
  const limit = typeof asked === 'number' && Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 40;
  return items(await request('POST', entityUrl('Run', '/query'), { token, body: { q: mine(ownerId), sort: '-started_at', limit } }));
}

/** The runner's runs as the server holds them, newest first: recorded here, on the website
 * or imported. Read only. Runs are still written through ingestActivity and nowhere else. */
export async function listServerRuns(token: string, ownerId: string, options: { limit?: number } = {}): Promise<ServerRun[]> {
  return (await queryRuns(token, ownerId, options)).map(toServerRun).filter((run): run is ServerRun => run !== null);
}

/** The same runs from the same query, each with its recorded track: what the share composer
 * offers and draws. Read only. */
export async function listRunsToShare(token: string, ownerId: string, options: { limit?: number } = {}): Promise<(ServerRun & { points: LatLng[] })[]> {
  return (await queryRuns(token, ownerId, options)).flatMap((row) => {
    const run = toServerRun(row);
    return run ? [{ ...run, points: toPath(row.points) }] : [];
  });
}

// ---- saving a run --------------------------------------------------------

/** One attempt to save a run. Never throws; the queue decides what to do with the result. */
export async function sendRun(token: string, payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const reply = await call('POST', INGEST_URL, { token, body: payload, timeoutMs: 30000 });
    return classifyResponse(reply.status, reply.data);
  } catch (cause) {
    return classifyResponse(null, null, cause instanceof Error ? cause.message : String(cause));
  }
}
