// Markdown-Export und -Import prüfen: node --test tests/markdown.test.js
const test = require('node:test');
const assert = require('node:assert');
const {toMarkdown, fromMarkdown} = require('../web/markdown.js');

const t = (text, marks) => ({type: 'text', text, ...(marks ? {marks: marks.map(m => typeof m == 'string' ? {type: m} : m)} : {})});
const p = (...c) => ({type: 'paragraph', content: c});
const li = (...c) => ({type: 'listItem', content: c});

test('Export: Überschrift, Absatz mit Auszeichnung, Verweis', () => {
  const md = toMarkdown({type: 'doc', content: [
    {type: 'heading', attrs: {level: 2}, content: [t('Ansatz')]},
    p(t('Mit '), t('Q5', ['bold']), t(' und '), t('Taq', ['italic']), t(' siehe '), {type: 'mention', attrs: {id: '7', label: 'Plasmid pUC19'}}),
  ]}, {entry: id => `007-plasmid.md`});
  assert.equal(md, '## Ansatz\n\nMit **Q5** und *Taq* siehe [Plasmid pUC19](007-plasmid.md)\n');
});

test('Export: Listen, Checkliste, nummeriert, verschachtelt', () => {
  const md = toMarkdown({type: 'doc', content: [
    {type: 'orderedList', attrs: {start: 1}, content: [li(p(t('Mastermix'))), li(p(t('Zyklen')), {type: 'bulletList', content: [li(p(t('98 °C')))]})]},
    {type: 'taskList', content: [{type: 'taskItem', attrs: {checked: true}, content: [p(t('Gel gießen'))]}, {type: 'taskItem', attrs: {checked: false}, content: [p(t('Laden'))]}]},
  ]});
  assert.equal(md, '1. Mastermix\n2. Zyklen\n   - 98 °C\n\n- [x] Gel gießen\n- [ ] Laden\n');
});

test('Export: Tabelle, Bild mit Spurenbelegung, Datei, Rechner, Sonderzeichen', () => {
  const sha = 'a'.repeat(64);
  const md = toMarkdown({type: 'doc', content: [
    {type: 'table', content: [
      {type: 'tableRow', content: [{type: 'tableHeader', content: [p(t('Probe'))]}, {type: 'tableHeader', content: [p(t('ng/µl'))]}]},
      {type: 'tableRow', content: [{type: 'tableCell', content: [p(t('A1'))]}, {type: 'tableCell', content: [p(t('42,7'))]}]}]},
    {type: 'image', attrs: {src: `lab://files/${sha}`, alt: 'gel', notes: {aspect: 1.5, shapes: [{t: 'lanes', xs: [1, 2, 3], labels: ['M', '1', ''], y: 1}]}}},
    {type: 'file', attrs: {sha, name: 'werte.csv', mime: 'text/csv'}},
    {type: 'calc', attrs: {kind: 'dilution', data: {}}},
    p(t('5*3 | a_b')),
  ]}, {file: (s, n) => `files/${s.slice(0, 8)}-${n}`, calc: () => '10 µl Stock'});
  assert.equal(md, '| Probe | ng/µl |\n| --- | --- |\n| A1 | 42,7 |\n\n![gel](files/aaaaaaaa-gel)\n*Spuren: M, 1, 3*\n\n'
    + '📎 [werte.csv](files/aaaaaaaa-werte.csv)\n\n> 🧮 10 µl Stock\n\n5\\*3 \\| a\\_b\n');
});

test('Import: Überschriften, Auszeichnung, Links, Bild, Code', () => {
  const h = fromMarkdown('# Titel\n\nText mit **fett**, *kursiv*, ~~weg~~, `code*x*` und [Link](https://x.de).\n\n![Gel](gel.png)\n\n```bash\nls -la\n```');
  assert.equal(h, '<h1>Titel</h1>\n<p>Text mit <strong>fett</strong>, <em>kursiv</em>, <s>weg</s>, <code>code*x*</code> und <a href="https://x.de">Link</a>.</p>\n'
    + '<p><img alt="Gel" src="gel.png"></p>\n<pre><code class="language-bash">ls -la</code></pre>');
});

test('Import: verschachtelte Listen, Checkliste, Tabelle, Zitat', () => {
  const h = fromMarkdown('1. Eins\n2. Zwei\n   - Unterpunkt\n\n- [x] erledigt\n- [ ] offen\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> Hinweis');
  assert.equal(h, '<ol><li><p>Eins</p></li><li><p>Zwei</p><ul><li><p>Unterpunkt</p></li></ul></li></ol>\n'
    + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>erledigt</p></li><li data-type="taskItem" data-checked="false"><p>offen</p></li></ul>\n'
    + '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>\n<blockquote><p>Hinweis</p></blockquote>');
});

test('Import: HTML im Markdown wird nicht ausgeführt', () => {
  assert.equal(fromMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('Rundweg: Export und wieder Import behält die Struktur', () => {
  const md = toMarkdown({type: 'doc', content: [{type: 'heading', attrs: {level: 1}, content: [t('PCR')]}, p(t('Probe '), t('A1', ['bold']))]});
  assert.equal(fromMarkdown(md), '<h1>PCR</h1>\n<p>Probe <strong>A1</strong></p>');
});
