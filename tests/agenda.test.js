// Fälligkeiten: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const A = require('../web/agenda.js');
const T = '2026-10-23';  // ein Freitag
const d = s => A.parseDue(s, T)?.date ?? null;

test('Datum in Aufgaben erkennen', () => {
  assert.equal(d('Antikörper bestellen bis 30.10.'), '2026-10-30');
  assert.equal(d('Gel laufen lassen 2026-11-02'), '2026-11-02');
  assert.equal(d('Bericht am 5.1.27'), '2027-01-05');
  assert.equal(d('Zellen splitten morgen'), '2026-10-24');
  assert.equal(d('heute auswerten'), T);
  assert.equal(d('Präsentation bis Montag'), '2026-10-26');
  assert.equal(d('Freitag Meeting'), '2026-10-30', 'gleicher Wochentag: nächste Woche');
  assert.equal(d('Probe 10.01. einfrieren'), '2027-01-10', 'Datum weit in der Vergangenheit: nächstes Jahr');
  assert.equal(d('Puffer ansetzen'), null);
  assert.equal(d('31.02. geht nicht'), null);
  assert.equal(d('Version 1.2.3 testen'), null);
  assert.deepEqual(A.parseDue('Gel bis 30.10. laufen', T), {date: '2026-10-30', from: 8, to: 14});
});

test('Einordnen in überfällig, heute, Woche, später', () => {
  const g = A.bucket([{due: '2026-10-20', title: 'a'}, {due: T, title: 'b'}, {due: '2026-10-25', title: 'c'}, {due: '2026-10-26', title: 'd'}], T);
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map(x => x.title)])), {overdue: ['a'], today: ['b'], week: ['c'], later: ['d']});
  assert.equal(A.relDay('2026-10-20', T), 'vor 3 Tagen'); assert.equal(A.relDay('2026-10-24', T), 'morgen');
});

test('iCalendar: ganztägig, maskiert, gefaltet, feste UID', () => {
  const ics = A.toICS([{uid: 'buch-task-7-0', due: '2026-10-30', title: 'Kalibrierung; Pipette, P200', sub: 'Zeile 1\nZeile 2'},
    {uid: 'x', due: '2026-12-31', title: 'Ä'.repeat(60)}], {book: 'Test', now: new Date('2026-10-23T08:00:00Z')});
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031'));
  assert.ok(ics.includes('SUMMARY:Kalibrierung\\; Pipette\\, P200') && ics.includes('DESCRIPTION:Zeile 1\\nZeile 2'));
  assert.ok(ics.includes('UID:buch-task-7-0@biobook') && ics.includes('DTSTAMP:20261023T080000Z'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `zu lang: ${line}`);
  assert.ok(ics.includes('\r\n Ä'), 'lange Zeile gefaltet');
});
