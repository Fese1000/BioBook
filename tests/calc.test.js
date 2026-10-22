// Rechner gegen Handrechnung prüfen: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../web/calc.js');

const near = (a, b, what) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-15, `${what}: ${a} ≠ ${b}`);
const f = (v, u) => ({v, u});

test('Verdünnung: 10 mM auf 100 µM in 1 ml → 10 µl Stock, 990 µl Puffer', () => {
  const r = C.dilution({c1: f('10', 'mM'), v1: f('', 'µl'), c2: f('100', 'µM'), v2: f('1', 'ml')});
  assert.equal(r.key, 'v1'); near(r.v, 10, 'V1'); assert.equal(r.u, 'µl');
  near(r.diluent.v, 0.99, 'Puffer in ml');
});

test('Verdünnung: 50x auf 1x in 50 ml → 1 ml', () => {
  near(C.dilution({c1: f('50', 'x'), v1: f('', 'ml'), c2: f('1', 'x'), v2: f('50', 'ml')}).v, 1, 'V1');
});

test('Verdünnung: 200 ng/µl auf 10 ng/µl in 20 µl → 1 µl', () => {
  near(C.dilution({c1: f('200', 'ng/µl'), v1: f('', 'µl'), c2: f('10', 'ng/µl'), v2: f('20', 'µl')}).v, 1, 'V1');
});

test('Verdünnung: Endkonzentration aus 5 µl 1 M in 500 µl → 10 mM', () => {
  near(C.dilution({c1: f('1', 'M'), v1: f('5', 'µl'), c2: f('', 'mM'), v2: f('500', 'µl')}).v, 10, 'C2');
});

test('Verdünnung: Endvolumen aus 2 µl 1 mg/ml auf 0,1 mg/ml → 20 µl', () => {
  near(C.dilution({c1: f('1', 'mg/ml'), v1: f('2', 'µl'), c2: f('0,1', 'mg/ml'), v2: f('', 'µl')}).v, 20, 'V2');
});

test('Verdünnung: Fehler bei höherer Endkonzentration, gemischten Einheiten, falscher Leerstelle', () => {
  assert.throws(() => C.dilution({c1: f('1', 'mM'), v1: f('', 'µl'), c2: f('2', 'mM'), v2: f('1', 'ml')}), /höher/);
  assert.throws(() => C.dilution({c1: f('1', 'M'), v1: f('', 'µl'), c2: f('2', 'ng/µl'), v2: f('1', 'ml')}), /dieselbe Art/);
  assert.throws(() => C.dilution({c1: f('1', 'M'), v1: f('', 'µl'), c2: f('', 'mM'), v2: f('1', 'ml')}), /Genau ein Feld/);
  assert.throws(() => C.dilution({c1: f('abc', 'M'), v1: f('', 'µl'), c2: f('1', 'mM'), v2: f('1', 'ml')}), /keine gültige Zahl/);
  assert.throws(() => C.dilution({c1: f('0', 'M'), v1: f('', 'µl'), c2: f('1', 'mM'), v2: f('1', 'ml')}), /größer als 0/);
});

test('Molarität: NaCl 58,44 g/mol, 1 M, 500 ml → 29,22 g', () => {
  const r = C.molarity({mass: f('', 'g'), conc: f('1', 'M'), vol: f('500', 'ml'), mw: f('58,44', 'g/mol')});
  near(r.v, 29.22, 'Masse');
});

test('Molarität: Tris 121,14 g/mol, 50 mM, 100 ml → 605,7 mg', () => {
  near(C.molarity({mass: f('', 'mg'), conc: f('50', 'mM'), vol: f('100', 'ml'), mw: f('121,14', 'g/mol')}).v, 605.7, 'Masse');
});

test('Molarität: 5,844 g NaCl in 1 l → 100 mM; Molmasse aus 2,922 g in 100 ml 0,5 M → 58,44', () => {
  near(C.molarity({mass: f('5,844', 'g'), conc: f('', 'mM'), vol: f('1', 'l'), mw: f('58,44', 'g/mol')}).v, 100, 'Konzentration');
  near(C.molarity({mass: f('2,922', 'g'), conc: f('0,5', 'M'), vol: f('100', 'ml'), mw: f('', 'g/mol')}).v, 58.44, 'Molmasse');
});

test('Mastermix: Q5, 8 Reaktionen, 10 % Überschuss, auf 50 µl', () => {
  const r = C.mastermix({n: '8', excess: '10', final: '50', rows: [
    {name: 'Q5-Puffer 5x', vol: '10'}, {name: 'dNTPs 10 mM', vol: '1'}, {name: 'Primer fw', vol: '2,5'},
    {name: 'Primer rv', vol: '2,5'}, {name: 'Q5-Polymerase', vol: '0,5'}, {name: 'Template', vol: '1'}, {name: '', vol: ''}]});
  near(r.factor, 8.8, 'Faktor');
  assert.equal(r.rows.length, 7, 'leere Zeile ignoriert, Wasser ergänzt');
  near(r.rows[0].total, 88, 'Puffer gesamt');
  near(r.rows[6].vol, 32.5, 'Wasser je Reaktion'); near(r.rows[6].total, 286, 'Wasser gesamt');
  near(r.total, 440, 'Gesamtvolumen');
});

test('Mastermix: Fehler bei zu viel Volumen und ungültiger Anzahl', () => {
  assert.throws(() => C.mastermix({n: '2', excess: '0', final: '10', rows: [{name: 'A', vol: '12'}]}), /mehr als das Endvolumen/);
  assert.throws(() => C.mastermix({n: '2,5', excess: '0', final: '', rows: [{name: 'A', vol: '1'}]}), /ganze Zahl/);
  assert.throws(() => C.mastermix({n: '2', excess: '0', final: '', rows: [{name: 'A', vol: ''}]}), /Volumen fehlt/);
});

test('Einheiten umrechnen', () => {
  near(C.convert('1,5', 'ml', 'µl'), 1500, 'ml→µl');
  near(C.convert('2', 'mg/ml', 'ng/µl'), 2000, 'mg/ml→ng/µl');
  near(C.convert('250', 'nM', 'µM'), 0.25, 'nM→µM');
  assert.throws(() => C.convert('1', 'ml', 'mg'), /lässt sich nicht/);
});

test('Dauer im Schritttext erkennen', () => {
  assert.equal(C.duration('Inkubation 5 min bei 37 °C'), 300);
  assert.equal(C.duration('1,5 h schütteln'), 5400);
  assert.equal(C.duration('30 s zentrifugieren'), 30);
  assert.equal(C.duration('10 Minuten warten'), 600);
  assert.equal(C.duration('3 Stunden'), 10800);
  assert.equal(C.duration('5 mM Tris, 2 ml, 37 °C'), null);
  assert.equal(C.duration('über Nacht'), null);
});

test('Zahlen lesen und anzeigen', () => {
  assert.equal(C.num('42,7'), 42.7); assert.equal(C.num(' '), null); assert.ok(Number.isNaN(C.num('4x')));
  assert.equal(C.fmt(29.22), '29,22'); assert.equal(C.fmt(605.7), '605,7'); assert.equal(C.fmt(0.1234567), '0,1235');
  assert.equal(C.fmt(1500), '1500'); assert.equal(C.fmt(0.00001), '1e-5');
});
