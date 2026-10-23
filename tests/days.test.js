// Tagesabschnitte: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const D = require('../web/days.js');

test('Tagesüberschrift und Zeitraum', () => {
  assert.equal(D.dayLabel('2026-06-30'), 'Dienstag, 30.6.2026');
  assert.equal(D.rangeLabel('2026-06-30', '2026-10-15'), '30.06.–15.10.2026');
  assert.equal(D.rangeLabel('2025-12-30', '2026-01-02'), '30.12.2025–02.01.2026');
  assert.equal(D.rangeLabel('2026-06-30', '2026-06-30'), '30.06.2026');
  assert.equal(D.rangeLabel(null, null), '');
});

test('Tage eines Dokuments: oberste Ebene, sortiert, einmalig', () => {
  const doc = {type: 'doc', content: [{type: 'day', attrs: {date: '2026-07-01'}}, {type: 'paragraph'}, {type: 'day', attrs: {date: '2026-06-30'}},
    {type: 'day', attrs: {date: '2026-07-01'}}, {type: 'day', attrs: {date: 'kaputt'}}]};
  assert.deepEqual(D.daysOf(doc), ['2026-06-30', '2026-07-01']);
});
