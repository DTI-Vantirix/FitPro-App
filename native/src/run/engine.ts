/** The run itself — pure. Location fixes, heart-rate samples and clock ticks go in;
 * the current state and any cues to play come out. Nothing here touches the device,
 * so the same code runs on a phone and under the unit tests, and the whole state is
 * plain data that can be written to disk and picked up again.
 */
import { initialMetricCueState, stepMetricCue, START_GRACE_MS, type Cue, type MetricCueState, type Side } from './cues';
import { initialNavState, stepNav, type Maneuver, type NavState, type NextTurn } from './directions';
import type { LatLng } from './geo';
import { addFix, breakTrack, emptyTrack, rollingPaceSec, type Fix, type Track } from './tracker';
import { hrBounds, hrStatus as judgeHr, paceStatus as judgePace, type HrStatus, type PaceStatus, type Zone } from './zones';

export type RunMode = 'route' | 'free' | 'free_map';
export type RunRoute = { id: string; name: string; path: LatLng[]; maneuvers: Maneuver[] };
export type Mute = { pace: boolean; hr: boolean };
export type RunConfig = {
  /** Generated on the phone when the run starts; a retried upload updates the same run. */
  externalId: string;
  mode: RunMode;
  zone: Zone;
  hrMax: number | null;
  route: RunRoute | null;
  ownerId: string;
};
export type RunState = {
  config: RunConfig;
  startedAt: number;
  status: 'running' | 'paused' | 'finished';
  /** Unpaused run time in milliseconds. */
  movingMs: number;
  lastClock: number;
  track: Track;
  hrSamples: { t: number; bpm: number }[];
  hr: { min: number | null; max: number | null; sum: number; count: number; device: string | null };
  pace: number | null;
  bpm: number | null;
  paceStatus: PaceStatus;
  hrStatus: HrStatus;
  /** Seconds in range and seconds with a reading, per metric. */
  zoneSec: { paceIn: number; paceKnown: number; hrIn: number; hrKnown: number };
  cue: { pace: MetricCueState; hr: MetricCueState };
  nav: NavState;
  next: NextTurn | null;
  mute: Mute;
};

const HR_WINDOW_MS = 10000;
const HR_KEEP_MS = 30000;
/** A timer that was suspended must not credit zone time nobody observed. */
const MAX_ZONE_STEP_MS = 5000;

export function startRun(config: RunConfig, nowMs: number, mute: Mute = { pace: false, hr: false }): RunState {
  return {
    config,
    startedAt: nowMs,
    status: 'running',
    movingMs: 0,
    lastClock: nowMs,
    track: emptyTrack(),
    hrSamples: [],
    hr: { min: null, max: null, sum: 0, count: 0, device: null },
    pace: null,
    bpm: null,
    paceStatus: 'unknown',
    hrStatus: 'unknown',
    zoneSec: { paceIn: 0, paceKnown: 0, hrIn: 0, hrKnown: 0 },
    cue: { pace: initialMetricCueState(), hr: initialMetricCueState() },
    nav: initialNavState(),
    next: null,
    mute: { ...mute },
  };
}

export function onFix(state: RunState, fix: Fix): { state: RunState; cues: Cue[] } {
  if (state.status !== 'running') return { state, cues: [] };
  const movingSec = Math.max(0, state.movingMs + (fix.t - state.lastClock)) / 1000;
  const track = addFix(state.track, fix, movingSec);
  if (track === state.track) return { state, cues: [] };
  const route = state.config.route;
  if (!route || route.path.length < 2) return { state: { ...state, track }, cues: [] };
  const out = stepNav(state.nav, { path: route.path, maneuvers: route.maneuvers, position: fix, nowMs: fix.t });
  return { state: { ...state, track, nav: out.nav, next: out.next }, cues: out.cues };
}

export function onHeartRate(state: RunState, bpm: number, tMs: number, device?: string): RunState {
  if (state.status === 'finished' || !Number.isFinite(bpm) || bpm < 30 || bpm > 240) return state;
  const value = Math.round(bpm);
  const hrSamples = [...state.hrSamples.filter((s) => s.t >= tMs - HR_KEEP_MS), { t: tMs, bpm: value }];
  if (state.status !== 'running') return { ...state, hrSamples };
  const hr = {
    min: state.hr.min == null ? value : Math.min(state.hr.min, value),
    max: state.hr.max == null ? value : Math.max(state.hr.max, value),
    sum: state.hr.sum + value,
    count: state.hr.count + 1,
    device: device ?? state.hr.device,
  };
  return { ...state, hrSamples, hr };
}

function currentBpm(samples: { t: number; bpm: number }[], nowMs: number): number | null {
  const recent = samples.filter((s) => s.t >= nowMs - HR_WINDOW_MS && s.t <= nowMs + 1000).map((s) => s.bpm).sort((a, b) => a - b);
  if (!recent.length) return null;
  const mid = Math.floor(recent.length / 2);
  return recent.length % 2 ? recent[mid] : Math.round((recent[mid - 1] + recent[mid]) / 2);
}

const paceSide = (s: PaceStatus): Side | 'unknown' => (s === 'faster' ? 'high' : s === 'slower' ? 'low' : s);
const hrSide = (s: HrStatus): Side | 'unknown' => (s === 'above' ? 'high' : s === 'below' ? 'low' : s);

/** Advances the run to `nowMs`. Safe to call from a timer and after every fix. */
export function onClock(state: RunState, nowMs: number): { state: RunState; cues: Cue[] } {
  const bpm = currentBpm(state.hrSamples, nowMs);
  if (state.status !== 'running') {
    return { state: state.status === 'paused' ? { ...state, bpm, lastClock: nowMs } : state, cues: [] };
  }
  const elapsed = Math.max(0, nowMs - state.lastClock);
  const zoneStep = Math.min(elapsed, MAX_ZONE_STEP_MS) / 1000;
  const pace = rollingPaceSec(state.track.points, nowMs);
  const paceStatus = judgePace(state.config.zone, pace);
  const hrStatus = judgeHr(hrBounds(state.config.zone, state.config.hrMax), bpm);
  const zoneSec = {
    paceIn: state.zoneSec.paceIn + (paceStatus === 'in' ? zoneStep : 0),
    paceKnown: state.zoneSec.paceKnown + (paceStatus !== 'unknown' ? zoneStep : 0),
    hrIn: state.zoneSec.hrIn + (hrStatus === 'in' ? zoneStep : 0),
    hrKnown: state.zoneSec.hrKnown + (hrStatus !== 'unknown' ? zoneStep : 0),
  };
  const graceUntil = state.startedAt + START_GRACE_MS;
  const paceCue = stepMetricCue(state.cue.pace, 'pace', paceSide(paceStatus), nowMs, { muted: state.mute.pace, graceUntil });
  const hrCue = stepMetricCue(state.cue.hr, 'hr', hrSide(hrStatus), nowMs, { muted: state.mute.hr, graceUntil });
  const cues = [paceCue.cue, hrCue.cue].filter((c): c is Cue => c !== null);
  return {
    state: {
      ...state,
      movingMs: state.movingMs + elapsed,
      lastClock: nowMs,
      pace,
      bpm,
      paceStatus,
      hrStatus,
      zoneSec,
      cue: { pace: paceCue.state, hr: hrCue.state },
    },
    cues,
  };
}

export function pauseRun(state: RunState, nowMs: number): RunState {
  if (state.status !== 'running') return state;
  return {
    ...state,
    status: 'paused',
    movingMs: state.movingMs + Math.max(0, nowMs - state.lastClock),
    lastClock: nowMs,
    track: breakTrack(state.track),
    pace: null,
    paceStatus: 'unknown',
    // the debounce and reminder clocks do not run across a pause
    cue: { pace: { ...state.cue.pace, candidate: null, lastAt: null }, hr: { ...state.cue.hr, candidate: null, lastAt: null } },
  };
}

export function resumeRun(state: RunState, nowMs: number): RunState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', lastClock: nowMs };
}

export function finishRun(state: RunState, nowMs: number): RunState {
  if (state.status === 'finished') return state;
  const banked = state.status === 'running' ? Math.max(0, nowMs - state.lastClock) : 0;
  return { ...state, status: 'finished', movingMs: state.movingMs + banked, lastClock: nowMs };
}

export function setMute(state: RunState, mute: Mute): RunState {
  return { ...state, mute: { ...mute } };
}
