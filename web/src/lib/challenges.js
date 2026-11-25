export const METRICS = {
  distance: { label: 'Miles run', unit: 'mi', goalHint: '100' },
  runs: { label: 'Runs logged', unit: 'runs', goalHint: '20' },
};

export const METRIC_ORDER = ['distance', 'runs'];

// Gym is hidden for now: challenges on these metrics stay stored but are not listed.
export const HIDDEN_METRICS = ['workouts'];

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthWindow(key) {
  const [year, month] = String(key || currentMonthKey())
    .split('-')
    .map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  };
}

export function monthOptions(count = 4) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const key = currentMonthKey(new Date(now.getFullYear(), now.getMonth() + i, 1));
    return { key, label: monthWindow(key).label };
  });
}

export function formatValue(metric, value) {
  const n = Number(value) || 0;
  if (metric === 'distance') return `${n.toFixed(1)} mi`;
  if (metric === 'runs') return `${Math.round(n)} ${Math.round(n) === 1 ? 'run' : 'runs'}`;
  return `${Math.round(n)} ${Math.round(n) === 1 ? 'session' : 'sessions'}`;
}

export function goalLabel(challenge) {
  const metric = METRICS[challenge?.metric] || METRICS.distance;
  return `${Number(challenge?.target_value || 0)} ${metric.unit}`;
}

export function daysLeft(endDate) {
  if (!endDate) return 0;
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000));
}