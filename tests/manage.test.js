// Einträge verwalten: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const M = require('../web/manage.js');
const rebuild = (parts, side) => parts.filter(p => p.op == '=' || p.op == side).map(p => p.text).join('');

test('Wort-Diff: eingefügt, gelöscht, gleich – beide Texte lassen sich wieder zusammensetzen', () => {
  const a = 'Taq 2 µl bei 55 °C\nzweite Zeile', b = 'Q5 2 µl bei 62 °C\nzweite Zeile\nneu';
  const d = M.diffWords(a, b);
  assert.equal(rebuild(d, '-'), a); assert.equal(rebuild(d, '+'), b);
  assert.deepEqual(d.filter(p => p.op == '-').map(p => p.text.trim()), ['Taq', '55']);
  assert.ok(d.filter(p => p.op == '+').map(p => p.text.trim()).includes('Q5'));
  assert.deepEqual(M.diffWords('gleich', 'gleich'), [{op: '=', text: 'gleich'}]);
  assert.deepEqual(M.diffWords('', 'neu'), [{op: '+', text: 'neu'}]);
  assert.deepEqual(M.diffWords('alt', ''), [{op: '-', text: 'alt'}]);
});

test('Wort-Diff: zufällige Texte bleiben rekonstruierbar', () => {
  const w = ['A', 'B', 'C', 'Taq', 'µl', '2', ' ', '\n'];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 60; t++) {
    const mk = () => Array.from({length: Math.floor(rnd() * 30)}, () => w[Math.floor(rnd() * w.length)]).join(' ');
    const a = mk(), b = mk(), d = M.diffWords(a, b);
    assert.equal(rebuild(d, '-'), a); assert.equal(rebuild(d, '+'), b);
  }
});

test('Prüfung vor dem Abschließen', () => {
  const doc = {type: 'doc', content: [
    {type: 'day', attrs: {date: '2026-10-23'}, content: [{type: 'paragraph'}]},
    {type: 'usage', attrs: {lot: 3, move: null}},
    {type: 'results', attrs: {schema: 1, rows: [{}]}},
    {type: 'taskList', content: [{type: 'taskItem', attrs: {checked: false}, content: [{type: 'paragraph', content: [{type: 'text', text: 'Gel'}]}]}]}]};
  const n = M.preflight(doc, '');
  const t = n.map(x => x.text).join(' | ');
  assert.ok(/keinen Titel/.test(t) && /Verbrauch-Block/.test(t) && /Ergebnistabelle/.test(t) && /Leere Tagesabschnitte: 2026-10-23/.test(t) && /1 offene Aufgabe/.test(t), t);
  assert.deepEqual(M.preflight({type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'fertig'}]}]}, 'PCR'), []);
});

test('Filtern und sortieren; Angeheftetes zuerst', () => {
  const rows = [{id: 1, title: 'B', kind: 'experiment', status: 'fertig', updated: '2026-10-01', created: '2026-09-01'},
    {id: 2, title: 'A', kind: 'protocol', status: '', updated: '2026-10-05', created: '2026-10-05', pinned: 1},
    {id: 3, title: 'C', kind: 'experiment', status: 'fehlgeschlagen', updated: '2026-10-03', created: '2026-10-02', day_first: '2026-06-30', day_last: '2026-07-01'}];
  assert.deepEqual(M.filterSort(rows).map(r => r.id), [2, 3, 1]);  // angeheftet zuerst, dann zuletzt geändert
  assert.deepEqual(M.filterSort(rows, {status: 'fehlgeschlagen'}).map(r => r.id), [3]);
  assert.deepEqual(M.filterSort(rows, {status: '—'}).map(r => r.id), [2]);
  assert.deepEqual(M.filterSort([{id: 1, title: '', updated: 'a'}, {id: 2, title: 'Probe 10', updated: 'a'}, {id: 3, title: 'Probe 9', updated: 'a'}], {sort: 'title'}).map(r => r.id), [3, 2, 1]);  // ohne Titel ans Ende
  assert.deepEqual(M.filterSort(rows, {kind: 'experiment', sort: 'title'}).map(r => r.id), [1, 3]);
  assert.deepEqual(M.filterSort(rows, {from: '2026-09-15', to: '2026-09-30'}).map(r => r.id), [1]);
  assert.deepEqual(M.filterSort(rows, {to: '2026-06-30'}).map(r => r.id), [3]);
});
