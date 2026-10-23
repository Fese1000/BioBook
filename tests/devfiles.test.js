// Gerätedateien lesen: node --test tests/  (Testdateien nach typischen Exporten gebaut, keine echten Gerätedateien)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../web/devfiles.js');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('Plattenleser-Raster mit Kopfzeilen, Semikolon und Dezimalkomma (Tecan-ähnlich)', () => {
  const p = D.parsePlate(fx('platereader-grid.csv'));
  assert.equal(p.format, 96); assert.equal(Object.keys(p.values).length, 96); assert.equal(p.label, '595 nm');
  near(p.values.A1, 0.06); near(p.values.H12, 0.87); near(p.values.C5, 0.3);
});

test('Plattenleser-Liste mit Tab, Punkt und A01-Schreibweise', () => {
  const p = D.parsePlate(fx('platereader-list.txt'));
  assert.equal(Object.keys(p.values).length, 96); near(p.values.A1, 0.12); near(p.values.H12, 1.74); assert.equal(p.label, 'Abs 450');
  assert.throws(() => D.parsePlate('nur Text\nohne Werte'), /Keine Messwerte/);
});

test('Zahlen: Komma, Punkt, Tausenderpunkt, leere Werte', () => {
  assert.equal(D.num('0,512'), 0.512); assert.equal(D.num('0.512'), 0.512); assert.equal(D.num('1.234,5'), 1234.5);
  assert.equal(D.num('NaN'), null); assert.equal(D.num('Undetermined'), null); assert.equal(D.num(''), null);
  assert.equal(D.well('h09'), 'H9'); assert.equal(D.well('Z1'), null);
});

test('NanoDrop-Export: Probe, ng/µl, 260/280, 260/230', () => {
  const r = D.parseNanoDrop(fx('nanodrop.tsv'));
  assert.deepEqual(r.map(x => [x.sample, x.conc, x.a260_280, x.a260_230]), [['Klon 1', 250.4, 1.85, 2.1], ['Klon 2', 312.9, 1.85, 2.21], ['Klon 3', 98.1, 1.83, 1.62]]);
  assert.equal(r[0].unit, 'ng/µl');
});

test('qPCR (Bio-Rad CFX): Replikate gemittelt, Referenzgen GAPDH erkannt, NTC ohne Cq übergangen', () => {
  const rows = D.parseCt(fx('qpcr-cfx.csv'));
  assert.equal(rows.length, 9); assert.equal(rows[8].ct, null);
  const {ref, rows: out} = D.ctToRows(rows);
  assert.equal(ref, 'GAPDH');
  assert.deepEqual(out, [{probe: 'Kontrolle', gen: 'IL6', ct: 27.51, ct_ref: 18.16}, {probe: 'LPS', gen: 'IL6', ct: 22.2, ct_ref: 18.28}]);
});

test('QuantStudio-Spaltennamen', () => {
  const qs = 'Well\tWell Position\tSample Name\tTarget Name\tTask\tReporter\tCT\n1\tA1\tP1\tACTB\tUNKNOWN\tSYBR\t17,5\n2\tA2\tP1\tTNF\tUNKNOWN\tSYBR\t25,25\n';
  const r = D.parseCt(qs);
  assert.deepEqual(r.map(x => [x.well, x.sample, x.target, x.ct]), [['A1', 'P1', 'ACTB', 17.5], ['A2', 'P1', 'TNF', 25.25]]);
  assert.deepEqual(D.ctToRows(r).rows, [{probe: 'P1', gen: 'TNF', ct: 25.25, ct_ref: 17.5}]);
});
