// Summenformel und Molmasse aus SMILES gegen Literaturwerte: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../web/chem.js');
const check = (smiles, hill, mass) => { const f = C.formula(smiles); assert.equal(f.hill, hill, smiles); assert.ok(Math.abs(f.mass - mass) < 0.006, `${smiles}: ${f.mass} statt ${mass}`); };

test('Puffer und Reagenzien', () => {
  check('OCC(N)(CO)CO', 'C4H11NO3', 121.14);                       // Tris
  check('OCCN1CCN(CC1)CCS(=O)(=O)O', 'C8H18N2O4S', 238.30);         // HEPES
  check('OC(=O)CN(CCN(CC(=O)O)CC(=O)O)CC(=O)O', 'C10H16N2O8', 292.24);  // EDTA
  check('CCO', 'C2H6O', 46.07);
  check('CCCCCCCCCCCCOS(=O)(=O)[O-].[Na+]', 'C12H25NaO4S', 288.38);  // SDS
});

test('Ringe, Aromaten, Stereo', () => {
  check('OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', 'C6H12O6', 180.16);  // Glucose
  check('Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2', 194.19);           // Coffein
  check('CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4', 180.16);                   // Acetylsalicylsäure
  check('c1ccccc1', 'C6H6', 78.11);
  check('c1cc[nH]c1', 'C4H5N', 67.09);                                // Pyrrol
  check('C%10CCCCC%10', 'C6H12', 84.16);                              // Ringnummer mit %
});

test('Salze ohne Kohlenstoff: alphabetisch (Hill)', () => {
  check('[Na+].[Cl-]', 'ClNa', 58.44);
  check('[NH4+].[Cl-]', 'ClH4N', 53.49);
  check('O=S(=O)([O-])[O-].[Mg+2]', 'MgO4S', 120.36);  // mit S = 32,06 (IUPAC konventionell); Tabellen mit 32,065 nennen 120,37
  assert.equal(C.formula('[NH4+]').charge, 1);
});

test('Fehler verständlich', () => {
  assert.throws(() => C.formula('C1CC'), /Ring 1 nicht geschlossen/);
  assert.throws(() => C.formula('CC(C'), /Klammer nicht geschlossen/);
  assert.throws(() => C.formula('[Xx]'), /Unbekanntes Element|unlesbar/);
  assert.throws(() => C.formula('CQ'), /nicht erlaubt/);
  assert.throws(() => C.formula(''), /SMILES fehlt/);
  assert.equal(C.hillHTML('C4H11NO3'), 'C<sub>4</sub>H<sub>11</sub>NO<sub>3</sub>');
});
