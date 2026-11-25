/** Pace zones and "is this reading inside the zone" — pure, no device or network code.
 * The five-zone template is the same one the website's onboarding writes
 * (web/src/lib/zones.js); the two must stay in step.
 */
export type Zone = {
  id?: string;
  name: string;
  zone_number: number;
  fast_sec: number;
  slow_sec: number;
  hr_min_pct: number | null;
  hr_max_pct: number | null;
  color?: string;
};
export type ZoneRecord = Zone & { intensity: string; purpose: string; feel: string; sort_order: number; color: string };
export type PaceStatus = 'in' | 'faster' | 'slower' | 'unknown';
export type HrStatus = 'in' | 'above' | 'below' | 'unknown';
export type HrBounds = { min: number; max: number };
export type Profile = { id: string; hr_max: number | null; threshold_sec: number | null };

const SPECS = [
  { n: 1, intensity: 'Very Light', lo: 50, hi: 60, color: '#6FA8FF', slow: 1.4, fast: 1.28,
    purpose: 'Active recovery, warm-up and cool-down',
    feel: 'Effortless. You can sing, talk continuously and breathe through your nose.' },
  { n: 2, intensity: 'Light', lo: 60, hi: 70, color: '#C9F84A', slow: 1.28, fast: 1.15,
    purpose: 'Building aerobic base and endurance',
    feel: 'Comfortable. Full conversation, deeper breathing. Sustainable for hours.' },
  { n: 3, intensity: 'Moderate', lo: 70, hi: 80, color: '#7ED957', slow: 1.15, fast: 1.06,
    purpose: 'Improving aerobic capacity and efficiency',
    feel: 'Challenging but manageable. Short sentences. Needs focus to hold.' },
  { n: 4, intensity: 'Hard', lo: 80, hi: 90, color: '#FFC24B', slow: 1.06, fast: 1.0,
    purpose: 'Raising anaerobic threshold and speed endurance',
    feel: 'Uncomfortable. Single words only. Legs start to burn.' },
  { n: 5, intensity: 'Maximum', lo: 90, hi: 100, color: '#FF6A3D', slow: 1.0, fast: 0.93,
    purpose: 'Developing peak power and anaerobic capacity',
    feel: 'All-out. Speaking is impossible. Short sprints and intervals.' },
];

/** Five zone records for a threshold pace in seconds per mile. */
export function zoneTemplate(thresholdSec: number): ZoneRecord[] {
  const t = thresholdSec > 0 ? thresholdSec : 600;
  return SPECS.map((s) => ({
    name: `Zone ${s.n}`,
    zone_number: s.n,
    intensity: s.intensity,
    hr_min_pct: s.lo,
    hr_max_pct: s.hi,
    fast_sec: Math.round(t * s.fast),
    slow_sec: Math.round(t * s.slow),
    color: s.color,
    purpose: s.purpose,
    feel: s.feel,
    sort_order: s.n,
  }));
}

export function sortZones<T extends Zone>(zones: T[]): T[] {
  return [...zones].sort((a, b) => (Number(a.zone_number) || 99) - (Number(b.zone_number) || 99) || a.fast_sec - b.fast_sec);
}

/** The route's own zone when it still exists, else Zone 2, else the first zone. */
export function defaultZone<T extends Zone>(zones: T[], routeZoneId?: string | null): T | null {
  const sorted = sortZones(zones);
  return (routeZoneId ? sorted.find((z) => z.id === routeZoneId) : undefined)
    ?? sorted.find((z) => Number(z.zone_number) === 2)
    ?? sorted[0]
    ?? null;
}

/** Heart-rate range of a zone in beats per minute. Null when it cannot be known: never guessed. */
export function hrBounds(zone: Zone, hrMax: number | null | undefined): HrBounds | null {
  const lo = zone.hr_min_pct;
  const hi = zone.hr_max_pct;
  if (!hrMax || !Number.isFinite(hrMax) || hrMax <= 0) return null;
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) return null;
  return { min: Math.round((hrMax * lo) / 100), max: Math.round((hrMax * hi) / 100) };
}

export function paceStatus(zone: Zone, paceSec: number | null): PaceStatus {
  if (paceSec == null || !Number.isFinite(paceSec) || paceSec <= 0) return 'unknown';
  if (paceSec < zone.fast_sec) return 'faster';
  if (paceSec > zone.slow_sec) return 'slower';
  return 'in';
}

export function hrStatus(bounds: HrBounds | null, bpm: number | null): HrStatus {
  if (!bounds || bpm == null || !Number.isFinite(bpm) || bpm <= 0) return 'unknown';
  if (bpm > bounds.max) return 'above';
  if (bpm < bounds.min) return 'below';
  return 'in';
}

/** "8:30" -> 510 seconds per mile. Accepts 3:00 to 20:00. */
export function parsePace(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  const sec = Number(match[1]) * 60 + Number(match[2]);
  return sec >= 180 && sec <= 1200 ? sec : null;
}

export function formatPace(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '--:--';
  const whole = Math.round(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function validHrMax(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 230;
}

/** Tanaka estimate (208 − 0.7 × age), the same formula the website uses. */
export function estimateHrMax(age: number): number | null {
  if (!Number.isFinite(age) || age < 12 || age > 90) return null;
  return Math.round(208 - 0.7 * age);
}

/** A runner cannot be coached without zones and a max heart rate. */
export function needsSetup(profile: Profile | null, zones: Zone[]): boolean {
  return !profile || !profile.hr_max || !validHrMax(Math.round(profile.hr_max)) || zones.length === 0;
}
