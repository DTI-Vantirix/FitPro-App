/** Challenge groups — pure. The website's rules (web/src/lib/challenges.js and
 * web/src/components/challenges): one number a month, miles or run count. Gym is hidden
 * there, so workout challenges are neither listed nor created here.
 */
export type MetricId = 'distance' | 'runs';
export type Challenge = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  metric: string;
  targetValue: number;
  month: string;
  startDate: string | null;
  endDate: string | null;
};
export type BoardRow = { userId: string; name: string; handle: string; value: number };
export type Board = { challenge: Challenge; rows: BoardRow[]; memberCount: number; joined: boolean };

export const METRICS: Record<MetricId, { label: string; unit: string; goalHint: string }> = {
  distance: { label: 'Miles run', unit: 'mi', goalHint: '100' },
  runs: { label: 'Runs logged', unit: 'runs', goalHint: '20' },
};
export const METRIC_ORDER: MetricId[] = ['distance', 'runs'];
export const HIDDEN_METRICS = ['workouts'];

export function metricOf(metric: string | null | undefined): { label: string; unit: string; goalHint: string } {
  return METRICS[metric as MetricId] ?? METRICS.distance;
}

export function visibleChallenges<T extends { metric?: unknown }>(list: T[] | null | undefined): T[] {
  return (list ?? []).filter((item) => !HIDDEN_METRICS.includes(String(item.metric)));
}

export function currentMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The first instant of the month and of the next one, in the phone's own time zone. */
export function monthWindow(key: string | null | undefined, locale?: string): { start_date: string; end_date: string; label: string } {
  const [year, month] = String(key || currentMonthKey()).split('-').map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start_date: start.toISOString(), end_date: end.toISOString(), label: start.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) };
}

export function monthOptions(count = 3, now: Date = new Date(), locale?: string): { key: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const key = currentMonthKey(new Date(now.getFullYear(), now.getMonth() + i, 1));
    return { key, label: monthWindow(key, locale).label };
  });
}

export function formatValue(metric: string, value: unknown): string {
  const n = Number(value) || 0;
  if (metric === 'distance') return `${n.toFixed(1)} mi`;
  return `${Math.round(n)} ${Math.round(n) === 1 ? 'run' : 'runs'}`;
}

export function goalLabel(challenge: Pick<Challenge, 'metric' | 'targetValue'> | null | undefined): string {
  return `${Number(challenge?.targetValue || 0)} ${metricOf(challenge?.metric).unit}`;
}

export function daysLeft(endDate: string | null | undefined, nowMs: number = Date.now()): number {
  const end = endDate ? Date.parse(endDate) : NaN;
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - nowMs) / 86400000)) : 0;
}

export function cleanTarget(text: string): string {
  return text.replace(/[^0-9.]/g, '');
}

export type ChallengeRecord = {
  name: string;
  description: string;
  metric: MetricId;
  target_value: number;
  month: string;
  start_date: string;
  end_date: string;
  creator_handle: string;
};

/** The record the website's New challenge form creates, checked as it checks. */
export function challengeDraft(input: { name: string; description: string; metric: string; target: string; month: string; handle: string }):
  { ok: true; record: ChallengeRecord } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give the group a name.' };
  if (!METRIC_ORDER.includes(input.metric as MetricId)) return { ok: false, error: 'Pick miles run or runs logged.' };
  const value = Number(input.target);
  if (!value || !Number.isFinite(value) || value <= 0) return { ok: false, error: 'Set a goal above zero.' };
  const win = monthWindow(input.month);
  return { ok: true, record: { name, description: input.description.trim(), metric: input.metric as MetricId, target_value: value, month: input.month,
    start_date: win.start_date, end_date: win.end_date, creator_handle: input.handle || '' } };
}

export function progressPct(value: number, target: number): number {
  return target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
}
