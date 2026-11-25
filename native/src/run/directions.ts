/** Turn-by-turn along a saved route, and "off route" — pure.
 * The turns come from the server's routeDirections function when the route is opened
 * and are kept for the run. Leaving the route is reported as a fact; nothing here
 * plans a way back.
 */
import { METERS_PER_MILE, projectOnPath, type LatLng } from './geo';
import { ROUTE_TEXT, type Cue } from './cues';

/** One maneuver as returned by POST /api/functions/routeDirections. */
export type Maneuver = { index: number; instruction: string; verbal: string; type: number; lat: number; lng: number; at_mi: number };
export type NavState = {
  /** Indexes of maneuvers already spoken. */
  announced: number[];
  offRoute: boolean;
  offSince: number | null;
  /** Metres along the route at the last fix; keeps progress steady where the route crosses itself. */
  along: number;
};
export type NextTurn = { maneuver: Maneuver; metersAway: number };

export const OFF_ROUTE_M = 40;
export const BACK_ON_ROUTE_M = 25;
export const OFF_ROUTE_HOLD_MS = 10000;
export const ANNOUNCE_WITHIN_M = 60;
/** A maneuver this far behind the runner still counts as "next" (GPS can overshoot a corner). */
const PASSED_M = 5;

export function initialNavState(): NavState {
  return { announced: [], offRoute: false, offSince: null, along: 0 };
}

export function stepNav(
  nav: NavState,
  input: { path: LatLng[]; maneuvers: Maneuver[]; position: LatLng; nowMs: number },
): { nav: NavState; next: NextTurn | null; cues: Cue[] } {
  const where = projectOnPath(input.path, input.position, nav.along);
  if (!where) return { nav, next: null, cues: [] };
  const cues: Cue[] = [];
  let { offRoute, offSince } = nav;

  if (where.offMeters >= OFF_ROUTE_M) {
    if (offSince == null) offSince = input.nowMs;
    if (!offRoute && input.nowMs - offSince >= OFF_ROUTE_HOLD_MS) {
      offRoute = true;
      cues.push({ metric: 'route', kind: 'left', text: ROUTE_TEXT.off, at: input.nowMs });
    }
  } else if (where.offMeters <= BACK_ON_ROUTE_M) {
    offSince = null;
    if (offRoute) {
      offRoute = false;
      cues.push({ metric: 'route', kind: 'returned', text: ROUTE_TEXT.back, at: input.nowMs });
    }
  } else if (!offRoute) {
    offSince = null;
  }

  // Progress only moves while the runner is on the line; a detour must not skip turns.
  const along = offRoute ? nav.along : where.alongMeters;
  let next: NextTurn | null = null;
  for (const maneuver of input.maneuvers) {
    const metersAway = maneuver.at_mi * METERS_PER_MILE - along;
    if (metersAway >= -PASSED_M) {
      next = { maneuver, metersAway: Math.max(0, metersAway) };
      break;
    }
  }
  let announced = nav.announced;
  if (next && !offRoute && next.metersAway <= ANNOUNCE_WITHIN_M && !announced.includes(next.maneuver.index)) {
    announced = [...announced, next.maneuver.index];
    cues.push({ metric: 'turn', kind: 'info', text: next.maneuver.verbal || next.maneuver.instruction, at: input.nowMs });
  }
  return { nav: { announced, offRoute, offSince, along }, next, cues };
}
