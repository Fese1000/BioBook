// Kalender in der Seitenleiste: Monatsraster (Woche beginnt Montag), Kalenderwochen und welche Tage Einträge haben.
// Ein Eintrag zählt für jeden Tag von seinem ersten bis zum letzten Tag – genau wie der Zeitraum-Filter der Liste. Reine Hilfen (tests/sidecal.test.js).
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  /// ISO-Kalenderwoche (Donnerstag der Woche entscheidet über das Jahr)
  function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const first = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7);
  }

  /// Wochen des Monats; jede Woche {week, days: [{iso, day, inMonth}] ×7}, Montag zuerst
  function monthGrid(year, month) {
    const start = new Date(year, month, 1);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        days.push({iso: iso(d), day: d.getDate(), inMonth: d.getMonth() == month});
      }
      if (w >= 4 && !days.some(x => x.inMonth)) break;  // keine leere Schlusszeile
      weeks.push({week: isoWeek(parse(days[3].iso)), days});
    }
    return weeks;
  }

  /// Einträge je Tag im sichtbaren Raster: {iso: Anzahl}. Spanne wie im Listenfilter (Tage → sonst angelegt → sonst geändert)
  function markDays(rows, from, to) {
    const out = {};
    for (const r of rows) {
      const a = (r.day_first || r.created || r.updated || '').slice(0, 10), b = (r.day_last || r.updated || '').slice(0, 10);
      if (!a || !b || b < from || a > to) continue;
      const lo = a < from ? from : a, hi = b > to ? to : b;
      for (let d = parse(lo), n = 0; iso(d) <= hi && n < 400; d.setDate(d.getDate() + 1), n++) out[iso(d)] = (out[iso(d)] || 0) + 1;
    }
    return out;
  }

  function shiftMonth(year, month, by) { const d = new Date(year, month + by, 1); return {year: d.getFullYear(), month: d.getMonth()}; }

  root.SideCal = {iso, parse, isoWeek, monthGrid, markDays, shiftMonth, MONTHS, label: (y, m) => `${MONTHS[m]} ${y}`};
  if (typeof module != 'undefined') module.exports = root.SideCal;
})(typeof window != 'undefined' ? window : globalThis);
