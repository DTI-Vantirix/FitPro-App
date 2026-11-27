import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const z = load('src/run/zones.ts');
const zones = z.zoneTemplate(600).map((zone, i) => ({ ...zone, id: `z${i + 1}` }));
const zone2 = zones[1];

await test('template matches the web onboarding', () => {
  assert.equal(zones.length, 5);
  assert.deepEqual({ name: zone2.name, fast: zone2.fast_sec, slow: zone2.slow_sec, lo: zone2.hr_min_pct, hi: zone2.hr_max_pct, n: zone2.zone_number, order: zone2.sort_order },
    { name: 'Zone 2', fast: 690, slow: 768, lo: 60, hi: 70, n: 2, order: 2 });
  assert.deepEqual([zones[0].fast_sec, zones[0].slow_sec, zones[4].fast_sec, zones[4].slow_sec], [768, 840, 558, 600]);
  assert.equal(zones[4].color, '#C6FF00');
  assert.equal(z.zoneTemplate(0)[3].slow_sec, 636); // falls back to 600 like the web
});
await test('heart-rate bounds are the zone percentages of max heart rate', () => {
  assert.deepEqual(z.hrBounds(zone2, 190), { min: 114, max: 133 });
  assert.equal(z.hrBounds(zone2, null), null);
  assert.equal(z.hrBounds(zone2, 0), null);
  assert.equal(z.hrBounds({ ...zone2, hr_min_pct: null }, 190), null);
});
await test('pace status', () => {
  assert.equal(z.paceStatus(zone2, 680), 'faster');
  assert.equal(z.paceStatus(zone2, 690), 'in');
  assert.equal(z.paceStatus(zone2, 768), 'in');
  assert.equal(z.paceStatus(zone2, 800), 'slower');
  assert.equal(z.paceStatus(zone2, null), 'unknown');
  assert.equal(z.paceStatus(zone2, 0), 'unknown');
});
await test('heart-rate status', () => {
  const b = { min: 114, max: 133 };
  assert.equal(z.hrStatus(b, 140), 'above');
  assert.equal(z.hrStatus(b, 114), 'in');
  assert.equal(z.hrStatus(b, 100), 'below');
  assert.equal(z.hrStatus(b, null), 'unknown');
  assert.equal(z.hrStatus(null, 140), 'unknown');
});
await test('default zone: the route zone, else Zone 2, else the first', () => {
  assert.equal(z.defaultZone(zones, 'z4').id, 'z4');
  assert.equal(z.defaultZone(zones, 'gone').id, 'z2');
  assert.equal(z.defaultZone(zones, null).id, 'z2');
  assert.equal(z.defaultZone([zones[3], zones[2]], null).id, 'z3');
  assert.equal(z.defaultZone([], null), null);
});
await test('pace text', () => {
  assert.equal(z.parsePace('8:30'), 510);
  assert.equal(z.parsePace(' 10:05 '), 605);
  for (const bad of ['830', '25:00', '2:30', '8:75', '', 'abc']) assert.equal(z.parsePace(bad), null, bad);
  assert.equal(z.formatPace(510), '8:30');
  assert.equal(z.formatPace(599.6), '10:00');
  assert.equal(z.formatPace(null), '--:--');
});
await test('max heart rate range and estimate', () => {
  assert.equal(z.validHrMax(190), true);
  for (const bad of [99, 231, NaN, 150.5]) assert.equal(z.validHrMax(bad), false);
  assert.equal(z.estimateHrMax(40), 180);
  assert.equal(z.estimateHrMax(5), null);
});
await test('setup is needed until there is a max heart rate and zones', () => {
  assert.equal(z.needsSetup(null, zones), true);
  assert.equal(z.needsSetup({ id: 'p', hr_max: null, threshold_sec: 600 }, zones), true);
  assert.equal(z.needsSetup({ id: 'p', hr_max: 190, threshold_sec: 600 }, []), true);
  assert.equal(z.needsSetup({ id: 'p', hr_max: 190, threshold_sec: null }, zones), false);
});
await test('zone colours: one ramp from Steel to Volt, by zone number, as on the website', () => {
  assert.deepEqual(zones.map((zone) => z.zoneColor(zone)), ['#8A8A93', '#A6A6AE', '#F5F5F2', '#9FCC00', '#C6FF00']);
  assert.equal(z.zoneColor({ ...zone2, color: '#FF0000' }), '#A6A6AE');                    // a stored pre-rebrand colour is ignored
  assert.equal(z.zoneColor({ ...zone2, zone_number: 0, color: '#9fcc00' }), '#9FCC00');   // custom zone: its own, when it is on the ramp
  assert.equal(z.zoneColor({ ...zone2, zone_number: 0, color: '#FF0000' }), '#C6FF00');
  assert.equal(z.zoneColor({ ...zone2, zone_number: 9, color: undefined }), '#C6FF00');
});
await test('zone details: what is stored, else the standard text for that zone number', () => {
  assert.deepEqual(z.zoneDetails({ ...zone2, intensity: 'Steady', purpose: 'Mine', feel: 'Fine' }), { intensity: 'Steady', purpose: 'Mine', feel: 'Fine' });
  const { id, name, zone_number, fast_sec, slow_sec, hr_min_pct, hr_max_pct } = zone2;
  assert.deepEqual(z.zoneDetails({ id, name, zone_number, fast_sec, slow_sec, hr_min_pct, hr_max_pct }),
    { intensity: 'Light', purpose: 'Building aerobic base and endurance', feel: 'Comfortable. Full conversation, deeper breathing. Sustainable for hours.' });
  assert.deepEqual(z.zoneDetails({ name: 'Easy', zone_number: 0, fast_sec: 500, slow_sec: 600, hr_min_pct: null, hr_max_pct: null }), { intensity: '', purpose: '', feel: '' });
});
await test('heart-rate band text: percent of max, with beats per minute when max is known', () => {
  assert.equal(z.hrBandLabel(zone2, 190), '60–70% max HR · 114–133 bpm');
  assert.equal(z.hrBandLabel(zone2, null), '60–70% max HR');
  assert.equal(z.hrBandLabel({ ...zone2, hr_min_pct: null }, 190), '');
});
await test('editing a zone: a name and a pace range, fastest before slowest', () => {
  assert.deepEqual(z.parseZoneEdit(' Easy ', '9:00', '10:15'), { ok: true, values: { name: 'Easy', fast_sec: 540, slow_sec: 615 } });
  assert.deepEqual(z.parseZoneEdit('', '9:00', '10:00'), { ok: false, error: 'Give the zone a name.' });
  assert.equal(z.parseZoneEdit('x'.repeat(41), '9:00', '10:00').ok, false);
  for (const [fast, slow] of [['900', '10:00'], ['9:00', ''], ['2:00', '10:00'], ['9:00', '25:00']]) {
    assert.deepEqual(z.parseZoneEdit('Easy', fast, slow), { ok: false, error: 'Enter each pace as minutes:seconds, between 3:00 and 20:00.' });
  }
  assert.deepEqual(z.parseZoneEdit('Easy', '10:00', '9:00'), { ok: false, error: 'The slowest pace must be slower than the fastest.' });
  assert.equal(z.parseZoneEdit('Easy', '9:00', '9:00').ok, false);
});
await test('changing the profile: zones are rebuilt only when there are none or the threshold pace changed', () => {
  const known = { id: 'p', hr_max: 185, threshold_sec: 600 };
  assert.deepEqual(z.profileChange({ hrMax: 190, thresholdSec: 540, known, hasZones: true }), { values: { hr_max: 190, threshold_sec: 540 }, rebuildZones: true });
  assert.deepEqual(z.profileChange({ hrMax: 190, thresholdSec: 600, known, hasZones: true }), { values: { hr_max: 190 }, rebuildZones: false });
  assert.deepEqual(z.profileChange({ hrMax: 190, thresholdSec: null, known, hasZones: true }), { values: { hr_max: 190 }, rebuildZones: false });
  assert.deepEqual(z.profileChange({ hrMax: 190, thresholdSec: 540, known: null, hasZones: false }), { values: { hr_max: 190, threshold_sec: 540 }, rebuildZones: true });
  // Zones made on the website with no threshold on the profile: typing one in is a change.
  assert.deepEqual(z.profileChange({ hrMax: 190, thresholdSec: 540, known: { ...known, threshold_sec: null }, hasZones: true }).rebuildZones, true);
  assert.equal(z.profileChange({ hrMax: 99, thresholdSec: 540, known, hasZones: true }), null);
  assert.equal(z.profileChange({ hrMax: 190, thresholdSec: null, known: null, hasZones: false }), null);
});
done('zones, status, pace text, setup gate');
