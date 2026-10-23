// Laborrechner: reine Funktionen ohne Oberfläche (getestet in tests/calc.test.js gegen Handrechnung).
// Werte kommen als {v: Zahl oder Text, u: Einheit}; leere Felder werden berechnet.
(function (root) {
  'use strict';

  // Einheiten je Größe, Faktor zur Basiseinheit (Liter, Gramm, mol/l, g/l)
  const UNITS = {
    volume: {l: 1, ml: 1e-3, 'µl': 1e-6, nl: 1e-9},
    mass: {g: 1, mg: 1e-3, 'µg': 1e-6, ng: 1e-9, pg: 1e-12},
    molar: {M: 1, mM: 1e-3, 'µM': 1e-6, nM: 1e-9, pM: 1e-12},
    massconc: {'g/l': 1, 'mg/ml': 1, 'µg/µl': 1, 'mg/l': 1e-3, 'µg/ml': 1e-3, 'ng/µl': 1e-3, 'ng/ml': 1e-6},
    percent: {'%': 1},
    fold: {x: 1},
  };
  const dimOf = u => Object.keys(UNITS).find(d => u in UNITS[d]);
  const CONC_UNITS = [...Object.keys(UNITS.molar), ...Object.keys(UNITS.massconc), '%', 'x'];

  /// "42,7" oder "1e-3" → Zahl; leer → null; unlesbar → NaN
  function num(x) {
    if (x == null) return null;
    if (typeof x == 'number') return Number.isFinite(x) ? x : NaN;
    const s = String(x).trim().replace(/\s/g, '').replace(',', '.');
    if (s == '') return null;
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : NaN;
  }

  const toBase = (v, u) => v * UNITS[dimOf(u)][u];
  const fromBase = (v, u) => v / UNITS[dimOf(u)][u];

  /// Gut lesbare Zahl: bis 4 gültige Stellen, deutsches Komma, keine unnötigen Nullen
  function fmt(v) {
    if (v == null || !Number.isFinite(v)) return '';
    if (v == 0) return '0';
    const a = Math.abs(v);
    const s = a >= 1e6 || a < 1e-4 ? v.toExponential(3).replace(/\.?0+e/, 'e') : String(+v.toPrecision(4));
    return s.replace('.', ',');
  }

  class CalcError extends Error {}
  const fail = m => { throw new CalcError(m); };

  /// Genau ein Feld leer lassen; liefert {key, v, u} des berechneten Feldes
  function solveOne(fields, names) {
    const vals = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, num(f.v)]));
    for (const [k, v] of Object.entries(vals)) if (Number.isNaN(v)) fail(`${names[k]}: keine gültige Zahl`);
    const empty = Object.keys(vals).filter(k => vals[k] == null);
    if (empty.length != 1) fail(empty.length ? 'Genau ein Feld leer lassen, das wird berechnet.' : 'Ein Feld leer lassen, das wird berechnet.');
    for (const [k, v] of Object.entries(vals)) if (v != null && v <= 0) fail(`${names[k]} muss größer als 0 sein`);
    return {empty: empty[0], vals};
  }

  /// C1·V1 = C2·V2
  function dilution(f) {
    const names = {c1: 'Ausgangskonzentration', v1: 'Volumen Ausgang', c2: 'Endkonzentration', v2: 'Endvolumen'};
    if (dimOf(f.c1.u) != dimOf(f.c2.u)) fail('Beide Konzentrationen brauchen dieselbe Art von Einheit (z. B. beide molar).');
    const {empty, vals} = solveOne(f, names);
    const b = k => vals[k] == null ? null : toBase(vals[k], f[k].u);
    const c1 = b('c1'), v1 = b('v1'), c2 = b('c2'), v2 = b('v2');
    const r = {c1: () => c2 * v2 / v1, v1: () => c2 * v2 / c1, c2: () => c1 * v1 / v2, v2: () => c1 * v1 / c2}[empty]();
    const all = {c1, v1, c2, v2, [empty]: r};
    if (all.c2 > all.c1 * (1 + 1e-9)) fail('Endkonzentration ist höher als die Ausgangskonzentration.');
    if (all.v1 > all.v2 * (1 + 1e-9)) fail('Volumen Ausgang ist größer als das Endvolumen.');
    const v = fromBase(r, f[empty].u);
    return {key: empty, v, u: f[empty].u, diluent: {v: fromBase(all.v2 - all.v1, f.v2.u), u: f.v2.u}};
  }

  /// Masse = Konzentration · Volumen · Molmasse
  function molarity(f) {
    const names = {mass: 'Masse', conc: 'Konzentration', vol: 'Volumen', mw: 'Molmasse'};
    const {empty, vals} = solveOne(f, names);
    const b = k => vals[k] == null ? null : k == 'mw' ? vals.mw : toBase(vals[k], f[k].u);
    const m = b('mass'), c = b('conc'), V = b('vol'), mw = b('mw');
    const r = {mass: () => c * V * mw, conc: () => m / (V * mw), vol: () => m / (c * mw), mw: () => m / (c * V)}[empty]();
    return {key: empty, v: empty == 'mw' ? r : fromBase(r, f[empty].u), u: empty == 'mw' ? 'g/mol' : f[empty].u};
  }

  /// Mastermix: Volumen je Reaktion × Anzahl × (1 + Überschuss); optional mit Wasser auf Endvolumen
  function mastermix({rows, n, excess, final}) {
    const N = num(n), X = num(excess) ?? 0, F = num(final);
    if (!(N >= 1) || !Number.isInteger(N)) fail('Anzahl Reaktionen muss eine ganze Zahl ≥ 1 sein.');
    if (Number.isNaN(X) || X < 0) fail('Überschuss muss eine Zahl ≥ 0 sein.');
    if (Number.isNaN(F) || (F != null && F <= 0)) fail('Endvolumen muss größer als 0 sein.');
    const factor = N * (1 + X / 100);
    const out = rows.filter(r => String(r.name ?? '').trim() || num(r.vol) != null).map(r => {
      const v = num(r.vol);
      if (v == null || Number.isNaN(v) || v < 0) fail(`${r.name || 'Komponente'}: Volumen fehlt oder ungültig`);
      return {name: r.name, vol: v, total: v * factor};
    });
    const sum = out.reduce((s, r) => s + r.vol, 0);
    let water = null;
    if (F != null) {
      if (sum > F * (1 + 1e-9)) fail(`Die Komponenten (${fmt(sum)} µl) sind mehr als das Endvolumen (${fmt(F)} µl).`);
      water = {name: 'Wasser', vol: F - sum, total: (F - sum) * factor};
    }
    const perRxn = F ?? sum;
    return {rows: water ? [...out, water] : out, factor, perRxn, total: perRxn * factor};
  }

  /// Einheiten umrechnen (nur innerhalb derselben Größe)
  function convert(v, from, to) {
    const x = num(v);
    if (x == null || Number.isNaN(x)) fail('Keine gültige Zahl');
    if (dimOf(from) == null || dimOf(from) != dimOf(to)) fail(`${from} lässt sich nicht in ${to} umrechnen.`);
    return fromBase(toBase(x, from), to);
  }

  /// Dauer im Text erkennen („5 min“, „30 s“, „1,5 h“, „10 Minuten“, „über Nacht“ nicht) → Sekunden oder null
  function duration(text) {
    const m = /(\d+(?:[.,]\d+)?)\s*(h|std\.?|stunden?|min\.?|minuten?|s|sek\.?|sekunden?)(?![a-zäöü])/i.exec(text || '');
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.')), u = m[2].toLowerCase();
    return Math.round(v * (/^(h|std|stunde)/.test(u) ? 3600 : /^min/.test(u) ? 60 : 1));
  }

  /// Formel für berechnete Felder: Zahlen, Feldnamen, + − * / ^ und Klammern, Funktionen sqrt/log10/ln/abs/min/max/round.
  /// Eigener Parser statt eval, damit Formeln aus Vorlagen nie Code ausführen.
  function formula(expr, vars) {
    const src = String(expr), toks = [];
    const re = /\s*(?:(\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)|([a-zA-Z_][a-zA-Z0-9_]*)|(\*\*|[-+*/^(),]))/gy;
    let m, last = 0;
    while (last < src.length) {
      re.lastIndex = last;
      if (!(m = re.exec(src))) { if (/^\s*$/.test(src.slice(last))) break; fail(`Formel unverständlich bei „${src.slice(last).trim().slice(0, 10)}“`); }
      last = re.lastIndex;
      toks.push(m[1] ? {n: parseFloat(m[1].replace(',', '.'))} : m[2] ? {id: m[2]} : {op: m[3] == '**' ? '^' : m[3]});
    }
    let i = 0;
    const peek = () => toks[i], eat = op => { if (toks[i]?.op == op) { i++; return true; } return false; };
    const FN = {sqrt: Math.sqrt, log10: Math.log10, ln: Math.log, abs: Math.abs, round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, min: Math.min, max: Math.max};
    function atom() {
      const t = toks[i++];
      if (!t) fail('Formel endet zu früh');
      if (t.n != null) return t.n;
      if (t.op == '(') { const v = sum(); if (!eat(')')) fail('Klammer fehlt'); return v; }
      if (t.op == '-') return -power();
      if (t.op == '+') return power();
      if (t.id) {
        if (eat('(')) {
          if (!Object.hasOwn(FN, t.id)) fail(`Unbekannte Funktion ${t.id}`);
          const args = [];
          if (!eat(')')) { do { args.push(sum()); } while (eat(',')); if (!eat(')')) fail('Klammer fehlt'); }
          return FN[t.id](...args);
        }
        if (!Object.hasOwn(vars, t.id)) fail(`Unbekanntes Feld ${t.id}`);  // nur eigene Felder, keine geerbten (constructor …)
        const v = num(vars[t.id]);
        if (v == null || Number.isNaN(v)) return NaN;  // leeres Feld: Ergebnis leer
        return v;
      }
      fail('Formel unverständlich');
    }
    function power() { const b = atom(); return eat('^') ? b ** power() : b; }
    function product() { let v = power(); for (;;) { if (eat('*')) v *= power(); else if (eat('/')) v /= power(); else return v; } }
    function sum() { let v = product(); for (;;) { if (eat('+')) v += product(); else if (eat('-')) v -= product(); else return v; } }
    if (!toks.length) fail('Formel ist leer');
    const v = sum();
    if (i < toks.length) fail('Formel unverständlich');
    return Number.isFinite(v) ? v : null;
  }

  /// Kennzahlen einer Zahlenreihe (leere Werte zählen nicht)
  function stats(values) {
    const xs = values.map(num).filter(v => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    const n = xs.length;
    if (!n) return {n: 0};
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
    return {n, mean, sd, median, min: xs[0], max: xs[n - 1], cv: sd != null && mean ? sd / Math.abs(mean) * 100 : null};
  }

  const Calc = {UNITS, CONC_UNITS, dimOf, num, fmt, dilution, molarity, mastermix, convert, duration, formula, stats, CalcError};
  if (typeof module != 'undefined' && module.exports) module.exports = Calc; else root.Calc = Calc;
})(this);
