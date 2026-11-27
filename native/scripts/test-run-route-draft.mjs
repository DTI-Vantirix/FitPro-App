import assert from 'node:assert/strict';
import { load, test, done, at, near } from './run-test-kit.mjs';

const draft = load('src/run/route-draft.ts');
const A = at(0, 0);
const B = at(0, 1609.344);
const C = at(1609.344, 1609.344);

await test('adding: the first point is never off-road, later ones follow the mode', () => {
  const one = draft.addPoint([], A, true);
  assert.deepEqual(one, [{ lat: A.lat, lng: A.lng }]);
  const two = draft.addPoint(one, B, false);
  assert.deepEqual(two[1], { lat: B.lat, lng: B.lng });
  const three = draft.addPoint(two, C, true);
  assert.deepEqual(three[2], { lat: C.lat, lng: C.lng, offroad: true });
  assert.equal(one.length, 1, 'the earlier list is not changed');
});
await test('adding: extra fields and unusable positions are not taken', () => {
  assert.deepEqual(draft.addPoint([], { lat: A.lat, lng: A.lng, accuracy: 5 }, false), [{ lat: A.lat, lng: A.lng }]);
  const one = [{ lat: A.lat, lng: A.lng }];
  assert.equal(draft.addPoint(one, { lat: 999, lng: 0 }, false), one);
  assert.equal(draft.addPoint(one, { lat: NaN, lng: 0 }, false), one);
});
await test('adding stops at the server limit of 40 waypoints', () => {
  let points = [];
  for (let i = 0; i < 45; i += 1) points = draft.addPoint(points, at(i * 10, 0), false);
  assert.equal(draft.MAX_WAYPOINTS, 40);
  assert.equal(points.length, 40);
  assert.equal(draft.atLimit(points), true);
  assert.equal(draft.atLimit(points.slice(1)), false);
});
await test('moving a point keeps how it joins the route', () => {
  const points = draft.addPoint(draft.addPoint(draft.addPoint([], A, false), B, true), C, false);
  const moved = draft.movePoint(points, 1, at(50, 50));
  assert.deepEqual(moved[1], { ...at(50, 50), offroad: true });
  assert.deepEqual([moved[0], moved[2]], [points[0], points[2]]);
  assert.equal(points[1].lat, B.lat, 'the earlier list is not changed');
  assert.equal(draft.movePoint(points, 7, A), points);
  assert.equal(draft.movePoint(points, 1, { lat: 0, lng: 999 }), points);
  // Dragging the start can never make it off-road.
  assert.equal('offroad' in draft.movePoint(points, 0, at(5, 5))[0], false);
});
await test('undo removes the last point only', () => {
  const points = draft.addPoint(draft.addPoint([], A, false), B, true);
  assert.deepEqual(draft.undoPoint(points), [points[0]]);
  assert.deepEqual(draft.undoPoint([]), []);
});
await test('off-road is reported only when a point carries it', () => {
  assert.equal(draft.hasOffroad(draft.addPoint(draft.addPoint([], A, false), B, false)), false);
  assert.equal(draft.hasOffroad(draft.addPoint(draft.addPoint([], A, false), B, true)), true);
});
await test('each marker knows its part: start, finish, or a point between', () => {
  assert.deepEqual([0, 1, 2].map((i) => draft.pointRole(i, 3)), ['start', 'between', 'finish']);
  assert.equal(draft.pointRole(0, 1), 'start');
});
await test('distance: the snapped figure when there is one, else straight between the points', () => {
  assert.equal(draft.draftDistanceMi([], null), 0);
  assert.equal(draft.draftDistanceMi([A], null), 0);
  near(draft.draftDistanceMi([A, B], null), 1, 0.005);
  near(draft.draftDistanceMi([A, B, C], null), 2, 0.01);
  assert.equal(draft.draftDistanceMi([A, B], { snapped: true, path: [A, C, B], distanceMi: 2.345 }), 2.345);
  // A snap without a usable figure is measured along its line.
  near(draft.draftDistanceMi([A, B], { snapped: true, path: [A, C, B], distanceMi: null }), 2.41, 0.02);
  // A snap with no line is ignored.
  near(draft.draftDistanceMi([A, B], { snapped: false, path: [], distanceMi: 9 }), 1, 0.005);
});
await test('saving needs a name and two points', () => {
  assert.equal(draft.canSave('Loop', [A, B]), true);
  assert.equal(draft.canSave('   ', [A, B]), false);
  assert.equal(draft.canSave('Loop', [A]), false);
});
await test('the record to save: tidy name, 2-decimal distance, snapped path, zone', () => {
  const points = draft.addPoint(draft.addPoint([], A, false), B, true);
  const snap = { snapped: true, path: [A, C, B], distanceMi: 2.3456 };
  assert.deepEqual(draft.routeRecord({ name: '  River loop ', points, snap, zone: { id: 'z2', name: 'Zone 2' } }), {
    name: 'River loop',
    distance_mi: 2.35,
    points: [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng, offroad: true }],
    path: [A, C, B],
    target_zone_id: 'z2',
    target_zone_name: 'Zone 2',
  });
});
await test('the record to save: without a snapped line the points are the path, and no zone is empty text', () => {
  const points = draft.addPoint(draft.addPoint([], A, false), B, true);
  const record = draft.routeRecord({ name: 'Field', points, snap: null, zone: null });
  assert.deepEqual(record.path, [{ lat: A.lat, lng: A.lng }, { lat: B.lat, lng: B.lng }]);
  assert.deepEqual([record.target_zone_id, record.target_zone_name], ['', '']);
  near(record.distance_mi, 1, 0.005);
  assert.equal(record.distance_mi, Number(record.distance_mi.toFixed(2)));
});
await test('only the answer to the latest request is used', () => {
  const latest = draft.latestOnly();
  const first = latest.begin();
  const second = latest.begin();
  assert.equal(latest.isCurrent(first), false);
  assert.equal(latest.isCurrent(second), true);
  latest.cancel();
  assert.equal(latest.isCurrent(second), false);
});
await test('preview: a region that holds the whole line with room to spare', () => {
  const region = draft.previewRegion([A, B, C]);
  near(region.latitude, (A.lat + C.lat) / 2, 1e-9);
  near(region.longitude, (A.lng + B.lng) / 2, 1e-9);
  assert.ok(region.latitudeDelta > C.lat - A.lat && region.longitudeDelta > B.lng - A.lng);
  // A line with no extent still gets a sensible window, never a zero-sized one.
  const dot = draft.previewRegion([A, A]);
  assert.ok(dot.latitudeDelta >= 0.004 && dot.longitudeDelta >= 0.004);
  assert.equal(draft.previewRegion([]), null);
});
done('route draft');
