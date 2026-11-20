export const ZONE_COLORS = ['#6FA8FF', '#C9F84A', '#7ED957', '#FFC24B', '#FF6A3D'];

/**
 * The five training zones. Heart-rate bands are a percent of max heart rate;
 * pace bands are a multiple of threshold pace (the pace you could hold for
 * about an hour, roughly 88% of the speed at VO2max).
 */
export const ZONE_SPECS = [
  {
    zone_number: 1,
    name: 'Zone 1',
    intensity: 'Very Light',
    hr_min_pct: 50,
    hr_max_pct: 60,
    purpose: 'Active recovery, warm-up and cool-down',
    feel: 'Effortless. You can sing, talk continuously and breathe through your nose.',
    color: '#6FA8FF',
    slow_factor: 1.4,
    fast_factor: 1.28,
  },
  {
    zone_number: 2,
    name: 'Zone 2',
    intensity: 'Light',
    hr_min_pct: 60,
    hr_max_pct: 70,
    purpose: 'Building aerobic base and endurance',
    feel: 'Comfortable. Full conversation, deeper breathing. Sustainable for hours.',
    color: '#C9F84A',
    slow_factor: 1.28,
    fast_factor: 1.15,
  },
  {
    zone_number: 3,
    name: 'Zone 3',
    intensity: 'Moderate',
    hr_min_pct: 70,
    hr_max_pct: 80,
    purpose: 'Improving aerobic capacity and efficiency',
    feel: 'Challenging but manageable. Short sentences. Needs focus to hold.',
    color: '#7ED957',
    slow_factor: 1.15,
    fast_factor: 1.06,
  },
  {
    zone_number: 4,
    name: 'Zone 4',
    intensity: 'Hard',
    hr_min_pct: 80,
    hr_max_pct: 90,
    purpose: 'Raising anaerobic threshold and speed endurance',
    feel: 'Uncomfortable. Single words only. Legs start to burn.',
    color: '#FFC24B',
    slow_factor: 1.06,
    fast_factor: 1.0,
  },
  {
    zone_number: 5,
    name: 'Zone 5',
    intensity: 'Maximum',
    hr_min_pct: 90,
    hr_max_pct: 100,
    purpose: 'Developing peak power and anaerobic capacity',
    feel: 'All-out. Speaking is impossible. Short sprints and intervals.',
    color: '#FF6A3D',
    slow_factor: 1.0,
    fast_factor: 0.93,
  },
];

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Estimates max heart rate, VO2max and threshold pace from age, height and
 * weight. Max HR uses the Tanaka formula (208 − 0.7 × age); VO2max uses the
 * Jackson non-exercise estimate with a moderate activity level assumed;
 * threshold pace is 88% of the speed at VO2max.
 */
export function estimateZones({ age, sex, height_in, weight_lb } = {}) {
  const a = clamp(Number(age) || 35, 12, 90);
  const hIn = clamp(Number(height_in) || 70, 40, 90);
  const wLb = clamp(Number(weight_lb) || 170, 60, 500);

  const hrMax = Math.round(208 - 0.7 * a);
  const bmi = (wLb * 0.453592) / (hIn * 0.0254) ** 2;
  const sexTerm = sex === 'female' ? 0 : 10.987;
  const vo2max = clamp(56.363 + 1.921 * 4 - 0.381 * a - 0.754 * bmi + sexTerm, 25, 70);
  const metersPerMinute = (vo2max - 3.5) / 0.2;
  const paceAtVo2max = (1609.344 / metersPerMinute) * 60;
  const threshold = clamp(paceAtVo2max / 0.88, 270, 960);

  return {
    hr_max: hrMax,
    bmi: Number(bmi.toFixed(1)),
    vo2max: Number(vo2max.toFixed(1)),
    threshold_sec: Math.round(threshold),
  };
}

/** Five zone records for a given threshold pace (seconds per mile). */
export function zoneTemplate(thresholdSec) {
  const t = thresholdSec > 0 ? thresholdSec : 600;
  return ZONE_SPECS.map((spec) => ({
    name: spec.name,
    zone_number: spec.zone_number,
    intensity: spec.intensity,
    hr_min_pct: spec.hr_min_pct,
    hr_max_pct: spec.hr_max_pct,
    fast_sec: Math.round(t * spec.fast_factor),
    slow_sec: Math.round(t * spec.slow_factor),
    color: spec.color,
    purpose: spec.purpose,
    feel: spec.feel,
    sort_order: spec.zone_number,
  }));
}

export function sortZones(zones = []) {
  return [...zones].sort(
    (a, b) => (Number(a.zone_number) || 99) - (Number(b.zone_number) || 99) || a.fast_sec - b.fast_sec
  );
}

function shortPace(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

export function zoneRangeLabel(zone) {
  if (!zone) return '';
  return `${shortPace(zone.fast_sec)}–${shortPace(zone.slow_sec)}`;
}

export function hrLabel(zone) {
  if (zone?.hr_min_pct == null || zone?.hr_max_pct == null) return '';
  return `${zone.hr_min_pct}–${zone.hr_max_pct}% max HR`;
}