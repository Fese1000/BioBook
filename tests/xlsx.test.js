// Excel- und CSV-Dateien als Tabelle: node --test tests/  (tabelle.xlsx mit openpyxl 3.1.5 erzeugt)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../web/xlsx.js');

test('Excel: erstes Blatt mit Text, Zahlen (Komma), Wahrheitswerten, Lücken und Sonderzeichen', async () => {
  const r = await X.readXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/tabelle.xlsx')));
  assert.deepEqual(r.sheets, ['NanoDrop', 'Leer']);
  assert.deepEqual(r.rows[0], ['Probe', 'Konz (ng/µl)', 'A260/280', 'geprüft']);
  assert.deepEqual(r.rows[1], ['Klon 1', '250,4', '1,85', 'wahr']);
  assert.deepEqual(r.rows[2], ['Klon 2', '312,9', '1,85', 'falsch']);
  assert.deepEqual(r.rows[3], ['', '', '', '']);
  assert.deepEqual(r.rows[4], ['Notiz & <Hinweis>', '', '0,000125', '']);
  assert.deepEqual((await X.readXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/tabelle.xlsx')), 'Leer')).rows, [['zweites Blatt']]);
  await assert.rejects(() => X.readXlsx(Buffer.from('kein zip')), /Keine Excel-Datei/);
  assert.equal(X.colIndex('AB12'), 27);
});

test('CSV und TSV mit Anführungszeichen', () => {
  assert.deepEqual(X.readDelimited('Probe;Wert\n"Klon; 1";"2,5"\nKlon 2;3\n\n'), [['Probe', 'Wert'], ['Klon; 1', '2,5'], ['Klon 2', '3']]);
  assert.deepEqual(X.readDelimited('a\tb\r\n1\t"zwei ""x"""'), [['a', 'b'], ['1', 'zwei "x"']]);
});
