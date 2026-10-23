// Sequenzen: reine Funktionen ohne Oberfläche (getestet in tests/bio.test.js, u. a. mit pUC19 aus NCBI L09137).
// Positionen sind 1-basiert und schließen das Ende ein (wie in GenBank); strand 1 = oberer, -1 = unterer Strang.
(function (root) {
  'use strict';

  const COMP = {A: 'T', T: 'A', U: 'A', G: 'C', C: 'G', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N'};
  const IUPAC = {A: 'A', C: 'C', G: 'G', T: 'T', U: 'T', R: '[AG]', Y: '[CT]', S: '[CG]', W: '[AT]', K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]'};
  const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';  // Standard-Code, Reihenfolge TCAG
  const BASES = 'TCAG';

  class BioError extends Error {}
  const fail = m => { throw new BioError(m); };

  /// Nur Basenbuchstaben, groß; unbekannte Zeichen sind ein Fehler
  function clean(seq) {
    const s = String(seq || '').toUpperCase().replace(/[\s\d\-.*/]/g, '');
    const bad = s.match(/[^ACGTUNRYSWKMBDHV]/);
    if (bad) fail(`Unbekanntes Zeichen in der Sequenz: „${bad[0]}“`);
    return s;
  }

  const revcomp = seq => [...String(seq).toUpperCase()].reverse().map(b => COMP[b] || 'N').join('');

  function gc(seq) {
    const s = String(seq).toUpperCase();
    const g = (s.match(/[GCS]/g) || []).length, all = (s.match(/[ACGTUSW]/g) || []).length;
    return all ? g / all * 100 : 0;
  }

  function codon(c) {
    const i = [...c.replace(/U/g, 'T')].map(b => BASES.indexOf(b));
    return i.some(x => x < 0) ? 'X' : CODE[i[0] * 16 + i[1] * 4 + i[2]];
  }

  /// Übersetzung ab frame (0–2); unvollständiges Ende wird weggelassen
  function translate(seq, frame = 0) {
    const s = String(seq).toUpperCase();
    let p = '';
    for (let i = frame; i + 3 <= s.length; i += 3) p += codon(s.slice(i, i + 3));
    return p;
  }

  // ---------- Dateien ----------
  function parseFasta(text) {
    const recs = [];
    let cur = null;
    for (const line of String(text).split(/\r?\n/)) {
      if (line.startsWith('>')) { cur = {name: line.slice(1).trim().split(/\s+/)[0] || 'Sequenz', description: line.slice(1).trim(), seq: ''}; recs.push(cur); }
      else if (line.startsWith(';')) continue;
      else if (line.trim()) { if (!cur) { cur = {name: 'Sequenz', description: '', seq: ''}; recs.push(cur); } cur.seq += line; }
    }
    for (const r of recs) { r.seq = clean(r.seq); r.circular = false; r.features = []; }
    if (!recs.length) fail('Keine Sequenz in der Datei');
    return recs;
  }

  /// GenBank-Ort: 10..200, complement(…), join(…), order(…), <1..>50, 5^6, einzelne Base
  function parseLocation(loc) {
    let s = String(loc).replace(/\s/g, ''), strand = 1;
    const m = /^complement\((.*)\)$/.exec(s);
    if (m) { strand = -1; s = m[1]; }
    const j = /^(?:join|order)\((.*)\)$/.exec(s);
    const parts = (j ? j[1] : s).split(',').map(p => {
      let st = 1;
      const c = /^complement\((.*)\)$/.exec(p); if (c) { st = -1; p = c[1]; }
      const r = /^<?(\d+)(?:(?:\.\.|\^)>?(\d+))?>?$/.exec(p.replace(/^[A-Za-z0-9_.]+:/, ''));
      if (!r) fail(`Ort nicht lesbar: ${p}`);
      return {start: +r[1], end: +(r[2] ?? r[1]), strand: st};
    });
    if (parts.every(p => p.strand == -1)) strand = -1;
    if (strand == -1 && !m && parts.length > 1) parts.reverse();  // join(complement(c..d),complement(a..b)) steht absteigend
    return {start: parts[0].start, end: parts[parts.length - 1].end, strand, parts: parts.map(p => [p.start, p.end])};
  }

  function formatLocation(f) {
    const body = f.parts && f.parts.length > 1 ? `join(${f.parts.map(([a, b]) => a == b ? `${a}` : `${a}..${b}`).join(',')})` : f.start == f.end ? `${f.start}` : `${f.start}..${f.end}`;
    return f.strand == -1 ? `complement(${body})` : body;
  }

  const LABEL_KEYS = ['label', 'gene', 'product', 'locus_tag', 'standard_name', 'note'];

  function parseGenBank(text) {
    const recs = [];
    for (const chunk of String(text).split(/^\/\/\s*$/m)) {
      if (!/^LOCUS/m.test(chunk)) continue;
      const lines = chunk.replace(/^\s*\n/, '').split(/\r?\n/);
      const rec = {name: '', description: '', accession: '', circular: false, seq: '', features: []};
      let i = 0, section = '';
      const locus = lines.find(l => l.startsWith('LOCUS')) || '';
      rec.name = locus.split(/\s+/)[1] || 'Sequenz';
      rec.circular = /\bcircular\b/i.test(locus);
      let feat = null, qual = null;
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (/^[A-Z]/.test(l)) {
          section = l.split(/\s+/)[0];
          if (section == 'DEFINITION') rec.description = l.slice(12).trim();
          if (section == 'ACCESSION') rec.accession = l.slice(12).trim().split(/\s+/)[0];
          continue;
        }
        if (section == 'DEFINITION' && /^ {12}\S/.test(l)) { rec.description += ' ' + l.trim(); continue; }
        if (section == 'FEATURES') {
          const key = /^ {5}(\S+)\s+(.*)$/.exec(l);
          if (key && l[5] != ' ') { feat = {type: key[1], loc: key[2].trim(), q: {}}; rec.features.push(feat); qual = null; continue; }
          const t = l.slice(21);
          if (!feat || !/^ {21}/.test(l)) continue;
          const qm = /^\/([^=]+)(?:=(.*))?$/.exec(t);
          if (qm) { qual = qm[1]; feat.q[qual] = (qm[2] ?? '').replace(/^"/, ''); }
          else if (qual) feat.q[qual] += (qual == 'translation' ? '' : ' ') + t.trim();
          else feat.loc += t.trim();
        }
        if (section == 'ORIGIN') rec.seq += l.replace(/[\d\s]/g, '');
      }
      rec.seq = clean(rec.seq);
      rec.features = rec.features.filter(f => f.type != 'source').map(f => {
        for (const k in f.q) f.q[k] = f.q[k].replace(/"$/, '').trim();
        const loc = parseLocation(f.loc);
        const label = LABEL_KEYS.map(k => f.q[k]).find(Boolean) || f.type;
        return {type: f.type, label: label.slice(0, 60), ...loc};
      }).filter(f => f.start >= 1 && f.end <= rec.seq.length && f.start <= rec.seq.length);
      recs.push(rec);
    }
    if (!recs.length) fail('Keine GenBank-Daten gefunden');
    return recs;
  }

  /// Datei erkennen: GenBank (LOCUS), FASTA (>) oder reine Sequenz
  function parseAny(text) {
    const t = String(text).replace(/^﻿/, '');
    if (/^\s*LOCUS/.test(t)) return parseGenBank(t);
    if (/^\s*>/.test(t)) return parseFasta(t);
    return [{name: 'Sequenz', description: '', seq: clean(t), circular: false, features: []}];
  }

  function toFasta(name, seq, width = 70) {
    const s = String(seq);
    const lines = [];
    for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
    return `>${String(name).replace(/\s+/g, '_')}\n${lines.join('\n')}\n`;
  }

  function toGenBank({name, description = '', seq, circular = false, features = []}) {
    const s = String(seq).toLowerCase(), n = s.length;
    const id = String(name || 'Sequenz').replace(/\s+/g, '_').slice(0, 16);
    const date = new Date().toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/ /g, '-').toUpperCase();
    const out = [`LOCUS       ${id.padEnd(16)} ${String(n).padStart(11)} bp    DNA     ${circular ? 'circular' : 'linear  '} SYN ${date}`,
      `DEFINITION  ${description || name || '.'}`, 'FEATURES             Location/Qualifiers', `     source          1..${n}`];
    for (const f of features) {
      out.push(`     ${f.type.padEnd(16)}${formatLocation(f)}`);
      out.push(`                     /label="${String(f.label || f.type).replace(/"/g, "'")}"`);
    }
    out.push('ORIGIN');
    for (let i = 0; i < n; i += 60) {
      const blocks = [];
      for (let j = i; j < Math.min(i + 60, n); j += 10) blocks.push(s.slice(j, j + 10));
      out.push(`${String(i + 1).padStart(9)} ${blocks.join(' ')}`);
    }
    out.push('//');
    return out.join('\n') + '\n';
  }

  // ---------- Suche ----------
  /// Motiv (IUPAC erlaubt) auf beiden Strängen; bei Ringen auch über den Ursprung. Treffer: {start, end, strand}
  function findMotif(seq, motif, {circular = false} = {}) {
    const s = String(seq).toUpperCase(), m = clean(motif);
    if (!m) return [];
    if (m.length > s.length) return [];
    const pat = mm => new RegExp(`(?=(${[...mm].map(b => IUPAC[b]).join('')}))`, 'g');
    const hay = circular ? s + s.slice(0, m.length - 1) : s;
    const hits = [], seen = new Set();
    const scan = (mm, strand) => {
      for (const x of hay.matchAll(pat(mm))) {
        if (x.index >= s.length) continue;
        const start = x.index + 1, end = (x.index + m.length - 1) % s.length + 1;
        const key = `${start}`;  // dieselbe Stelle auf beiden Strängen nur einmal
        if (!seen.has(key)) { seen.add(key); hits.push({start, end, strand}); }
      }
    };
    scan(m, 1);
    const rc = revcomp(m);
    if (rc != m) scan(rc, -1);
    return hits.sort((a, b) => a.start - b.start || b.strand - a.strand);
  }

  /// Offene Leseraster (ATG … Stopp) in allen sechs Rahmen, mindestens minAa Aminosäuren; längste zuerst
  function orfs(seq, {minAa = 100, circular = false} = {}) {
    const s = String(seq).toUpperCase(), n = s.length, out = [];
    for (const strand of [1, -1]) {
      const t = strand == 1 ? s : revcomp(s);
      const hay = circular ? t + t : t;
      for (let frame = 0; frame < 3; frame++) {
        let i = frame;
        while (i + 3 <= hay.length && i < n + frame) {
          if (hay.slice(i, i + 3) != 'ATG') { i += 3; continue; }
          let j = i, aa = '';
          for (; j + 3 <= hay.length && j - i < n; j += 3) { const c = codon(hay.slice(j, j + 3)); if (c == '*') break; aa += c; }
          const closed = j + 3 <= hay.length && codon(hay.slice(j, j + 3)) == '*';
          if (closed && aa.length >= minAa && i < n) {
            const a = i % n + 1, b = (j + 2) % n + 1;  // Positionen auf diesem Strang
            out.push(strand == 1 ? {start: a, end: b, strand, aa: aa.length, protein: aa} : {start: n - b + 1, end: n - a + 1, strand, aa: aa.length, protein: aa});
          }
          i = closed ? j + 3 : j;  // verschachtelte ATG im selben Raster überspringen
        }
      }
    }
    const seen = new Set();
    return out.filter(o => { const k = `${o.strand}:${o.strand == 1 ? o.end : o.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.aa - a.aa);
  }

  /// Teilsequenz eines Features (bei Ringen über den Ursprung), auf dem Strang des Features gelesen
  function featureSeq(seq, f) {
    const s = String(seq);
    const part = ([a, b]) => a <= b ? s.slice(a - 1, b) : s.slice(a - 1) + s.slice(0, b);
    const raw = (f.parts && f.parts.length ? f.parts : [[f.start, f.end]]).map(part).join('');
    return f.strand == -1 ? revcomp(raw) : raw;
  }

  const Bio = {clean, revcomp, gc, translate, codon, parseFasta, parseGenBank, parseLocation, formatLocation, parseAny, toFasta, toGenBank, findMotif, orfs, featureSeq, BioError};
  if (typeof module != 'undefined' && module.exports) module.exports = Bio; else root.Bio = Bio;
})(this);
