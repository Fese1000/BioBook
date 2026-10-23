// Literatur lesen und schreiben: node --test tests/  (Crossref- und PubMed-Antworten echt, gekürzt, Stand 2026-10-23)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../web/refs.js');
const fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

test('Crossref: DOI 10.1016/0378-1119(85)90120-9 ergibt Yanisch-Perron et al. 1985, Gene', () => {
  const r = R.fromCSL(fx('crossref-10.1016-0378-1119(85)90120-9.json'));
  assert.equal(R.citeShort(r), 'Yanisch-Perron et al. 1985');
  assert.equal(r.journal, 'Gene'); assert.equal(r.pages, '103–119'); assert.equal(r.volume, '33');
  assert.equal(R.formatFull(r), 'Yanisch-Perron C, Vieira J, Messing J (1985) Improved M13 phage cloning vectors and host strains: nucleotide sequences of the M13mpl8 and pUC19 vectors. Gene 33(1):103–119. doi:10.1016/0378-1119(85)90120-9');
});

test('PubMed: PMID 2985470 mit gekürzten Seiten', () => {
  const r = R.fromPubMed(fx('pubmed-2985470.json'), '2985470');
  assert.equal(R.citeShort(r), 'Yanisch-Perron et al. 1985');
  assert.equal(r.pages, '103–119'); assert.equal(r.doi, '10.1016/0378-1119(85)90120-9'); assert.equal(r.pmid, '2985470');
  assert.deepEqual(r.authors[0], {family: 'Yanisch-Perron', given: 'C.'});
  assert.throws(() => R.fromPubMed({result: {uids: []}}, '1'), /nicht gefunden/);
});

const BIB = `% Testdatei
@article{Sanger1977,
  author = {Sanger, F. and Nicklen, S. and Coulson, A. R.},
  title = {{DNA} sequencing with chain-terminating inhibitors},
  journal = {Proc. Natl. Acad. Sci. USA}, year = 1977, volume = {74}, number = {12}, pages = {5463--5467},
  doi = {10.1073/pnas.74.12.5463}
}
@comment{ignorieren}
@article{mullis86,
  author = "Kary B. Mullis and Fred A. Faloona",
  title = "Specific synthesis of {DNA} in vitro via a polymerase-catalyzed chain reaction",
  journal = {Methods Enzymol.}, year = {1987}, volume = {155}, pages = {335-350}
}
@book{Sambrook,
  author = {{Cold Spring Harbor Laboratory} and M{\\"u}ller, J{\\"o}rg},
  title = {Molecular Cloning}, year = {2001}
}`;

test('BibTeX mit drei Quellen: Klammern, Anführungszeichen, Namen, Umlaute', () => {
  const rs = R.parseBibTeX(BIB);
  assert.equal(rs.length, 3);
  assert.equal(rs[0].title, 'DNA sequencing with chain-terminating inhibitors'); assert.equal(rs[0].pages, '5463–5467'); assert.equal(rs[0].issue, '12');
  assert.equal(R.citeShort(rs[0]), 'Sanger et al. 1977');
  assert.equal(R.citeShort(rs[1]), 'Mullis & Faloona 1987'); assert.deepEqual(rs[1].authors[0], {family: 'Mullis', given: 'Kary B.'});
  assert.equal(rs[2].type, 'book'); assert.deepEqual(rs[2].authors, [{family: 'Cold Spring Harbor Laboratory', given: ''}, {family: 'Müller', given: 'Jörg'}]);
});

test('BibTeX und RIS schreiben und wieder lesen', () => {
  const rs = R.parseBibTeX(BIB);
  const back = R.parseBibTeX(R.toBibTeX(rs));
  assert.deepEqual(back.map(r => [R.citeShort(r), r.pages, r.doi]), rs.map(r => [R.citeShort(r), r.pages, r.doi]));
  const ris = R.parseRIS(R.toRIS(rs));
  assert.deepEqual(ris.map(r => [R.citeShort(r), r.pages, r.journal]), rs.map(r => [R.citeShort(r), r.pages, r.journal]));
  assert.equal(R.parseAnyRefs(R.toRIS(rs)).length, 3);
  assert.throws(() => R.parseAnyRefs('nur Text'), /Format nicht erkannt/);
});

test('Zitierschlüssel eindeutig', () => {
  const r = {authors: [{family: 'Müller-Lüdenscheidt'}], year: '2020'};
  const taken = new Set(['MullerLudenscheidt2020']);
  assert.equal(R.makeKey(r, taken), 'MullerLudenscheidt2020a');
});
