/** Text shown on the run screens — pure. */
import { formatPace, type HrBounds, type HrStatus, type PaceStatus } from './zones';

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatMiles(miles: number): string {
  return (Math.floor(Math.max(0, miles) * 100) / 100).toFixed(2);
}

/** Distance to the next turn, in the units a runner in the US expects. */
export function formatDistanceAway(meters: number): string {
  if (meters < 10) return 'now';
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.max(50, Math.round(feet / 50) * 50)} ft`;
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

/** Pace uses faster/slower: "above" is ambiguous for a pace. */
export function paceLabel(status: PaceStatus): string {
  return status === 'in' ? 'in zone' : status === 'unknown' ? '—' : status;
}

export function hrLabel(status: HrStatus): string {
  return status === 'in' ? 'in zone' : status === 'unknown' ? 'no sensor' : status;
}

export function zoneLine(zone: { name: string; fast_sec: number; slow_sec: number }, bounds: HrBounds | null): string {
  const pace = `${formatPace(zone.fast_sec)}–${formatPace(zone.slow_sec)}`;
  return bounds ? `${zone.name} · ${pace} · ${bounds.min}–${bounds.max}` : `${zone.name} · ${pace}`;
}
