// Kalender der Seitenleiste: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../web/sidecal.js');

test('Kalenderwochen nach ISO 8601', () => {
  assert.equal(C.isoWeek(new Date(2026, 0, 1)), 1);    // Donnerstag
  assert.equal(C.isoWeek(new Date(2021, 0, 1)), 53);   // gehört zur letzten Woche 2020
  assert.equal(C.isoWeek(new Date(2026, 11, 31)), 53);
  assert.equal(C.isoWeek(new Date(2024, 11, 30)), 1);  // Montag, gehört schon zu 2025
  assert.equal(C.isoWeek(new Date(2026, 9, 24)), 43);
});

test('Monatsraster beginnt am Montag und hat keine leere Schlusszeile', () => {
  const g = C.monthGrid(2026, 9);  // Oktober 2026: 1. ist Donnerstag
  assert.equal(g[0].days[0].iso, '2026-09-28');
  assert.equal(g[0].days[3].iso, '2026-10-01');
  assert.equal(g[0].days[3].inMonth, true);
  assert.equal(g[0].days[0].inMonth, false);
  assert.equal(g.length, 5);
  assert.equal(g.at(-1).days.at(-1).iso, '2026-11-01');
  assert.ok(g.every(w => w.days.length == 7));
  assert.equal(C.monthGrid(2026, 1).length, 5);  // Februar 2026 beginnt an einem Sonntag
});

test('Februar 2027 passt in vier Wochen, Juni 2026 braucht fünf', () => {
  assert.equal(C.monthGrid(2027, 1).length, 4);    // 1.2. ist Montag, 28 Tage
  assert.equal(C.monthGrid(2026, 5).length, 5);
  assert.equal(C.monthGrid(2025, 5).length, 6);    // 1.6.2025 ist Sonntag
});

test('Einträge je Tag: Spanne wie im Filter, auf den Ausschnitt begrenzt', () => {
  const rows = [
    {day_first: '2026-10-02', day_last: '2026-10-04', updated: '2026-10-20T10:00:00Z'},
    {updated: '2026-10-03T08:00:00Z', created: '2026-10-03T07:00:00Z'},
    {day_first: '2026-09-20', day_last: '2026-10-01', updated: '2026-10-01T00:00:00Z'},
    {updated: '2026-12-01T00:00:00Z', created: '2026-12-01T00:00:00Z'}];
  const m = C.markDays(rows, '2026-09-28', '2026-11-01');
  assert.equal(m['2026-10-02'], 1);
  assert.equal(m['2026-10-03'], 2);
  assert.equal(m['2026-10-04'], 1);
  assert.equal(m['2026-10-01'], 1);
  assert.equal(m['2026-09-28'], 1);
  assert.equal(m['2026-09-27'], undefined);
  assert.equal(m['2026-12-01'], undefined);
});

test('Monat weiterschalten über den Jahreswechsel', () => {
  assert.deepEqual(C.shiftMonth(2026, 11, 1), {year: 2027, month: 0});
  assert.deepEqual(C.shiftMonth(2026, 0, -1), {year: 2025, month: 11});
  assert.equal(C.label(2026, 9), 'Oktober 2026');
});
