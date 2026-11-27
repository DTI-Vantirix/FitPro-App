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
  /** Shown on the Pace zones screen only; coaching never reads them. */
  intensity?: string;
  purpose?: string;
  feel?: string;
};
export type ZoneRecord = Zone & { intensity: string; purpose: string; feel: string; sort_order: number; color: string };
export type PaceStatus = 'in' | 'faster' | 'slower' | 'unknown';
export type HrStatus = 'in' | 'above' | 'below' | 'unknown';
export type HrBounds = { min: number; max: number };
export type Sex = 'male' | 'female';
/** What the estimate is made from, in the website's units: years, inches, pounds. */
export type Body = { age: number; sex: Sex; height_in: number; weight_lb: number };
/** The Profile record (server/entities/Profile.json). Coaching reads the first two numbers; the
 * rest are what the website's profile form stores, kept so both forms show the same thing. */
export type Profile = {
  id: string;
  hr_max: number | null;
  threshold_sec: number | null;
  age?: number | null;
  sex?: Sex | null;
  height_in?: number | null;
  weight_lb?: number | null;
  vo2max?: number | null;
  /** The threshold pace the estimate gave, beside the one in use. */
  auto_threshold_sec?: number | null;
};
/** What a save of the profile form writes. */
export type ProfileValues = { hr_max: number; threshold_sec?: number } & Partial<Body> & { vo2max?: number; auto_threshold_sec?: number };

// Zone colours are one ramp, Steel through Chalk to Volt (brand: a single accent). Literal hex because this
// file stays pure; the values mirror brand.* in src/theme.ts. Number and name always accompany the colour.
const SPECS = [
  { n: 1, intensity: 'Very Light', lo: 50, hi: 60, color: '#8A8A93', slow: 1.4, fast: 1.28,
    purpose: 'Active recovery, warm-up and cool-down',
    feel: 'Effortless. You can sing, talk continuously and breathe through your nose.' },
  { n: 2, intensity: 'Light', lo: 60, hi: 70, color: '#A6A6AE', slow: 1.28, fast: 1.15,
    purpose: 'Building aerobic base and endurance',
    feel: 'Comfortable. Full conversation, deeper breathing. Sustainable for hours.' },
  { n: 3, intensity: 'Moderate', lo: 70, hi: 80, color: '#F5F5F2', slow: 1.15, fast: 1.06,
    purpose: 'Improving aerobic capacity and efficiency',
    feel: 'Challenging but manageable. Short sentences. Needs focus to hold.' },
  { n: 4, intensity: 'Hard', lo: 80, hi: 90, color: '#9FCC00', slow: 1.06, fast: 1.0,
    purpose: 'Raising anaerobic threshold and speed endurance',
    feel: 'Uncomfortable. Single words only. Legs start to burn.' },
  { n: 5, intensity: 'Maximum', lo: 90, hi: 100, color: '#C6FF00', slow: 1.0, fast: 0.93,
    purpose: 'Developing peak power and anaerobic capacity',
    feel: 'All-out. Speaking is impossible. Short sprints and intervals.' },
];

export const ZONE_COLORS = SPECS.map((s) => s.color);

/** The colour to draw a zone in, by the website's rule (web/src/lib/zones.js): the five standard
 * zones by number, whatever colour was stored before the rebrand; any other zone its own colour
 * when that is on the ramp, else Volt. */
export function zoneColor(zone: { zone_number?: number | null; color?: string | null }): string {
  const n = Number(zone.zone_number);
  if (n >= 1 && n <= 5) return ZONE_COLORS[Math.floor(n) - 1];
  const stored = String(zone.color ?? '').toUpperCase();
  return ZONE_COLORS.includes(stored) ? stored : ZONE_COLORS[4];
}

/** Intensity, purpose and talk test of a zone: what is stored, else the standard text for its number. */
export function zoneDetails(zone: Zone): { intensity: string; purpose: string; feel: string } {
  const spec = SPECS.find((s) => s.n === Number(zone.zone_number));
  return {
    intensity: zone.intensity ?? spec?.intensity ?? '',
    purpose: zone.purpose ?? spec?.purpose ?? '',
    feel: zone.feel ?? spec?.feel ?? '',
  };
}

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

/** One of the five zones built from the threshold pace, as against a zone the runner added. */
export function isStandardZone(zone: { zone_number?: number | null }): boolean {
  const n = Number(zone.zone_number);
  return Number.isInteger(n) && n >= 1 && n <= 5;
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

/** "60–70% max HR · 114–133 bpm"; the beats only when max heart rate is known. Empty when the zone has no band. */
export function hrBandLabel(zone: Zone, hrMax: number | null | undefined): string {
  if (zone.hr_min_pct == null || zone.hr_max_pct == null) return '';
  const bounds = hrBounds(zone, hrMax);
  return `${zone.hr_min_pct}–${zone.hr_max_pct}% max HR${bounds ? ` · ${bounds.min}–${bounds.max} bpm` : ''}`;
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

export type ZoneEdit = { name: string; fast_sec: number; slow_sec: number };

/** What the runner typed when editing a zone, checked as the website's editor checks it. */
export function parseZoneEdit(name: string, fastText: string, slowText: string): { ok: true; values: ZoneEdit } | { ok: false; error: string } {
  const label = name.trim();
  if (!label) return { ok: false, error: 'Give the zone a name.' };
  if (label.length > 40) return { ok: false, error: 'Keep the name to 40 characters.' };
  const fast = parsePace(fastText);
  const slow = parsePace(slowText);
  if (fast == null || slow == null) return { ok: false, error: 'Enter each pace as minutes:seconds, between 3:00 and 20:00.' };
  if (slow <= fast) return { ok: false, error: 'The slowest pace must be slower than the fastest.' };
  return { ok: true, values: { name: label, fast_sec: fast, slow_sec: slow } };
}

/** A zone the runner adds, as the website's zone editor creates it: no number, no heart-rate
 * band, a colour from the ramp (its second, as there, when none or another is given) and the
 * next place in the order. */
export type NewZone = ZoneEdit & { color: string; sort_order: number };

export function newZone(name: string, fastText: string, slowText: string, color: string, zoneCount: number): { ok: true; values: NewZone } | { ok: false; error: string } {
  const parsed = parseZoneEdit(name, fastText, slowText);
  if (!parsed.ok) return parsed;
  const picked = String(color ?? '').toUpperCase();
  return { ok: true, values: { ...parsed.values, color: ZONE_COLORS.includes(picked) ? picked : ZONE_COLORS[1], sort_order: Math.max(0, Math.floor(zoneCount) || 0) + 1 } };
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

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Max heart rate, VO2max and threshold pace estimated from age, sex, height and weight: the
 * website's estimateZones (web/src/lib/zones.js), line for line, so both give the same numbers.
 * Max HR is Tanaka (208 − 0.7 × age); VO2max is the Jackson non-exercise estimate with a
 * moderate activity level; threshold pace is 88% of the speed at VO2max. Out-of-range or
 * missing input is clamped or defaulted exactly as there. */
export function estimateZones(input: { age?: unknown; sex?: unknown; height_in?: unknown; weight_lb?: unknown } = {}):
  { hr_max: number; bmi: number; vo2max: number; threshold_sec: number } {
  const a = clamp(Number(input.age) || 35, 12, 90);
  const hIn = clamp(Number(input.height_in) || 70, 40, 90);
  const wLb = clamp(Number(input.weight_lb) || 170, 60, 500);

  const hrMax = Math.round(208 - 0.7 * a);
  const bmi = (wLb * 0.453592) / (hIn * 0.0254) ** 2;
  const sexTerm = input.sex === 'female' ? 0 : 10.987;
  const vo2max = clamp(56.363 + 1.921 * 4 - 0.381 * a - 0.754 * bmi + sexTerm, 25, 70);
  const metersPerMinute = (vo2max - 3.5) / 0.2;
  const paceAtVo2max = (1609.344 / metersPerMinute) * 60;
  const threshold = clamp(paceAtVo2max / 0.88, 270, 960);

  return { hr_max: hrMax, bmi: Number(bmi.toFixed(1)), vo2max: Number(vo2max.toFixed(1)), threshold_sec: Math.round(threshold) };
}

const typedNumber = (text: string): number => (text.trim() === '' ? NaN : Number(text.trim()));
const within = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

/** The body numbers typed into the profile form, inside the limits the website's form accepts. */
export function parseBody(ageText: string, sex: string, heightText: string, weightText: string): { ok: true; values: Body } | { ok: false; error: string } {
  const age = typedNumber(ageText);
  const height = typedNumber(heightText);
  const weight = typedNumber(weightText);
  if (!within(age, 12, 90)) return { ok: false, error: 'Enter an age between 12 and 90.' };
  if (sex !== 'male' && sex !== 'female') return { ok: false, error: 'Choose male or female: the estimate differs between them.' };
  if (!within(height, 40, 90)) return { ok: false, error: 'Enter a height between 40 and 90 inches.' };
  if (!within(weight, 60, 500)) return { ok: false, error: 'Enter a weight between 60 and 500 pounds.' };
  return { ok: true, values: { age, sex, height_in: height, weight_lb: weight } };
}

/** True when the profile holds everything the estimate is made from. */
export function hasBody(profile: Profile | null | undefined): boolean {
  return !!profile && profile.age != null && profile.height_in != null && profile.weight_lb != null && (profile.sex === 'male' || profile.sex === 'female');
}

/** The runner's own threshold pace to show in the override box: only when it differs from the
 * estimate by more than three seconds, the website's rule. Empty otherwise. */
export function thresholdOverride(profile: Profile | null | undefined): string {
  const used = profile?.threshold_sec;
  const estimated = profile?.auto_threshold_sec;
  return used && estimated && Math.abs(used - estimated) > 3 ? formatPace(used) : '';
}

/** A runner cannot be coached without zones and a max heart rate. */
export function needsSetup(profile: Profile | null, zones: Zone[]): boolean {
  return !profile || !profile.hr_max || !validHrMax(Math.round(profile.hr_max)) || zones.length === 0;
}

/** What saving the setup form does. The five zones are (re)built from the threshold pace only
 * when there are none yet or the runner changed that pace; otherwise just the profile is saved
 * and zones the runner edited are left alone. Null when the form cannot be saved.
 *
 * With `body` the numbers are estimated from it and everything the website's profile form
 * stores is saved: the body numbers, max heart rate, VO2max and the estimated threshold pace;
 * `thresholdSec` is then the runner's own override, or null to use the estimate. `keepPace`
 * is for a runner who already has zones and is only asked for a max heart rate: the threshold
 * pace is neither asked for nor changed. */
export function profileChange(input: { hrMax: number; thresholdSec: number | null; known: Profile | null; hasZones: boolean; body?: Body | null; keepPace?: boolean }):
  { values: ProfileValues; rebuildZones: boolean } | null {
  const { known, hasZones, body } = input;
  const estimate = body ? estimateZones(body) : null;
  const hrMax = estimate ? estimate.hr_max : input.hrMax;
  if (!validHrMax(hrMax)) return null;
  const base: ProfileValues = estimate && body
    ? { age: body.age, sex: body.sex, height_in: body.height_in, weight_lb: body.weight_lb, hr_max: hrMax, vo2max: estimate.vo2max, auto_threshold_sec: estimate.threshold_sec }
    : { hr_max: hrMax };
  const thresholdSec = input.keepPace ? null : input.thresholdSec ?? estimate?.threshold_sec ?? null;
  if (thresholdSec == null) return hasZones ? { values: base, rebuildZones: false } : null;
  const changed = known?.threshold_sec == null || Math.round(known.threshold_sec) !== thresholdSec;
  return !hasZones || changed
    ? { values: { ...base, threshold_sec: thresholdSec }, rebuildZones: true }
    : { values: base, rebuildZones: false };
}
