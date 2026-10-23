// Molekularbiologie: node --test tests/  (.ab1-Dateien und Erwartungswerte aus dem Biopython-Projekt, Tests/Abi)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../web/bio.js');
const M = require('../web/molbio.js');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const expected = JSON.parse(fx('abi-expected.json'));
const puc = B.parseGenBank(fx('pUC19.gb').toString())[0];

test('Sequenz bearbeiten: Features wandern mit, gelöschte verschwinden', () => {
  const rec = {seq: 'AAAACCCCGGGGTTTT', circular: false, features: [{label: 'C', start: 5, end: 8, strand: 1}, {label: 'T', start: 13, end: 16, strand: -1}, {label: 'G', start: 9, end: 12}]};
  const ins = M.editSequence(rec, {type: 'insert', at: 9, text: 'aaa'});
  assert.equal(ins.seq, 'AAAACCCCAAAGGGGTTTT');
  assert.deepEqual(ins.features.map(f => [f.label, f.start, f.end]), [['C', 5, 8], ['T', 16, 19], ['G', 12, 15]]);
  const del = M.editSequence(rec, {type: 'delete', at: 9, len: 4});
  assert.equal(del.seq, 'AAAACCCCTTTT');
  assert.deepEqual(del.features.map(f => [f.label, f.start, f.end]), [['C', 5, 8], ['T', 9, 12]]);
  const part = M.editSequence(rec, {type: 'delete', at: 7, len: 4});  // schneidet C und G an
  assert.deepEqual(part.features.map(f => [f.label, f.start, f.end]), [['C', 5, 6], ['T', 9, 12], ['G', 7, 8]]);
  const rep = M.editSequence(rec, {type: 'replace', at: 5, len: 4, text: 'TT'});
  assert.equal(rep.seq, 'AAAATTGGGGTTTT');
  assert.throws(() => M.editSequence(rec, {type: 'delete', at: 15, len: 5}), /liegt nicht/);
});

test('.ab1 lesen: Basen, Qualitäten und Probenname wie Biopython', () => {
  for (const f of ['3730.ab1', '310.ab1']) {
    const r = M.parseAB1(fx(f));
    assert.equal(r.seq, expected[f].seq, f); assert.deepEqual(r.qual, expected[f].qual, f); assert.equal(r.sample, expected[f].sample, f);
    assert.equal(r.ploc.length, r.seq.length); assert.ok(['A', 'C', 'G', 'T'].every(b => r.traces[b].length > 1000));
  }
  assert.throws(() => M.parseAB1(Buffer.from('kein abi')), /Keine ABI-Datei/);
});

test('Sanger-Lesung gegen Referenz: eingebaute Mutation an der richtigen Stelle, beide Stränge', () => {
  const r = M.parseAB1(fx('3730.ab1'));
  const [a, z] = M.trimRange(r.qual);
  assert.ok(a < 60 && z > 900, `gute Mitte ${a}–${z}`);
  const good = r.seq.slice(150, 950);
  const i = 300, alt = good[i] == 'A' ? 'G' : 'A';
  const ref = 'TTTTGGGGCCCC' + good.slice(0, i) + alt + good.slice(i + 1) + 'GGGGAAAA';  // Referenz mit einer abweichenden Base
  const al = M.alignRead(ref, r.seq, {qual: r.qual});
  const subs = al.diffs.filter(d => d.type == 'sub');
  assert.equal(al.strand, 1);
  assert.ok(subs.some(d => d.refPos == 12 + i + 1 && d.ref == alt && d.read == good[i]), JSON.stringify(subs.slice(0, 5)));
  assert.ok(al.identity > 95, `Identität ${al.identity}`);
  const alr = M.alignRead(B.revcomp(ref), r.seq, {qual: r.qual});
  assert.equal(alr.strand, -1);
  assert.ok(alr.diffs.some(d => d.type == 'sub' && d.refPos == ref.length - (12 + i)), 'auf dem Gegenstrang gespiegelt');
});

test('Restriktion/Ligation in pUC19 mit EcoRI und HindIII', () => {
  const X = 'ATGGTGAGCAAGGGCGAGGAGGATAACATGGCCTAA';
  const insert = {seq: 'CCCCGAATTC' + X + 'AAGCTTCCCC', circular: false, features: [{type: 'CDS', label: 'Gen', start: 11, end: 10 + X.length, strand: 1}]};
  const orf = B.orfs(puc.seq, {minAa: 200, circular: true})[0];
  const vector = {seq: puc.seq, circular: true, features: [{type: 'CDS', label: 'bla', start: orf.start, end: orf.end, strand: orf.strand}]};
  const p = M.restrictionLigation(vector, insert, ['EcoRI', 'HindIII']);
  assert.equal(p.seq.length, 2686 - 51 + 4 + X.length + 2);
  assert.ok(p.seq.includes(X) || p.seq.includes(B.revcomp(X)));
  assert.equal(B.findMotif(p.seq, 'GAATTC', {circular: true}).length, 1); assert.equal(B.findMotif(p.seq, 'AAGCTT', {circular: true}).length, 1);
  const bla = p.features.find(f => f.label == 'bla'), gen = p.features.find(f => f.label == 'Gen');
  assert.equal(B.translate(B.featureSeq(p.seq, bla)).slice(0, 23), 'MSIQHFRVALIPFFAAFCLPVFA');
  assert.equal(B.featureSeq(p.seq, gen), X);
  assert.throws(() => M.restrictionLigation(vector, insert, ['PvuII']), /Kein Insert-Stück|geschnitten/);
});

test('Gibson aus drei Stücken mit 20-bp-Überlappungen', () => {
  const o1 = 'ACGTACGTTGCATGCAACGT', o2 = 'TTGACCATGGTCAAGTCCAG', o3 = 'GGATCCAATTGGCCAAGTCA';
  const a = o3 + 'AAAAAAAAAACCCCCCCCCC' + o1, b = o1 + 'GGGGGGGGGGTTTTTTTTTT' + o2, c = o2 + 'ATATATATATCGCGCGCGCG' + o3;
  const p = M.gibson([{seq: a}, {seq: b}, {seq: c}]);
  assert.equal(p.seq, o3 + 'AAAAAAAAAACCCCCCCCCC' + o1 + 'GGGGGGGGGGTTTTTTTTTT' + o2 + 'ATATATATATCGCGCGCGCG');
  assert.equal(p.notes.length, 3);
  assert.throws(() => M.gibson([{seq: a}, {seq: c}]), /überlappen nicht/);
});

test('Golden Gate (BsaI): Vektor und zwei Teile über 4-nt-Überhänge', () => {
  const bodyV = 'TTTTCCCCAAAATTTTGGGGCCCCAAAA', bodyA = 'ATGCCCAAATTTGGG', bodyB = 'CCATTTAAAGGGCCC';
  const vector = {seq: 'CGCT' + bodyV + 'AATG' + 'A' + 'GAGACC' + 'TTTTTTTTTT' + 'GGTCTC' + 'A', circular: true};
  const partA = {seq: 'TT' + 'GGTCTC' + 'A' + 'AATG' + bodyA + 'GCTT' + 'A' + 'GAGACC' + 'TT', circular: false, features: [{type: 'CDS', label: 'A', start: 10, end: 13 + bodyA.length, strand: 1}]};
  const partB = {seq: 'GGTCTC' + 'A' + 'GCTT' + bodyB + 'CGCT' + 'A' + 'GAGACC', circular: false};
  const p = M.goldenGate([vector, partB, partA]);
  assert.equal(p.seq, 'CGCT' + bodyV + 'AATG' + bodyA + 'GCTT' + bodyB);
  assert.equal(B.findMotif(p.seq, 'GGTCTC', {circular: true}).length, 0);
  assert.equal(B.featureSeq(p.seq, p.features.find(f => f.label == 'A')), 'AATG' + bodyA);
  assert.throws(() => M.goldenGate([vector, partA]), /Kein Stück beginnt mit dem Überhang GCTT/);
});
