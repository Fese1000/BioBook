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

  // ---------- Primer ----------
  // Nearest-Neighbor nach SantaLucia (1998), ΔH in kcal/mol, ΔS in cal/(K·mol); Salzkorrektur nach SantaLucia,
  // Mg²⁺ als Na⁺-Äquivalent (von Ahsen 2001: Na + 120·√(Mg − dNTP)). Gleiches Verfahren wie Primer3 mit santalucia/santalucia.
  const NN = {AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3], CA: [-8.5, -22.7], TG: [-8.5, -22.7],
    GT: [-8.4, -22.4], AC: [-8.4, -22.4], CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2],
    CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9]};
  const TM_DEFAULTS = {na: 50, mg: 1.5, dntp: 0.6, oligo: 50};  // mM, mM, mM, nM – die Voreinstellungen von Primer3

  function tm(seq, opts = {}) {
    const o = {...TM_DEFAULTS, ...opts}, s = clean(seq).replace(/U/g, 'T');
    if (s.length < 2) fail('Primer zu kurz');
    if (/[^ACGT]/.test(s)) fail('Tm nur für eindeutige Basen (A, C, G, T)');
    let dH = 0, dS = 0;
    for (let i = 0; i < s.length - 1; i++) { const [h, e] = NN[s.slice(i, i + 2)]; dH += h; dS += e; }
    for (const end of [s[0], s[s.length - 1]]) { if (end == 'G' || end == 'C') { dH += 0.1; dS += -2.8; } else { dH += 2.3; dS += 4.1; } }
    const self = s == revcomp(s);
    if (self) dS += -1.4;
    const naEq = o.na + (o.mg > o.dntp ? 120 * Math.sqrt(o.mg - o.dntp) : 0);
    dS += 0.368 * (s.length - 1) * Math.log(naEq / 1000);
    const ct = o.oligo * 1e-9 / (self ? 1 : 4);
    return 1000 * dH / (dS + 1.987 * Math.log(ct)) - 273.15;
  }

  /// Längster komplementärer Abschnitt zwischen zwei Oligos (beide 5'→3'), und wie viele davon am 3'-Ende von a liegen
  function dimer(a, b = a) {
    const x = clean(a), y = revcomp(clean(b));
    let best = 0, end3 = 0;
    for (let shift = -y.length + 1; shift < x.length; shift++) {
      let run = 0;
      for (let i = 0; i < x.length; i++) {
        const j = i - shift;
        if (j >= 0 && j < y.length && x[i] == y[j]) { run++; if (run > best) best = run; if (i == x.length - 1 && run > end3) end3 = run; }
        else run = 0;
      }
    }
    return {run: best, end3};
  }

  /// Kennzahlen eines Primers mit Hinweisen
  function primerInfo(seq, opts) {
    const s = clean(seq).replace(/U/g, 'T'), t = tm(s, opts), d = dimer(s), notes = [];
    const g = gc(s);
    if (s.length < 18) notes.push('kurz (< 18 nt)'); if (s.length > 30) notes.push('lang (> 30 nt)');
    if (g < 40 || g > 60) notes.push(`GC ${Math.round(g)} % (ideal 40–60 %)`);
    if (!/[GC]$/.test(s)) notes.push('kein G/C am 3\'-Ende');
    if (/[GC]{4,}$/.test(s)) notes.push('mehr als 3 G/C am 3\'-Ende');
    if (/(A{5,}|C{5,}|G{5,}|T{5,})/.test(s)) notes.push('Wiederholung von 5+ gleichen Basen');
    if (d.end3 >= 4) notes.push(`3'-Ende bindet an sich selbst (${d.end3} bp)`);
    return {seq: s, length: s.length, gc: g, tm: t, selfRun: d.run, self3: d.end3, notes};
  }

  /// Bindestellen eines Primers auf der Vorlage: ganzer Primer oder (bei Überhängen) mindestens min Basen am 3'-Ende
  function primerSites(template, primer, {circular = false, min = 15} = {}) {
    const p = clean(primer).replace(/U/g, 'T');
    for (let k = p.length; k >= Math.min(min, p.length); k--) {
      const tail = p.slice(p.length - k), hits = findMotif(template, tail, {circular});
      if (hits.length) return hits.map(h => ({...h, matched: k, overhang: p.length - k,
        start3: h.strand == 1 ? h.end : h.start}));  // Position des 3'-Endes auf der Vorlage
    }
    return [];
  }

  // ---------- Restriktion ----------
  // Erkennungsstelle mit ^ an der Schnittstelle im oberen Strang; Typ IIS: Stelle(n1/n2) = Schnitt n1 bzw. n2 Basen hinter der Stelle
  const ENZYMES = {
    AatII: 'GACGT^C', AflII: 'C^TTAAG', AgeI: 'A^CCGGT', AluI: 'AG^CT', ApaI: 'GGGCC^C', AscI: 'GG^CGCGCC', AvrII: 'C^CTAGG',
    BamHI: 'G^GATCC', BglII: 'A^GATCT', BsaI: 'GGTCTC(1/5)', BsmBI: 'CGTCTC(1/5)', BspHI: 'T^CATGA', BsrGI: 'T^GTACA',
    ClaI: 'AT^CGAT', DraI: 'TTT^AAA', EcoRI: 'G^AATTC', EcoRV: 'GAT^ATC', HaeIII: 'GG^CC', HincII: 'GTY^RAC', HindIII: 'A^AGCTT',
    HinfI: 'G^ANTC', HpaI: 'GTT^AAC', KpnI: 'GGTAC^C', MfeI: 'C^AATTG', MluI: 'A^CGCGT', MspI: 'C^CGG', NcoI: 'C^CATGG',
    NdeI: 'CA^TATG', NheI: 'G^CTAGC', NlaIII: 'CATG^', NotI: 'GC^GGCCGC', NruI: 'TCG^CGA', NsiI: 'ATGCA^T', PacI: 'TTAAT^TAA',
    PmeI: 'GTTT^AAAC', PstI: 'CTGCA^G', PvuI: 'CGAT^CG', PvuII: 'CAG^CTG', SacI: 'GAGCT^C', SacII: 'CCGC^GG', SalI: 'G^TCGAC',
    SapI: 'GCTCTTC(1/4)', ScaI: 'AGT^ACT', SmaI: 'CCC^GGG', SpeI: 'A^CTAGT', SphI: 'GCATG^C', SspI: 'AAT^ATT', StuI: 'AGG^CCT',
    SwaI: 'ATTT^AAAT', XbaI: 'T^CTAGA', XhoI: 'C^TCGAG', XmaI: 'C^CCGGG', ZraI: 'GAC^GTC',
  };

  function enzyme(name) {
    const def = ENZYMES[name] || fail(`Unbekanntes Enzym: ${name}`);
    const iis = /^([A-Z]+)\((-?\d+)\/(-?\d+)\)$/.exec(def);
    if (iis) return {name, site: iis[1], cut: iis[1].length + +iis[2], cut2: iis[1].length + +iis[3], iis: true};
    const site = def.replace('^', '');
    return {name, site, cut: def.indexOf('^'), cut2: site.length - def.indexOf('^'), iis: false};
  }

  /// Schnittstellen im oberen Strang: {enzyme, cut (nach dieser Base, 1-basiert), site (Start der Erkennungsstelle), strand}
  function cutSites(seq, names, {circular = false} = {}) {
    const n = seq.length, out = [];
    for (const name of names) {
      const e = enzyme(name);
      for (const h of findMotif(seq, e.site, {circular})) {
        // Vorwärts: Schnitt nach Base start-1+cut; rückwärts (Typ IIS): vor der Stelle, um cut2 Basen versetzt
        let c = h.strand == 1 || !e.iis ? h.start - 1 + (h.strand == 1 ? e.cut : e.site.length - e.cut2) : h.start - 1 - (e.cut2 - e.site.length);
        if (!circular && (c <= 0 || c >= n)) continue;
        c = ((c - 1) % n + n) % n + 1;
        out.push({enzyme: name, cut: c, site: h.start, strand: h.strand});
      }
    }
    return out.sort((a, b) => a.cut - b.cut);
  }

  /// Virtueller Verdau: Fragmente {size, from, to} absteigend nach Größe
  function digest(seq, names, {circular = false} = {}) {
    const n = seq.length, cuts = [...new Set(cutSites(seq, names, {circular}).map(c => c.cut))].sort((a, b) => a - b);
    if (!cuts.length) return [{size: n, from: 1, to: n, uncut: true}];
    const frags = [];
    if (circular) {
      for (let i = 0; i < cuts.length; i++) {
        const a = cuts[i], b = cuts[(i + 1) % cuts.length];
        frags.push({size: i + 1 < cuts.length ? b - a : n - a + b, from: a % n + 1, to: b});
      }
    } else {
      const pts = [0, ...cuts, n];
      for (let i = 0; i + 1 < pts.length; i++) frags.push({size: pts[i + 1] - pts[i], from: pts[i] + 1, to: pts[i + 1]});
    }
    return frags.sort((a, b) => b.size - a.size);
  }

  const Bio = {tm, dimer, primerInfo, primerSites, ENZYMES, enzyme, cutSites, digest, clean, revcomp, gc, translate, codon, parseFasta, parseGenBank, parseLocation, formatLocation, parseAny, toFasta, toGenBank, findMotif, orfs, featureSeq, BioError};
  if (typeof module != 'undefined' && module.exports) module.exports = Bio; else root.Bio = Bio;
})(this);
