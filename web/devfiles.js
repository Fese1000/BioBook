// Gerätedateien: Plattenleser (Raster oder Liste), NanoDrop, qPCR-Ct-Tabellen (Bio-Rad CFX, QuantStudio).
// Reine Funktionen oben (tests/devfiles.test.js); unten die gemeinsame Dateiauswahl für Platten- und Ergebnis-Block.
(function (root) {
  'use strict';

  class DevError extends Error {}
  const fail = m => { throw new DevError(m); };

  /// Trennzeichen einer Zeile: Tab vor Semikolon vor Komma
  const delim = line => line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const split = (line, d = delim(line)) => line.split(d).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  /// Zahl mit Punkt oder (bei Tab/Semikolon) Komma; „NaN“, „-“, „Undetermined“ → null
  function num(s, d) {
    const t = String(s ?? '').trim();
    if (!t || /^(nan|n\/a|-|undetermined|no ct)$/i.test(t)) return null;
    const x = t.includes(',') && t.includes('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.');  // „1.234,5“ oder „0,512“ oder „0.512“
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(x) ? parseFloat(x) : null;
  }
  const well = s => { const m = /^([A-Pa-p])0?(\d{1,2})$/.exec(String(s).trim()); return m ? `${m[1].toUpperCase()}${+m[2]}` : null; };

  /// Plattenleser: Raster (Kopfzeile 1…12 bzw. 1…24, Zeilen A…H/P) irgendwo in der Datei, sonst Liste „Well; Wert“
  function parsePlate(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const d = delim(lines[i]), head = split(lines[i], d);
      const nums = head.slice(1).map(Number);
      if (nums.length >= 12 && nums.slice(0, 12).every((n, k) => n == k + 1)) {
        const cols = nums.filter((n, k) => n == k + 1).length, values = {};
        let r = 0;
        for (let j = i + 1; j < lines.length; j++) {
          const cells = split(lines[j], d);
          if (!/^[A-P]$/i.test(cells[0] || '')) break;
          for (let c = 1; c <= cols; c++) { const v = num(cells[c], d); if (v != null) values[`${cells[0].toUpperCase()}${c}`] = v; }
          r++;
        }
        const wl = /Wavelength[^0-9]*(\d{3})/i.exec(lines.slice(0, i).join(' '));
        if (r) return {format: cols > 12 || r > 8 ? 384 : 96, values, label: wl ? `${wl[1]} nm` : ''};
      }
    }
    // Liste: erste Spalte Well, letzte Zahl der Zeile ist der Wert
    const values = {};
    let label = '';
    for (const line of lines) {
      const d = delim(line), cells = split(line, d), w = well(cells[0] || '');
      if (!w) { if (!Object.keys(values).length && cells.length > 1) label = cells[cells.length - 1]; continue; }
      const v = [...cells.slice(1)].reverse().map(c => num(c, d)).find(x => x != null);
      if (v != null) values[w] = v;
    }
    if (!Object.keys(values).length) fail('Keine Messwerte gefunden (Raster mit 1…12 oder Liste mit Wells wie A1)');
    const maxRow = Math.max(...Object.keys(values).map(w => w.charCodeAt(0) - 65)), maxCol = Math.max(...Object.keys(values).map(w => +w.slice(1)));
    return {format: maxRow > 7 || maxCol > 12 ? 384 : 96, values, label};
  }

  /// Spalte anhand von Mustern finden
  const col = (head, ...res) => { for (const re of res) { const i = head.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };  // Muster in Vorrangfolge

  /// NanoDrop-Export (Tab, CSV): Probe, Konzentration, 260/280, 260/230
  function parseNanoDrop(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const hi = lines.findIndex(l => /260\/280/.test(l));
    if (hi < 0) fail('Keine NanoDrop-Tabelle (Spalte 260/280 fehlt)');
    const d = delim(lines[hi]), head = split(lines[hi], d);
    const ci = {name: col(head, /^sample (id|name)$/i, /^sample$/i, /name/i), conc: col(head, /nucleic acid/i, /conc/i, /ng\/[uµ]l/i),
      r280: col(head, /^260\/280$/), r230: col(head, /^260\/230$/), unit: col(head, /^units?$/i)};
    if (ci.conc < 0) fail('Keine Konzentrationsspalte gefunden');
    return lines.slice(hi + 1).map(l => split(l, d)).filter(c => c.length >= head.length - 2 && c[ci.name]).map(c => ({
      sample: c[ci.name], conc: num(c[ci.conc], d), a260_280: ci.r280 >= 0 ? num(c[ci.r280], d) : null, a260_230: ci.r230 >= 0 ? num(c[ci.r230], d) : null,
      unit: ci.unit >= 0 ? c[ci.unit] : (head[ci.conc].match(/\((.*?)\)/) || [, 'ng/µl'])[1].replace('uL', 'µl')}));
  }

  /// qPCR: Well, Probe, Gen, Ct (CFX: Sample/Target/Cq; QuantStudio: Sample Name/Target Name/CT)
  function parseCt(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const hi = lines.findIndex(l => /\b(cq|ct|c[tт])\b/i.test(l) && /target|detector|gene/i.test(l));
    if (hi < 0) fail('Keine Ct-Tabelle gefunden (Spalten Target und Cq/CT)');
    const d = delim(lines[hi]), head = split(lines[hi], d);
    const ci = {well: col(head, /^well position$/i, /^well$/i), sample: col(head, /^sample( name)?$/i), target: col(head, /^target( name)?$/i, /^detector$/i, /^gene$/i),
      ct: col(head, /^cq$/i, /^ct$/i, /^cт$/i)};
    if (ci.ct < 0 || ci.target < 0) fail('Spalten Target und Cq/CT nicht gefunden');
    return lines.slice(hi + 1).map(l => split(l, d)).filter(c => c[ci.target]).map(c => ({well: well(c[ci.well]) || c[ci.well] || '', sample: c[ci.sample] || '', target: c[ci.target], ct: num(c[ci.ct], d)}));
  }

  const REF_GENES = /^(gapdh|actb|β-?actin|beta-?actin|18s|rplp0|hprt1?|b2m|tbp|ubc|ywhaz|ppia|rpl13a|sdha|gusb)$/i;
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

  /// Ct-Zeilen → Zeilen der qPCR-Vorlage: je Probe und Zielgen Mittelwert der Replikate, ct_ref vom Referenzgen derselben Probe
  function ctToRows(rows, refTarget) {
    const ref = refTarget || [...new Set(rows.map(r => r.target))].find(t => REF_GENES.test(t));
    const by = new Map();
    for (const r of rows) { if (r.ct == null) continue; const k = `${r.sample}\u0000${r.target}`; (by.get(k) || by.set(k, []).get(k)).push(r.ct); }
    const refCt = s => by.get(`${s}\u0000${ref}`);
    const out = [];
    for (const [k, cts] of by) {
      const [sample, target] = k.split('\u0000');
      if (target == ref) continue;
      const rc = refCt(sample);
      out.push({probe: sample, gen: target, ct: +mean(cts).toFixed(3), ...(rc ? {ct_ref: +mean(rc).toFixed(3)} : {})});
    }
    return {ref: ref || null, rows: out};
  }

  const DevFiles = {parsePlate, parseNanoDrop, parseCt, ctToRows, num, well, DevError};
  if (typeof module != 'undefined' && module.exports) module.exports = DevFiles; else root.DevFiles = DevFiles;
})(this);

// ---------- Dateiauswahl für Blöcke ----------
let DEVFILE_TARGET = null;  // {apply(text, name)}: wer die gewählte Datei bekommt
function pickDeviceFile(target, accept = '.csv,.tsv,.txt,.xls') {
  DEVFILE_TARGET = target;
  if (window.TESTING) return;  // im Selbsttest ruft der Test apply direkt auf
  let p = document.getElementById('devpick');
  if (!p) {
    p = Object.assign(document.createElement('input'), {type: 'file', id: 'devpick', hidden: true});
    p.onchange = async () => { const f = p.files[0]; if (!f || !DEVFILE_TARGET) return; try { await DEVFILE_TARGET.apply(await f.text(), f.name); } catch (e) { alert(`${f.name}: ${e.message}`); } p.value = ''; };
    document.body.appendChild(p);
  }
  p.accept = accept;
  p.click();
}
