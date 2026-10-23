// Prompt-Bausteine des KI-Assistenten: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const AI = require('../web/assistant.js');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

test('Zusammenfassung: Titel und Text, nichts erfinden', () => {
  const p = AI.summaryPrompt({title: 'PCR', text: 'Taq 2 µl'});
  assert.equal(p.user, 'Titel: PCR\n\nTaq 2 µl'); assert.match(p.system, /Erfinde nichts/); assert.equal(p.cut, false);
});

test('Frage: höchstens 8 Quellen, lange gekürzt und markiert, Kennungen E…', () => {
  const src = Array.from({length: 10}, (_, i) => ({id: i + 1, title: `Eintrag "${i}"`, text: i == 0 ? 'x'.repeat(7000) : 'kurz'}));
  const p = AI.qaPrompt('Wie war die Ausbeute?', src);
  assert.equal(p.used.length, 8); assert.equal(p.used[0].cut, true);
  assert.equal((p.user.match(/<eintrag id="E/g) || []).length, 8);
  assert.ok(p.user.includes('[… gekürzt]') && p.user.endsWith('Frage: Wie war die Ausbeute?') && p.user.includes("titel=\"Eintrag '0'\""));
});

test('Quellenangaben werden nur für mitgeschickte Einträge Links', () => {
  const h = AI.linkCitations('<p>12,5 µg [E3], siehe [E7]</p>', [3, 4]);
  assert.ok(h.includes('data-entry="3"') && h.includes('[E7]') && !h.includes('data-entry="7"'));
});

test('Antwort als HTML ist maskiert; Listen und Fettdruck', () => {
  const h = AI.mdToHTML('**Ergebnis**\n- <img src=x onerror=alert(1)>\n- zwei\n1. eins', esc);
  assert.ok(!h.includes('<img') && h.includes('&lt;img'));
  assert.ok(h.startsWith('<p><b>Ergebnis</b></p><ul><li>') && h.includes('</ul><ol><li>eins</li></ol>'));
  const doc = AI.mdToDoc('## Ziel\nPlasmid\n1. lysieren\n2. fällen');
  assert.deepEqual(doc.map(n => n.type), ['heading', 'paragraph', 'orderedList']); assert.equal(doc[2].content.length, 2);
});
