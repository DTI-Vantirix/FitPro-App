/** When to tell the runner that pace or heart rate has left or re-entered the zone — pure.
 *
 * Cues state facts. They never say what to do about it, and pace and heart rate are
 * scheduled independently: one never silences or overrides the other.
 *
 *  - a change is announced only once the new status has held for HOLD_MS, so a reading
 *    wobbling on the edge of the zone makes no noise;
 *  - one reminder after REMIND_MS continuously out of range, then nothing until it has
 *    been back in;
 *  - no reading ("unknown") says nothing and stops the clocks.
 */
export type Metric = 'pace' | 'hr';
export type CueKind = 'left' | 'returned' | 'reminder' | 'info';
export type Cue = { metric: Metric | 'route' | 'turn'; kind: CueKind; text: string; at: number };
/** `high` is pace faster than the zone or heart rate above it; `low` the opposite. */
export type Side = 'in' | 'high' | 'low';
export type MetricCueState = {
  announced: Side;
  candidate: Side | null;
  candidateSince: number;
  /** Milliseconds spent on the announced out-of-range side, counted only while there is a reading. */
  outMs: number;
  lastAt: number | null;
  reminded: boolean;
};

export const HOLD_MS = 10000;
export const REMIND_MS = 120000;
export const START_GRACE_MS = 60000;
const MAX_STEP_MS = 5000;

export const CUE_TEXT: Record<Metric, Record<Side, string>> = {
  pace: { high: 'Pace faster than zone', low: 'Pace slower than zone', in: 'Pace back in zone' },
  hr: { high: 'Heart rate above zone', low: 'Heart rate below zone', in: 'Heart rate back in zone' },
};
export const ROUTE_TEXT = { off: 'Off route', back: 'Back on route' };

export function initialMetricCueState(): MetricCueState {
  return { announced: 'in', candidate: null, candidateSince: 0, outMs: 0, lastAt: null, reminded: false };
}

export function stepMetricCue(
  state: MetricCueState,
  metric: Metric,
  status: Side | 'unknown',
  nowMs: number,
  opts: { muted: boolean; graceUntil: number },
): { state: MetricCueState; cue: Cue | null } {
  if (status === 'unknown' || nowMs < opts.graceUntil) {
    return { state: { ...state, candidate: null, lastAt: null }, cue: null };
  }
  const dt = state.lastAt == null ? 0 : Math.max(0, Math.min(MAX_STEP_MS, nowMs - state.lastAt));
  let next: MetricCueState = { ...state, lastAt: nowMs };
  let cue: Cue | null = null;

  if (status === state.announced) {
    next.candidate = null;
    if (state.announced !== 'in') {
      next.outMs = state.outMs + dt;
      if (!state.reminded && next.outMs >= REMIND_MS) {
        next.reminded = true;
        cue = { metric, kind: 'reminder', text: `Still: ${CUE_TEXT[metric][state.announced]}`, at: nowMs };
      }
    }
  } else if (state.candidate !== status) {
    next.candidate = status;
    next.candidateSince = nowMs;
  } else if (nowMs - state.candidateSince >= HOLD_MS) {
    next = { announced: status, candidate: null, candidateSince: 0, outMs: 0, lastAt: nowMs, reminded: false };
    cue = { metric, kind: status === 'in' ? 'returned' : 'left', text: CUE_TEXT[metric][status], at: nowMs };
  }
  return { state: next, cue: opts.muted ? null : cue };
}
