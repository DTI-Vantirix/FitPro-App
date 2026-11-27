/** The Analytics screen's figures and chart geometry — pure. The same sums as the website's
 * Analytics page (web/src/pages/Analytics.jsx), from the runs the server holds.
 */
import type { ServerRun } from './api';
import { startOfWeek } from './dashboard';
import { formatDuration } from './format';

export type AnalyticsRun = Pick<ServerRun, 'routeName' | 'distanceMi' | 'durationSec' | 'avgPaceSec' | 'startedAt' | 'targetZoneName'>;
export type WeekBar = { label: string; miles: number };
export type PacePoint = { label: string; pace: number };
export type Point = { x: number; y: number };

/** How many runs to ask the server for: as the website does. */
export const ANALYTICS_RUN_LIMIT = 200;
export const WEEKS_SHOWN = 8;
export const PACE_RUNS_SHOWN = 14;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 23", in the phone's own time zone. */
export function shortDate(value: Date | string | null): string {
  if (value == null) return '';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '';
}

/** Miles in each of the last eight Monday-to-Sunday weeks, oldest first; the last is this week. */
export function weeklyDistance(runs: AnalyticsRun[], now: Date): WeekBar[] {
  const buckets: { start: Date; miles: number }[] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i -= 1) {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - i * 7);
    buckets.push({ start, miles: 0 });
  }
  for (const run of runs) {
    if (!run.startedAt) continue;
    const key = startOfWeek(new Date(run.startedAt)).getTime();
    const bucket = buckets.find((b) => b.start.getTime() === key);
    if (bucket) bucket.miles += run.distanceMi;
  }
  return buckets.map((b) => ({ label: shortDate(b.start), miles: Number(b.miles.toFixed(2)) }));
}

/** Average pace of the latest runs, oldest first. `runs` is newest first, as the server sends them. */
export function paceTrend(runs: AnalyticsRun[]): PacePoint[] {
  return runs
    .filter((run) => run.avgPaceSec > 0)
    .slice(0, PACE_RUNS_SHOWN)
    .reverse()
    .map((run) => ({ label: shortDate(run.startedAt), pace: Math.round(run.avgPaceSec) }));
}

export function totals(runs: AnalyticsRun[]) {
  const miles = runs.reduce((sum, run) => sum + run.distanceMi, 0);
  const timeSec = runs.reduce((sum, run) => sum + run.durationSec, 0);
  const counts = new Map<string, number>();
  for (const run of runs) {
    const name = run.targetZoneName || 'Unzoned';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const zones = [...counts].map(([name, count]) => ({ name, count, share: count / runs.length })).sort((a, b) => b.count - a.count);
  return { runs: runs.length, miles, timeSec, avgPaceSec: miles > 0.1 ? timeSec / miles : null, zones };
}

export function bestEfforts<T extends AnalyticsRun>(runs: T[]): { longest: T | null; fastest: T | null } {
  const longest = [...runs].sort((a, b) => b.distanceMi - a.distanceMi)[0] ?? null;
  const fastest = runs.filter((run) => run.avgPaceSec > 0).sort((a, b) => a.avgPaceSec - b.avgPaceSec)[0] ?? null;
  return { longest, fastest };
}

/** Total moving time with the unit that matches how it reads. */
export function movingTime(totalSec: number): { value: string; unit: string } {
  return { value: formatDuration(totalSec), unit: totalSec >= 3600 ? 'hrs' : 'min' };
}

// ---- chart geometry --------------------------------------------------------------------

const tidy = (n: number) => Number(n.toFixed(6));

/** Gridline values for the distance bars: steps of 1, 2 or 5 (times a power of ten) that clear the tallest bar. */
export function distanceAxis(values: number[]): { max: number; ticks: number[] } {
  const top = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (top <= 0) return { max: 1, ticks: [0, 1] };
  const raw = top / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power;
  const step = (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power;
  const count = Math.max(1, Math.ceil(tidy(top / step)));
  const ticks = Array.from({ length: count + 1 }, (_, i) => tidy(i * step));
  return { max: ticks[count], ticks };
}

/** Height of a bar inside the plot. Any distance at all shows at least a sliver. */
export function barHeight(value: number, max: number, plotHeight: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(plotHeight, Math.max(2, Math.round((value / max) * plotHeight)));
}

/** The pace axis is reversed, as on the website: `top` is the fastest pace (fewest seconds),
 * with 20 seconds of room beyond the fastest and slowest runs. */
export function paceAxis(trend: PacePoint[]): { top: number; bottom: number; ticks: number[] } {
  const paces = trend.map((p) => p.pace);
  const top = Math.min(...paces) - 20;
  const bottom = Math.max(...paces) + 20;
  return { top, bottom, ticks: [top, Math.round((top + bottom) / 2), bottom] };
}

/** Where each run sits in a plot `width` by `height`: left to right in time, faster nearer the top. */
export function plotPace(trend: PacePoint[], width: number, height: number): Point[] {
  if (!trend.length || !(width > 0) || !(height > 0)) return [];
  const { top, bottom } = paceAxis(trend);
  return trend.map((point, index) => ({
    x: trend.length > 1 ? tidy((index / (trend.length - 1)) * width) : width / 2,
    y: tidy(((point.pace - top) / (bottom - top)) * height),
  }));
}

/** The straight pieces joining the points, each as a bar of `length` centred on (cx, cy) and turned by `angleDeg`. */
export function lineSegments(points: Point[]): { cx: number; cy: number; length: number; angleDeg: number }[] {
  return points.slice(1).map((to, index) => {
    const from = points[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return { cx: (from.x + to.x) / 2, cy: (from.y + to.y) / 2, length: Math.hypot(dx, dy), angleDeg: tidy((Math.atan2(dy, dx) * 180) / Math.PI) || 0 };
  });
}
