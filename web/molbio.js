// Molekularbiologie: Sequenz bearbeiten (Features wandern mit), Sanger-Lesungen (.ab1) lesen und gegen eine Referenz ausrichten,
// Klonierung simulieren (Restriktion/Ligation, Gibson, Golden Gate). Reine Funktionen, getestet in tests/molbio.test.js.
(function (root) {
  'use strict';
  const B = typeof Bio != 'undefined' ? Bio : require('./bio.js');

  // ---------- Bearbeiten ----------
  /// op: {type: 'insert', at (1-basiert, Text kommt davor), text} | {type: 'delete', at, len} | {type: 'replace', at, len, text}
  function editSequence(rec, op) {
    let {seq, features = [], circular = false} = rec;
    const n = seq.length, text = B.clean(op.text || '');
    const at = op.at | 0, len = op.len | 0;
    if (op.type != 'insert' && (len < 1 || at < 1 || at + len - 1 > n)) throw new Error(`Bereich ${at}–${at + len - 1} liegt nicht in der Sequenz (1–${n})`);
    if (op.type == 'insert' && (at < 1 || at > n + 1)) throw new Error(`Position ${at} liegt nicht in der Sequenz (1–${n + 1})`);
    if (op.type == 'replace') return editSequence(editSequence(rec, {type: 'delete', at, len}), {type: 'insert', at, text});
    if (op.type == 'insert') {
      if (!text) throw new Error('Kein Text zum Einfügen');
      const L = text.length, m = p => p >= at ? p + L : p;
      return {seq: seq.slice(0, at - 1) + text + seq.slice(at - 1), circular,
        features: features.map(f => ({...f, start: m(f.start), end: m(f.end), parts: undefined}))};  // Feature über der Stelle wird länger, eins davor bleibt
    }
    const b = at + len - 1;
    const ms = p => p < at ? p : p > b ? p - len : at, me = p => p < at ? p : p > b ? p - len : at - 1;
    const out = [];
    for (const f of features) {
      const wrap = f.end < f.start;
      if (!wrap && f.start >= at && f.end <= b) continue;  // ganz gelöscht
      const g = {...f, start: ms(f.start), end: me(f.end), parts: undefined};
      if (!wrap && g.end < g.start) continue;
      if (g.start < 1 || g.end < 1) continue;
      out.push(g);
    }
    return {seq: seq.slice(0, at - 1) + seq.slice(b), circular, features: out};
  }

  // ---------- Sanger: ABIF (.ab1) ----------
  /// Basen (PBAS2), Qualitäten (PCON2), Peak-Positionen (PLOC2), Spuren je Base (DATA9–12 nach FWO_1), Probenname (SMPL1)
  function parseAB1(buf) {
    const b = new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf), v = new DataView(b.buffer);
    if (String.fromCharCode(...b.slice(0, 4)) != 'ABIF') throw new Error('Keine ABI-Datei (.ab1)');
    const count = v.getInt32(18), dirOff = v.getInt32(26), tags = {};
    for (let i = 0; i < count; i++) {
      const o = dirOff + i * 28;
      const name = String.fromCharCode(...b.slice(o, o + 4)) + v.getInt32(o + 4);
      const type = v.getInt16(o + 8), elSize = v.getInt16(o + 10), num = v.getInt32(o + 12), size = v.getInt32(o + 16);
      const at = size <= 4 ? o + 20 : v.getInt32(o + 20);
      tags[name] = {type, elSize, num, at, size};
    }
    const bytes = t => t ? b.slice(t.at, t.at + t.size) : new Uint8Array(0);
    const str = name => { const t = tags[name]; if (!t) return ''; const d = bytes(t); return String.fromCharCode(...(t.type == 18 ? d.slice(1, 1 + d[0]) : d)).replace(/\0+$/, ''); };
    const shorts = name => { const t = tags[name]; if (!t) return []; const out = new Array(t.num); for (let i = 0; i < t.num; i++) out[i] = v.getInt16(t.at + i * 2); return out; };
    const seq = str('PBAS2') || str('PBAS1');
    const qual = [...bytes(tags.PCON2 || tags.PCON1)].slice(0, seq.length);
    const order = str('FWO_1') || 'GATC', traces = {};
    [...order].forEach((base, i) => { traces[base] = shorts(`DATA${9 + i}`); });
    return {seq, qual, ploc: shorts('PLOC2').length ? shorts('PLOC2') : shorts('PLOC1'), traces, sample: str('SMPL1')};
  }

  /// Gute Mitte einer Lesung: Fenster, in dem die mittlere Qualität ≥ q ist (Ränder von Sanger-Lesungen sind schlecht)
  function trimRange(qual, q = 20, w = 20) {
    let a = 0, z = qual.length;
    const ok = i => { let s = 0, c = 0; for (let k = i; k < Math.min(qual.length, i + w); k++) { s += qual[k]; c++; } return c && s / c >= q; };
    while (a < z && !ok(a)) a++;
    while (z > a && !ok(Math.max(a, z - w))) z--;
    return [a, z];
  }

  // ---------- Lokale Ausrichtung (Smith-Waterman, linear) ----------
  function sw(ref, read) {
    const MATCH = 2, MIS = -3, GAP = -5, n = ref.length, m = read.length;
    if (n * m > 3e7) throw new Error('Sequenzen zu lang für die Ausrichtung');
    const dir = new Uint8Array((n + 1) * (m + 1)); let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
    let best = 0, bi = 0, bj = 0;
    for (let i = 1; i <= n; i++) {
      cur[0] = 0;
      const r = ref.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        const q = read.charCodeAt(j - 1);
        const d = prev[j - 1] + (r == q && q != 78 ? MATCH : MIS), u = prev[j] + GAP, l = cur[j - 1] + GAP;
        let s = 0, k = 0;
        if (d > s) { s = d; k = 1; } if (u > s) { s = u; k = 2; } if (l > s) { s = l; k = 3; }
        cur[j] = s; dir[i * (m + 1) + j] = k;
        if (s > best) { best = s; bi = i; bj = j; }
      }
      [prev, cur] = [cur, prev];
    }
    let i = bi, j = bj, ra = '', qa = '';
    while (i > 0 && j > 0 && dir[i * (m + 1) + j]) {
      const k = dir[i * (m + 1) + j];
      if (k == 1) { ra = ref[i - 1] + ra; qa = read[j - 1] + qa; i--; j--; }
      else if (k == 2) { ra = ref[i - 1] + ra; qa = '-' + qa; i--; }
      else { ra = '-' + ra; qa = read[j - 1] + qa; j--; }
    }
    return {score: best, refStart: i, readStart: j, ra, qa};
  }

  /// Lesung (beide Stränge) gegen Referenz; Ring: über den Ursprung. Abweichungen mit Position in der Referenz (1-basiert) und Qualität.
  function alignRead(ref, read, {circular = false, qual = []} = {}) {
    const R = String(ref).toUpperCase(), n = R.length;
    const hay = circular ? R + R.slice(0, Math.min(read.length, n)) : R;
    const fw = sw(hay, read.toUpperCase()), rc = sw(hay, B.revcomp(read.toUpperCase()));
    const useRc = rc.score > fw.score, a = useRc ? rc : fw, rq = useRc ? [...qual].reverse() : qual;
    const diffs = [];
    let rp = a.refStart, qp = a.readStart, same = 0, cols = 0;
    for (let k = 0; k < a.ra.length; k++) {
      const x = a.ra[k], y = a.qa[k];
      if (x != '-') rp++;
      if (y != '-') qp++;
      cols++;
      if (x == y) { same++; continue; }
      const pos = ((rp - 1) % n) + 1, readIdx = useRc ? read.length - qp + 1 : qp;
      diffs.push({type: x == '-' ? 'ins' : y == '-' ? 'del' : 'sub', refPos: pos, ref: x, read: y, readPos: readIdx, q: y == '-' ? null : rq[qp - 1] ?? null});
    }
    return {strand: useRc ? -1 : 1, score: a.score, refStart: a.refStart % n + 1, refEnd: ((rp - 1) % n) + 1, readStart: a.readStart + 1, readEnd: qp,
      length: cols, identity: cols ? same / cols * 100 : 0, diffs, ra: a.ra, qa: a.qa};
  }

  // ---------- Klonierung ----------
  /// Schnitte mit beiden Strängen: cut = oberer Strang, cut2 = unterer (beides „nach Base“, 0 … n); Überhang dazwischen
  function cutsDetailed(seq, names, circular) {
    const n = seq.length, out = [];
    for (const name of names) {
      const e = B.enzyme(name), L = e.site.length;
      for (const h of B.findMotif(seq, e.site, {circular})) {
        // palindromisch: unterer Schnitt spiegelbildlich (cut2 = L − cut); Typ IIS rückwärts: beide Schnitte links vor der Stelle
        const fw = !e.iis || h.strand == 1;
        const c = fw ? h.start - 1 + e.cut : h.start - 1 - (e.cut2 - L), c2 = fw ? h.start - 1 + e.cut2 : h.start - 1 - (e.cut - L);
        if (!circular && (Math.min(c, c2) < 0 || Math.max(c, c2) > n)) continue;
        out.push({enzyme: name, cut: ((c % n) + n) % n, cut2: ((c2 % n) + n) % n, strand: h.strand, raw: c, raw2: c2});
      }
    }
    return out.sort((a, b) => a.cut - b.cut);
  }

  const ring = (s, from, len) => { let o = ''; for (let i = 0; i < len; i++) o += s[(from + i) % s.length]; return o; };
  /// Überhang an einem Schnitt: Basen zwischen oberem und unterem Schnitt; type 5′, 3′ oder glatt
  function overhang(seq, c) {
    const lo = Math.min(c.raw, c.raw2), hi = Math.max(c.raw, c.raw2), n = seq.length;
    return {enzyme: c.enzyme, seq: ring(seq, ((lo % n) + n) % n, hi - lo), type: c.raw2 > c.raw ? '5' : c.raw2 < c.raw ? '3' : 'blunt'};
  }
  const sameEnd = (a, b) => a && b && a.type == b.type && a.seq == b.seq;

  /// Fragmente: {seq (oberer Strang von Schnitt zu Schnitt), from (0-basiert), len, left, right, sites (Erkennungsstellen darin)}
  function fragments(seq, circular, cuts, names = []) {
    const n = seq.length, cs = [...new Map(cuts.map(c => [c.cut, c])).values()].sort((a, b) => a.cut - b.cut), out = [];
    if (!cs.length) return [{seq, from: 0, len: n, left: null, right: null, sites: 0}];
    const mk = (a, b, from, len) => {
      const s = ring(seq, from, len);
      const sites = names.reduce((k, nm) => k + B.findMotif(s, B.enzyme(nm).site).length, 0);
      return {seq: s, from, len, left: a ? overhang(seq, a) : null, right: b ? overhang(seq, b) : null, sites};
    };
    if (circular) cs.forEach((c, i) => { const d = cs[(i + 1) % cs.length]; const len = i + 1 < cs.length ? d.cut - c.cut : n - c.cut + d.cut; out.push(mk(c, d, c.cut, len)); });
    else {
      out.push(mk(null, cs[0], 0, cs[0].cut));
      cs.forEach((c, i) => { const d = cs[i + 1]; out.push(mk(c, d || null, c.cut, (d ? d.cut : n) - c.cut)); });
    }
    return out.filter(f => f.len > 0);
  }

  /// Features eines Ausgangsstücks ins Produkt übertragen (nur solche, die ganz im Stück liegen)
  function carryFeatures(src, frag, offset, reverse = false) {
    const n = src.seq.length, out = [];
    for (const f of src.features || []) {
      const s0 = ((f.start - 1 - frag.from) % n + n) % n, e0 = ((f.end - 1 - frag.from) % n + n) % n;
      if (s0 >= frag.len || e0 >= frag.len || e0 < s0) continue;
      if (!reverse) out.push({type: f.type, label: f.label, strand: f.strand, start: offset + s0 + 1, end: offset + e0 + 1});
      else out.push({type: f.type, label: f.label, strand: -f.strand || -1, start: offset + (frag.len - 1 - e0) + 1, end: offset + (frag.len - 1 - s0) + 1});
    }
    return out;
  }

  /// Restriktion/Ligation: Vektor und Insert mit denselben Enzymen schneiden; das Insert kommt in passender Richtung ins Rückgrat
  function restrictionLigation(vector, insert, enzymes) {
    const names = [...new Set(enzymes.filter(Boolean))];
    if (!names.length) throw new Error('Mindestens ein Enzym wählen');
    const vc = cutsDetailed(vector.seq, names, vector.circular !== false);
    if (vc.length < 1 || vc.length > 2) throw new Error(`Der Vektor wird ${vc.length}× geschnitten – erwartet sind 1 oder 2 Schnitte`);
    const vf = fragments(vector.seq, vector.circular !== false, vc), back = vf.sort((a, b) => b.len - a.len)[0];
    const tryInsert = (seq, reverse) => {
      const ic = cutsDetailed(seq, names, insert.circular);
      const frs = fragments(seq, insert.circular, ic).filter(f => f.left && f.right && f !== null);
      return frs.filter(f => sameEnd(f.left, back.right) && sameEnd(f.right, back.left)).map(f => ({...f, reverse}));
    };
    const cands = [...tryInsert(insert.seq, false), ...tryInsert(B.revcomp(insert.seq), true)].sort((a, b) => (a.reverse - b.reverse) || (b.len - a.len));
    if (!cands.length) throw new Error('Kein Insert-Stück passt mit seinen Enden ins geschnittene Rückgrat');
    const ins = cands[0];
    const both = cands.some(c => c.reverse != ins.reverse);
    const srcIns = ins.reverse ? {seq: B.revcomp(insert.seq), features: []} : insert;
    const feats = [...carryFeatures(vector, back, 0), ...(ins.reverse ? carryFeatures(insert, {from: insert.seq.length - ins.from - ins.len, len: ins.len}, back.len, true) : carryFeatures(srcIns, ins, back.len))];
    return {seq: back.seq + ins.seq, circular: true, features: feats, notes: [`Rückgrat ${back.len} bp + Insert ${ins.len} bp${ins.reverse ? ' (umgedreht eingesetzt)' : ''}`,
      ...(both ? ['Mit diesen Enden geht das Insert in beide Richtungen hinein – Richtung im Labor prüfen (z. B. Kolonie-PCR)'] : [])]};
  }

  /// Gibson: aufeinanderfolgende Stücke überlappen am Ende/Anfang (≥ minOverlap bp); Ring über letztes → erstes
  function gibson(parts, {minOverlap = 15, circular = true} = {}) {
    if (parts.length < (circular ? 1 : 2)) throw new Error('Mindestens zwei Stücke');
    const ov = (a, b) => { for (let k = Math.min(80, a.length, b.length); k >= minOverlap; k--) if (a.slice(-k) == b.slice(0, k)) return k; return 0; };
    let seq = parts[0].seq.toUpperCase(), feats = carryFeatures(parts[0], {from: 0, len: parts[0].seq.length}, 0);
    const notes = [];
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i].seq.toUpperCase(), k = ov(seq, p);
      if (!k) throw new Error(`Stück ${i} und ${i + 1} überlappen nicht (mindestens ${minOverlap} bp nötig)`);
      notes.push(`Stück ${i} → ${i + 1}: ${k} bp Überlappung`);
      feats.push(...carryFeatures(parts[i], {from: 0, len: p.length}, seq.length - k));
      seq += p.slice(k);
    }
    if (circular) {
      const k = ov(seq, parts[0].seq.toUpperCase());
      if (!k) throw new Error(`Letztes und erstes Stück überlappen nicht – der Ring schließt sich nicht`);
      notes.push(`Ring geschlossen: ${k} bp Überlappung`);
      seq = seq.slice(0, seq.length - k);
      feats = feats.filter(f => f.end <= seq.length);
    }
    return {seq, circular, features: feats, notes};
  }

  /// Golden Gate: jedes Stück mit dem Typ-IIS-Enzym schneiden, das Fragment ohne Erkennungsstelle nehmen, über die 4-nt-Überhänge zum Ring verketten
  function goldenGate(parts, enzyme = 'BsaI') {
    const frs = parts.map((p, i) => {
      const cs = cutsDetailed(p.seq.toUpperCase(), [enzyme], p.circular !== false && i == 0 ? true : !!p.circular);
      const f = fragments(p.seq.toUpperCase(), p.circular !== false && i == 0 ? true : !!p.circular, cs, [enzyme]).filter(x => x.left && x.right && x.sites == 0);
      if (f.length != 1) throw new Error(`Stück ${i + 1}: ${f.length ? 'mehrere' : 'kein'} passendes ${enzyme}-Fragment (zwei Schnittstellen nach außen nötig)`);
      return {...f[0], part: i};
    });
    const used = new Set([0]), chain = [frs[0]];
    let curEnd = frs[0].right;
    while (!sameEnd(curEnd, frs[0].left)) {
      const next = frs.filter(f => !used.has(f.part) && sameEnd(f.left, curEnd));
      if (next.length != 1) throw new Error(next.length ? `Überhang ${curEnd.seq} kommt mehrfach vor` : `Kein Stück beginnt mit dem Überhang ${curEnd.seq}`);
      chain.push(next[0]); used.add(next[0].part); curEnd = next[0].right;
    }
    if (used.size != parts.length) throw new Error(`${parts.length - used.size} Stück(e) passen nicht in die Kette`);
    let seq = '', feats = [];
    for (const f of chain) { feats.push(...carryFeatures(parts[f.part], f, seq.length)); seq += f.seq; }
    return {seq, circular: true, features: feats, notes: [`Reihenfolge: ${chain.map(f => `Stück ${f.part + 1}`).join(' → ')}`, `Überhänge: ${chain.map(f => f.left.seq).join(', ')}`]};
  }

  const MolBio = {editSequence, parseAB1, trimRange, alignRead, cutsDetailed, fragments, restrictionLigation, gibson, goldenGate};
  if (typeof module != 'undefined' && module.exports) module.exports = MolBio; else root.MolBio = MolBio;
})(this);
