// Sequenz-Funktionen gegen bekannte Werte prüfen: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../web/bio.js');

const puc = B.parseGenBank(fs.readFileSync(path.join(__dirname, 'fixtures/pUC19.gb'), 'utf8'))[0];

test('pUC19 (NCBI L09137) einlesen: 2686 bp, ringförmig', () => {
  assert.equal(puc.seq.length, 2686);
  assert.equal(puc.circular, true);
  assert.equal(puc.accession, 'L09137');
  assert.match(puc.description, /pUC19c/);
  assert.ok(/^[ACGT]+$/.test(puc.seq));
});

test('Motivsuche: EcoRI (GAATTC) und HindIII (AAGCTT) je einmal, 51 bp auseinander', () => {
  const eco = B.findMotif(puc.seq, 'GAATTC', {circular: true}), hind = B.findMotif(puc.seq, 'aagctt', {circular: true});
  assert.equal(eco.length, 1); assert.equal(hind.length, 1);
  assert.equal(Math.abs(eco[0].start - hind[0].start), 51);
  assert.equal(puc.seq.slice(eco[0].start - 1, eco[0].end), 'GAATTC');
});

test('Motivsuche: nicht palindromisch auf beiden Strängen, IUPAC, über den Ursprung', () => {
  const s = 'GGATCCAAAGGTCTCAAATTGAGACC';
  const bsa = B.findMotif(s, 'GGTCTC');
  assert.deepEqual(bsa.map(h => [h.start, h.strand]), [[10, 1], [21, -1]]);
  assert.deepEqual(B.findMotif(s, 'GGWTCC').map(h => h.start), [1]);
  const ring = 'TTCAAAAGAA';  // GAATTC über den Ursprung: Pos. 8..3
  assert.deepEqual(B.findMotif(ring, 'GAATTC', {circular: true}).map(h => [h.start, h.end]), [[8, 3]]);
  assert.equal(B.findMotif(ring, 'GAATTC').length, 0);
});

test('ORF-Suche findet bla (β-Lactamase, 286 aa) in pUC19', () => {
  const o = B.orfs(puc.seq, {minAa: 200, circular: true});
  assert.equal(o[0].aa, 286);
  assert.ok(o[0].protein.startsWith('MSIQHFRVALIPFFAAFCLPVFA'), o[0].protein.slice(0, 30));
  assert.equal(B.translate(B.featureSeq(puc.seq, o[0])), o[0].protein + '*');
  assert.equal(Math.abs(o[0].end - o[0].start) + 1, 861);
});

test('GenBank mit complement, join und mehrzeiligen Angaben', () => {
  const gb = `LOCUS       TEST                      30 bp    DNA     linear   SYN 01-JAN-2026
DEFINITION  Testsequenz mit
            zwei Zeilen.
FEATURES             Location/Qualifiers
     source          1..30
     CDS             complement(join(2..7,10..15))
                     /gene="abc"
                     /note="lange
                     Notiz"
     misc_feature    <20..>30
                     /label=Ende
     promoter        order(complement(25..28),complement(18..21))
ORIGIN
        1 atgaaacccg ggtttaaacc cgggtttaaa
//
`;
  const r = B.parseGenBank(gb)[0];
  assert.equal(r.description, 'Testsequenz mit zwei Zeilen.');
  assert.equal(r.circular, false); assert.equal(r.seq.length, 30);
  assert.deepEqual(r.features.map(f => [f.type, f.label, f.start, f.end, f.strand]),
    [['CDS', 'abc', 2, 15, -1], ['misc_feature', 'Ende', 20, 30, 1], ['promoter', 'promoter', 18, 28, -1]]);
  assert.deepEqual(r.features[0].parts, [[2, 7], [10, 15]]);
  assert.equal(B.featureSeq(r.seq, r.features[0]), B.revcomp('TGAAAC' + 'GGGTTT'));
});

test('GenBank und FASTA schreiben und wieder einlesen', () => {
  const rec = {name: 'pUC19', description: 'Test', seq: puc.seq, circular: true,
    features: [{type: 'CDS', label: 'bla', start: 100, end: 960, strand: -1}, {type: 'misc_feature', label: 'Ursprung', start: 2600, end: 20, strand: 1, parts: [[2600, 2686], [1, 20]]}]};
  const back = B.parseAny(B.toGenBank(rec))[0];
  assert.equal(back.seq, puc.seq); assert.equal(back.circular, true);
  assert.deepEqual(back.features.map(f => [f.label, f.start, f.end, f.strand]), [['bla', 100, 960, -1], ['Ursprung', 2600, 20, 1]]);
  const fa = B.parseAny(B.toFasta('pUC19 Vektor', puc.seq))[0];
  assert.equal(fa.seq, puc.seq); assert.equal(fa.name, 'pUC19_Vektor');
  assert.equal(B.parseAny('acgt nn\n12 tt')[0].seq, 'ACGTNNTT');
  assert.throws(() => B.parseAny('ACGTX'), /Unbekanntes Zeichen/);
});

test('Revers-Komplement, Übersetzung, GC', () => {
  assert.equal(B.revcomp('ATGCRYN'), 'NRYGCAT');
  assert.equal(B.translate('ATGGCCTAAGG'), 'MA*');
  assert.equal(B.translate('ATGGCCTAA', 1), 'WP');
  assert.equal(B.gc('GGCCAATT'), 50);
  assert.ok(Math.abs(B.gc(puc.seq) - 50.1) < 1, `GC pUC19 ${B.gc(puc.seq)}`);
});
