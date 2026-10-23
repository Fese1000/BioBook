// Excel-Dateien (.xlsx) als Tabelle lesen: eine .xlsx ist ein ZIP mit XML. Ohne Bibliothek (DecompressionStream für „deflate“).
// Reine Funktionen, getestet in tests/xlsx.test.js mit einer Datei aus openpyxl.
(function (root) {
  'use strict';

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }

  /// ZIP lesen: Name → Inhalt (nur Einträge „gespeichert“ und „deflate“)
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map();
    let e = b.length - 22;
    while (e >= 0 && v.getUint32(e, true) != 0x06054b50) e--;
    if (e < 0) throw new Error('Keine Excel-Datei (ZIP-Verzeichnis fehlt)');
    let p = v.getUint32(e + 16, true);
    const n = v.getUint16(e + 10, true), dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (v.getUint32(p, true) != 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
      const extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), data = b.subarray(start, start + size);
      if (method == 0) out.set(name, data); else if (method == 8) out.set(name, data);
      out.get(name).method = method;
      p += 46 + nameLen + extra + comment;
    }
    return {
      names: [...out.keys()],
      async text(name) { const d = out.get(name); if (!d) return null; return dec.decode(d.method == 8 ? await inflate(d) : d); },
    };
  }

  const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, '&');
  const colIndex = ref => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');

  /// Erstes (oder benanntes) Blatt als Zeilen mit Text; Zahlen mit deutschem Komma
  async function readXlsx(buf, sheet = 0) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml');
    if (!wb) throw new Error('Keine Excel-Arbeitsmappe');
    const sheets = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].map(m => ({name: unxml(m[1]), rid: m[2]}));
    const rels = await z.text('xl/_rels/workbook.xml.rels') || '';
    const pick = typeof sheet == 'number' ? sheets[sheet] : sheets.find(s => s.name == sheet);
    if (!pick) throw new Error('Blatt nicht gefunden');
    const target = (new RegExp(`<Relationship\\s[^>]*Id="${pick.rid}"[^>]*Target="([^"]*)"`).exec(rels) || new RegExp(`<Relationship\\s[^>]*Target="([^"]*)"[^>]*Id="${pick.rid}"`).exec(rels) || [])[1];
    const path = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
    const ss = await z.text('xl/sharedStrings.xml');
    const shared = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];
    const xml = await z.text(path);
    if (!xml) throw new Error('Blatt fehlt in der Datei');
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (/\br="([A-Z]+\d+)"/.exec(c[1]) || [])[1], t = (/\bt="(\w+)"/.exec(c[1]) || [])[1] || 'n', body = c[2] || '';
        const val = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let out = '';
        if (t == 's') out = shared[+val] ?? '';
        else if (t == 'inlineStr') out = texts(body);
        else if (t == 'b') out = val == '1' ? 'wahr' : 'falsch';
        else if (t == 'str' || t == 'e') out = unxml(val ?? '');
        else if (val != null) { const x = +val; out = Number.isFinite(x) ? String(+x.toPrecision(15)).replace('.', ',') : val; }
        row[ref ? colIndex(ref) : row.length] = out;
      }
      const rn = +((/\br="(\d+)"/.exec(r[0]) || [])[1] || rows.length + 1);
      rows[rn - 1] = [...row].map(x => x ?? '');
    }
    const width = Math.max(0, ...Array.from(rows, r => r?.length || 0));  // Array.from: leere Zeilen sind Löcher im Array
    return {sheets: sheets.map(s => s.name), rows: [...rows].map(r => Array.from({length: width}, (_, i) => r?.[i] ?? ''))};
  }

  /// CSV/TSV (Trennzeichen erkennen, Anführungszeichen beachten)
  function readDelimited(text) {
    const t = String(text).replace(/^﻿/, ''), first = t.split(/\r?\n/)[0] || '';
    const d = first.includes('\t') ? '\t' : (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = [[]];
    let cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch == '"' && t[i + 1] == '"') { cell += '"'; i++; } else if (ch == '"') q = false; else cell += ch; continue; }
      if (ch == '"' && !cell) q = true;
      else if (ch == d) { rows[rows.length - 1].push(cell); cell = ''; }
      else if (ch == '\n' || ch == '\r') { if (ch == '\r' && t[i + 1] == '\n') i++; rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
      else cell += ch;
    }
    rows[rows.length - 1].push(cell);
    const clean = rows.filter(r => r.some(c => c.trim()));
    const width = Math.max(0, ...clean.map(r => r.length));
    return clean.map(r => Array.from({length: width}, (_, i) => r[i] ?? ''));
  }

  const XLSX = {readXlsx, readDelimited, unzip, colIndex};
  if (typeof module != 'undefined' && module.exports) module.exports = XLSX; else root.XLSX = XLSX;
})(this);
