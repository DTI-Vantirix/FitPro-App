import assert from 'node:assert/strict';
import { load, test, done } from './run-test-kit.mjs';

const c = load('src/social/challenges.ts');

await test('runs only: the two metrics the website offers, workouts hidden', () => {
  assert.deepEqual(c.METRIC_ORDER, ['distance', 'runs']);
  assert.deepEqual(c.METRIC_ORDER.map((id) => [c.METRICS[id].label, c.METRICS[id].unit, c.METRICS[id].goalHint]),
    [['Miles run', 'mi', '100'], ['Runs logged', 'runs', '20']]);
  assert.deepEqual(c.visibleChallenges([{ id: 'a', metric: 'distance' }, { id: 'b', metric: 'workouts' }, { id: 'c', metric: 'runs' }]).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(c.visibleChallenges(null), []);
});

await test('month keys and the month window, in local time', () => {
  assert.equal(c.currentMonthKey(new Date(2026, 10, 27)), '2026-11');
  assert.equal(c.currentMonthKey(new Date(2027, 0, 1)), '2027-01');
  const win = c.monthWindow('2026-11', 'en-US');
  assert.equal(win.start_date, new Date(2026, 10, 1).toISOString());
  assert.equal(win.end_date, new Date(2026, 11, 1).toISOString());
  assert.equal(win.label, 'November 2026');
  // December rolls into the next year.
  assert.equal(c.monthWindow('2026-12', 'en-US').end_date, new Date(2027, 0, 1).toISOString());
  assert.deepEqual(c.monthOptions(3, new Date(2026, 10, 27), 'en-US'),
    [{ key: '2026-11', label: 'November 2026' }, { key: '2026-12', label: 'December 2026' }, { key: '2027-01', label: 'January 2027' }]);
});

await test('values and goals read as on the website', () => {
  assert.equal(c.formatValue('distance', 12.345), '12.3 mi');
  assert.equal(c.formatValue('distance', null), '0.0 mi');
  assert.equal(c.formatValue('runs', 1), '1 run');
  assert.equal(c.formatValue('runs', 7.4), '7 runs');
  assert.equal(c.goalLabel({ metric: 'distance', targetValue: 100 }), '100 mi');
  assert.equal(c.goalLabel({ metric: 'runs', targetValue: 20 }), '20 runs');
  assert.equal(c.goalLabel(null), '0 mi');
});

await test('days left never goes below zero', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  assert.equal(c.daysLeft('2026-12-01T00:00:00.000Z', now), 4);
  assert.equal(c.daysLeft('2026-11-27T12:00:01.000Z', now), 1);
  assert.equal(c.daysLeft('2026-11-01T00:00:00.000Z', now), 0);
  assert.equal(c.daysLeft(null, now), 0);
  assert.equal(c.daysLeft('nonsense', now), 0);
});

await test('the goal box keeps digits and dots only', () => {
  assert.equal(c.cleanTarget('1o0.5 mi'), '10.5');
  assert.equal(c.cleanTarget('-20'), '20');
});

await test('a new challenge: the website\'s record, checks and wording', () => {
  assert.deepEqual(c.challengeDraft({ name: 'November 100', description: '', metric: 'distance', target: '0', month: '2026-11', handle: 'ana' }),
    { ok: false, error: 'Set a goal above zero.' });
  assert.deepEqual(c.challengeDraft({ name: 'November 100', description: '', metric: 'distance', target: 'abc', month: '2026-11', handle: 'ana' }),
    { ok: false, error: 'Set a goal above zero.' });
  assert.equal(c.challengeDraft({ name: '   ', description: '', metric: 'distance', target: '100', month: '2026-11', handle: 'ana' }).ok, false);
  const draft = c.challengeDraft({ name: ' November 100 ', description: ' 100 miles before the month is out ', metric: 'distance', target: '100', month: '2026-11', handle: 'ana' });
  assert.deepEqual(draft, { ok: true, record: {
    name: 'November 100', description: '100 miles before the month is out', metric: 'distance', target_value: 100, month: '2026-11',
    start_date: new Date(2026, 10, 1).toISOString(), end_date: new Date(2026, 11, 1).toISOString(), creator_handle: 'ana',
  } });
  assert.equal(c.challengeDraft({ name: 'Twenty', description: '', metric: 'runs', target: '20', month: '2026-12', handle: '' }).record.metric, 'runs');
});

await test('gym is hidden: a workout challenge cannot be created from the phone', () => {
  assert.equal(c.challengeDraft({ name: 'Lift', description: '', metric: 'workouts', target: '10', month: '2026-11', handle: 'ana' }).ok, false);
  assert.equal(c.challengeDraft({ name: 'Odd', description: '', metric: 'steps', target: '10', month: '2026-11', handle: 'ana' }).ok, false);
});

await test('leaderboard bar: share of the goal, capped at 100', () => {
  assert.equal(c.progressPct(25, 100), 25);
  assert.equal(c.progressPct(140, 100), 100);
  assert.equal(c.progressPct(5, 0), 0);
  assert.equal(c.progressPct(1, 3), 33);
});

done('social challenges');
