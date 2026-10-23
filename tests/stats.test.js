// Statistik gegen scipy 1.17 (stats.linregress, ttest_ind, ttest_rel, t.sf): node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const S = require('../web/stats.js');
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b}`);

const bsa = [[0, 0], [125, 0.095], [250, 0.185], [500, 0.35], [750, 0.52], [1000, 0.665], [1500, 0.91], [2000, 1.13]];

test('Bradford-Standardkurve: Steigung, Achsenabschnitt, R² wie scipy.stats.linregress', () => {
  const f = S.linreg(bsa);
  near(f.slope, 0.000568398415393322, 1e-15, 'Steigung'); near(f.intercept, 0.04669496321448785, 1e-14, 'Achsenabschnitt');
  near(f.r2, 0.9904477174952546, 1e-12, 'R²'); assert.equal(f.n, 8);
});

test('Unbekannte Proben aus der Standardkurve (Handrechnung x = (y − b) / m)', () => {
  const f = S.linreg(bsa);
  near(S.inverse(f, '0,400').x, (0.4 - 0.04669496321448785) / 0.000568398415393322, 1e-9, 'Probe A');
  assert.equal(S.inverse(f, 0.4).extrapolated, false);
  assert.equal(S.inverse(f, 1.5).extrapolated, true);
  assert.equal(S.inverse(f, ''), null);
});

test('t-Tests wie scipy (Welch, Student, gepaart)', () => {
  const a = [5.1, 4.9, 5.6, 5.8, 6.0, 5.3], b = [6.2, 6.8, 6.1, 7.0, 6.6];
  const w = S.tTest(a, b);
  near(w.t, -4.471069839263482, 1e-12, 't Welch'); near(w.df, 8.896513414357715, 1e-10, 'df Welch'); near(w.p, 0.0015975169775927522, 1e-10, 'p Welch');
  const s = S.tTest(a, b, 'student');
  near(s.t, -4.428499022783146, 1e-12, 't Student'); assert.equal(s.df, 9); near(s.p, 0.0016507392616607254, 1e-10, 'p Student');
  const p = S.tTest([12.1, 11.8, 13.0, 12.6], [13.4, 12.9, 13.8, 13.1], 'paired');
  near(p.t, -5.285714285714286, 1e-12, 't gepaart'); near(p.p, 0.013208380098571197, 1e-10, 'p gepaart');
});

test('t-Verteilung: zweiseitige p-Werte wie scipy.stats.t.sf × 2', () => {
  near(S.tTwoSided(2.5, 3), 0.08770664700806556, 1e-12, 't=2,5 df=3');
  near(S.tTwoSided(0.3, 40), 0.7657307167710191, 1e-12, 't=0,3 df=40');
  near(S.tTwoSided(8, 10), 1.1774942789666168e-05, 1e-14, 't=8 df=10');
});

test('Eingefügte Tabellen (Excel mit Tabulator, deutsche Kommas) und Gruppen', () => {
  const rows = S.parseTable('Kontrolle\tBehandelt\n5,1\t6,2\n4,9\t6,8\n5,6\t\n');
  const g = S.groups(rows);
  assert.deepEqual(g.map(x => [x.name, x.n]), [['Kontrolle', 3], ['Behandelt', 2]]);
  near(g[0].mean, 5.2, 1e-12, 'Mittelwert');
  assert.deepEqual(S.parseTable('0;0\n125;0,095').map(r => r.map(S.num)), [[0, 0], [125, 0.095]]);
  assert.throws(() => S.tTest([1], [2, 3]), /mindestens zwei/);
  assert.equal(S.pText(0.0016), 'p = 0,0016'); assert.equal(S.stars(0.0016), '**'); assert.equal(S.pText(0.00001), 'p < 0,0001');
});
