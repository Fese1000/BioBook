// Kennungen im Text erkennen: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const D = require('../web/dblinks.js');
const ids = t => D.findIds(t).map(h => [h.kind, h.id]);

test('RefSeq, GenBank, UniProt, PubMed, DOI, Addgene', () => {
  assert.deepEqual(ids('p53 mRNA NM_000546.6 und Protein NP_000537 (UniProt P04637), Vektor L09137, Klon AB123456'),
    [['refseq', 'NM_000546.6'], ['refseq', 'NP_000537'], ['uniprot', 'P04637'], ['genbank', 'L09137'], ['genbank', 'AB123456']]);
  assert.deepEqual(ids('siehe PMID: 2851488 und doi 10.1016/0378-1119(85)90120-9.'), [['pubmed', '2851488'], ['doi', '10.1016/0378-1119(85)90120-9']]);
  assert.deepEqual(ids('Plasmid von Addgene #12345, UniProt Q9Y6K9 und A0A024R161'), [['addgene', '12345'], ['uniprot', 'Q9Y6K9'], ['uniprot', 'A0A024R161']]);
});

test('Links zeigen auf die richtige Datenbank; Holen nur für Nukleotid und UniProt', () => {
  const [nm, np, up, pm] = D.findIds('NM_000546 NP_000537 P04637 PMID 1');
  assert.equal(nm.url, 'https://www.ncbi.nlm.nih.gov/nuccore/NM_000546'); assert.equal(nm.fetch, 'ncbi-nuccore');
  assert.equal(np.url, 'https://www.ncbi.nlm.nih.gov/protein/NP_000537'); assert.equal(np.fetch, null);
  assert.equal(up.url, 'https://www.uniprot.org/uniprotkb/P04637'); assert.equal(up.fetch, 'uniprot');
  assert.equal(pm.url, 'https://pubmed.ncbi.nlm.nih.gov/1/');
});

test('Keine Treffer in Laborbuch-Codes, Zahlen und Wörtern', () => {
  assert.deepEqual(ids('PL-0001, BS-00012, KU-00001, 250 µl, 12345, PCR, DMEM, T75, ABC12, X1234'), []);
});
