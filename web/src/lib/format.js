export function formatPace(secPerMile) {
  if (!secPerMile || !Number.isFinite(secPerMile) || secPerMile <= 0) return '—';
  const s = Math.round(secPerMile);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function formatDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function parsePace(value) {
  if (typeof value === 'number') return Math.round(value);
  const m = String(value || '').trim().match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMiles(mi) {
  const n = Number(mi) || 0;
  return n >= 100 ? Math.round(n).toString() : n.toFixed(2).replace(/0$/, n < 10 ? '' : '0');
}

export function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatWeight(kg) {
  if (!kg) return '—';
  return `${Math.round(kg * 2.20462)} lb`;
}

export function pacePerMile(distanceMi, durationSec) {
  if (!distanceMi || !durationSec) return 0;
  return durationSec / distanceMi;
}

export function relativeDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return formatShortDate(iso);
}