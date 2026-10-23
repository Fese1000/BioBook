// Statistik: reine Funktionen (getestet in tests/stats.test.js gegen scipy). Zahlen dürfen deutsche Kommas haben.
(function (root) {
  'use strict';

  const num = x => {
    if (typeof x == 'number') return Number.isFinite(x) ? x : null;
    const s = String(x ?? '').trim().replace(/\s/g, '').replace(',', '.');
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : null;
  };
  class StatsError extends Error {}
  const fail = m => { throw new StatsError(m); };

  /// Eingefügte Tabelle (aus Excel: Tabulator; sonst ; oder mehrere Leerzeichen) → Zeilen mit Zellen
  function parseTable(text) {
    return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/\t|;|\s{2,}/).map(c => c.trim()));
  }

  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  function sd(xs) { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); }

  /// Lineare Regression y = slope·x + intercept (kleinste Quadrate) mit R² und Standardfehler der Schätzung
  function linreg(points) {
    const p = points.map(([x, y]) => [num(x), num(y)]).filter(([x, y]) => x != null && y != null);
    if (p.length < 2) fail('Mindestens zwei Punkte nötig');
    const n = p.length, mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1]));
    const sxx = p.reduce((a, [x]) => a + (x - mx) ** 2, 0), sxy = p.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0), syy = p.reduce((a, [, y]) => a + (y - my) ** 2, 0);
    if (sxx == 0) fail('Alle x-Werte sind gleich');
    const slope = sxy / sxx, intercept = my - slope * mx;
    const ssr = p.reduce((a, [x, y]) => a + (y - (slope * x + intercept)) ** 2, 0);
    return {slope, intercept, r2: syy ? 1 - ssr / syy : 1, n, see: n > 2 ? Math.sqrt(ssr / (n - 2)) : null, xmin: Math.min(...p.map(q => q[0])), xmax: Math.max(...p.map(q => q[0]))};
  }

  /// x aus der Standardkurve; extrapolated, wenn außerhalb der Standards
  function inverse(fit, y) {
    const v = num(y);
    if (v == null || !fit.slope) return null;
    const x = (v - fit.intercept) / fit.slope;
    return {x, extrapolated: x < fit.xmin - 1e-12 || x > fit.xmax + 1e-12};
  }

  // ---------- t-Verteilung über die regularisierte unvollständige Betafunktion ----------
  function lgamma(z) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /// Zweiseitiger p-Wert für t bei df Freiheitsgraden
  const tTwoSided = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);

  /// t-Test: welch (Standard, ungleiche Varianzen), student (gleiche Varianzen) oder paired
  function tTest(a, b, type = 'welch') {
    const x = a.map(num).filter(v => v != null), y = b.map(num).filter(v => v != null);
    if (type == 'paired') {
      if (a.length != b.length) fail('Gepaarter Test: beide Gruppen brauchen gleich viele Werte');
      const d = a.map((v, i) => num(v) - num(b[i])).filter(Number.isFinite);
      if (d.length < 2) fail('Mindestens zwei Paare nötig');
      const s = sd(d), t = mean(d) / (s / Math.sqrt(d.length)), df = d.length - 1;
      return {type, t, df, p: tTwoSided(t, df), meanA: mean(x), meanB: mean(y), diff: mean(d), n: [d.length, d.length]};
    }
    if (x.length < 2 || y.length < 2) fail('Jede Gruppe braucht mindestens zwei Werte');
    const va = sd(x) ** 2, vb = sd(y) ** 2, na = x.length, nb = y.length, diff = mean(x) - mean(y);
    let t, df;
    if (type == 'student') {
      const sp = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2);
      t = diff / Math.sqrt(sp * (1 / na + 1 / nb)); df = na + nb - 2;
    } else {
      const se2 = va / na + vb / nb;
      t = diff / Math.sqrt(se2); df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
    }
    if (!Number.isFinite(t)) fail('Keine Streuung in den Daten');
    return {type, t, df, p: tTwoSided(t, df), meanA: mean(x), meanB: mean(y), diff, n: [na, nb]};
  }

  /// Gruppen aus Spalten: erste Zeile Namen, darunter Werte
  function groups(rows) {
    if (!rows.length) return [];
    const head = rows[0].every(c => num(c) == null) ? rows[0] : rows[0].map((_, i) => `Gruppe ${i + 1}`);
    const body = rows[0] == head ? rows.slice(1) : rows;
    return head.map((name, i) => {
      const vals = body.map(r => num(r[i])).filter(v => v != null);
      return {name, values: vals, n: vals.length, mean: vals.length ? mean(vals) : null, sd: sd(vals)};
    }).filter(g => g.name || g.n);
  }

  const pText = p => p < 0.0001 ? 'p < 0,0001' : `p = ${p < 0.001 ? p.toExponential(1) : p.toFixed(p < 0.01 ? 4 : 3)}`.replace('.', ',');
  const stars = p => p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'n. s.';

  const Stats = {num, parseTable, mean, sd, linreg, inverse, tTest, tTwoSided, ibeta, groups, pText, stars, StatsError};
  if (typeof module != 'undefined' && module.exports) module.exports = Stats; else root.Stats = Stats;
})(this);
