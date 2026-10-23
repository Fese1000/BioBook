// Editor-Standards: Hoch-/Tiefstellen, Unterstreichen, Textfarbe und Textmarker, Links, Formeln (LaTeX → MathML, auch im PDF),
// Suchen & Ersetzen, Einfügemenü und „/“-Befehle, Excel/CSV als Tabelle, Übersicht der Tastenkürzel.
'use strict';

const katexML = latex => { try { return TT.katex.renderToString(String(latex || ''), {output: 'mathml', throwOnError: false}); } catch { return esc(latex); } };
const mathView = {katexOptions: {output: 'mathml', throwOnError: false}};

/// Formeln: im Editor und im Export als MathML (WebKit zeichnet das selbst, keine Schriftdateien nötig); im Text „$…$“
const MathInline = TT.InlineMath.extend({
  renderHTML({node}) { const el = document.createElement('span'); el.setAttribute('data-type', 'inline-math'); el.setAttribute('data-latex', node.attrs.latex); el.innerHTML = katexML(node.attrs.latex); return el; },
  renderText: ({node}) => `$${node.attrs.latex}$`,
}).configure({...mathView, onClick: (node, pos) => mathDialog({pos, latex: node.attrs.latex})});
const MathBlock = TT.BlockMath.extend({
  renderHTML({node}) { const el = document.createElement('div'); el.setAttribute('data-type', 'block-math'); el.setAttribute('data-latex', node.attrs.latex); el.innerHTML = katexML(node.attrs.latex).replace('<math', '<math display="block"'); return el; },
  renderText: ({node}) => `$$${node.attrs.latex}$$`,
}).configure({...mathView, onClick: (node, pos) => mathDialog({pos, latex: node.attrs.latex, block: true})});

const MARKS = [TT.Subscript, TT.Superscript, TT.TextStyle, TT.Color, TT.Highlight.configure({multicolor: true}), MathInline, MathBlock];

// ---------- Kleine Dialoge ----------
function linkDialog() {
  const prev = editor.getAttributes('link').href || '';
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Link</h3><input id="lkUrl" value="${esc(prev)}" placeholder="https://…" autocomplete="off" spellcheck="false" style="width:100%">
    <p id="lkMsg" class="bad"></p><div class="dlgbtns">${prev ? '<button type="button" class="btn" id="lkDel">Link entfernen</button><span class="grow"></span>' : ''}
    <button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="lkOk">Setzen</button></div></form>`;
  dlg.showModal(); $('#lkUrl').focus();
  if ($('#lkDel')) $('#lkDel').onclick = () => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); dlg.close(); };
  $('#lkOk').onclick = () => {
    let url = $('#lkUrl').value.trim();
    if (/^www\./i.test(url) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) url = 'https://' + url;
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) { $('#lkMsg').textContent = 'Bitte eine Adresse mit https:// (oder mailto:) angeben'; return; }
    const {empty} = editor.state.selection;
    if (empty && !editor.isActive('link')) editor.chain().focus().insertContent({type: 'text', text: url, marks: [{type: 'link', attrs: {href: url}}]}).run();
    else editor.chain().focus().extendMarkRange('link').setLink({href: url}).run();
    dlg.close();
  };
}

const TEXT_COLORS = [['Rot', '#c0392b'], ['Orange', '#d9822b'], ['Grün', '#3a8f5c'], ['Blau', '#2a78d6'], ['Lila', '#8e5bd0'], ['Grau', '#77716a']];
const MARK_COLORS = [['Gelb', '#fff3a3'], ['Grün', '#c9f2d0'], ['Blau', '#cfe3ff'], ['Rosa', '#ffd6e0']];
function colorMenu(btn) {
  popMenu(btn, `<div class="sub">Textfarbe</div><div class="swrow">${TEXT_COLORS.map(([n, c]) => `<button class="swb" data-col="${c}" title="${n}" style="color:${c}">A</button>`).join('')}<button class="swb" data-col="" title="Standard">⌀</button></div>
    <div class="sub">Textmarker</div><div class="swrow">${MARK_COLORS.map(([n, c]) => `<button class="swb" data-hl="${c}" title="${n}" style="background:${c}"></button>`).join('')}<button class="swb" data-hl="" title="Ohne">⌀</button></div>`,
  el => el.addEventListener('mousedown', e => {
    const b = e.target.closest('button'); if (!b) return;
    e.preventDefault();
    if (b.dataset.col != null) b.dataset.col ? editor.chain().focus().setColor(b.dataset.col).run() : editor.chain().focus().unsetColor().run();
    if (b.dataset.hl != null) b.dataset.hl ? editor.chain().focus().setHighlight({color: b.dataset.hl}).run() : editor.chain().focus().unsetHighlight().run();
    el.close();
  }));
}

/// Kleines Menü unter einem Knopf; schließt bei Klick daneben
function popMenu(btn, html, bind) {
  document.querySelector('.suggest.popmenu')?.remove();
  const el = document.createElement('div');
  el.className = 'suggest popmenu'; el.innerHTML = html;
  const r = btn.getBoundingClientRect();
  document.body.appendChild(el);
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`; el.style.top = `${r.bottom + 4}px`;
  const outside = e => { if (!el.contains(e.target)) el.close(); };
  el.close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  bind?.(el);
  return el;
}

function mathDialog({pos, latex = '', block = false} = {}) {
  if (!editor.isEditable) return;
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>${pos != null ? 'Formel bearbeiten' : block ? 'Formel (eigene Zeile)' : 'Formel'}</h3>
    <input id="mxIn" value="${esc(latex)}" placeholder="LaTeX, z. B. c = \\frac{n}{V}" autocomplete="off" spellcheck="false" style="width:100%;font-family:var(--mono)">
    <div id="mxPrev" class="mxprev"></div><p class="sub">Beispiele: <code>x^2</code>, <code>H_2O</code>, <code>\\frac{a}{b}</code>, <code>\\sqrt{x}</code>, <code>\\Delta G = \\Delta H - T\\Delta S</code>. Im Text geht auch <code>$x^2$</code>.</p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="mxOk">${pos != null ? 'Ändern' : 'Einfügen'}</button></div></form>`;
  const prev = () => { $('#mxPrev').innerHTML = katexML($('#mxIn').value); };
  $('#mxIn').oninput = prev; prev();
  dlg.showModal(); $('#mxIn').focus();
  $('#mxOk').onclick = () => {
    const l = $('#mxIn').value.trim(); if (!l) return;
    if (pos != null) editor.chain().focus()[block ? 'updateBlockMath' : 'updateInlineMath']({latex: l, pos}).run();
    else editor.chain().focus()[block ? 'insertBlockMath' : 'insertInlineMath']({latex: l}).run();
    dlg.close();
  };
}

// ---------- Suchen & Ersetzen ----------
const FIND = {q: '', hits: [], i: 0};
const findKey = new TT.PluginKey('findreplace');
const FindReplace = TT.Extension.create({
  name: 'findreplace',
  addKeyboardShortcuts() { return {'Mod-Alt-f': () => { openFindBar(); return true; }}; },
  addProseMirrorPlugins() {
    return [new TT.Plugin({key: findKey,
      state: {init: () => TT.DecorationSet.empty, apply: (tr, old) => { const m = tr.getMeta(findKey); return m ? m : tr.docChanged ? old.map(tr.mapping, tr.doc) : old; }},
      props: {decorations: s => findKey.getState(s)}})];
  },
});

function findHits(doc, q) {
  const out = [], t = q.toLowerCase();
  if (!t) return out;
  doc.descendants((n, pos) => {
    if (!n.isText) return;
    const s = n.text.toLowerCase();
    for (let i = s.indexOf(t); i >= 0; i = s.indexOf(t, i + t.length)) out.push({from: pos + i, to: pos + i + t.length});
  });
  return out;
}

function findRefresh(scroll) {
  FIND.hits = findHits(editor.state.doc, FIND.q);
  if (FIND.i >= FIND.hits.length) FIND.i = 0;
  const decos = FIND.hits.map((h, k) => TT.Decoration.inline(h.from, h.to, {class: k == FIND.i ? 'findhit cur' : 'findhit'}));
  editor.view.dispatch(editor.state.tr.setMeta(findKey, TT.DecorationSet.create(editor.state.doc, decos)));
  $('#fbCount').textContent = FIND.q ? `${FIND.hits.length ? FIND.i + 1 : 0} von ${FIND.hits.length}` : '';
  if (scroll && FIND.hits[FIND.i]) {
    const el = editor.view.domAtPos(FIND.hits[FIND.i].from).node;
    (el.nodeType == 3 ? el.parentElement : el)?.scrollIntoView({block: 'center'});
  }
}

function openFindBar() {
  const bar = $('#findbar');
  bar.hidden = false;
  if (!bar.innerHTML) {
    bar.innerHTML = `<input id="fbQ" placeholder="Im Eintrag suchen" autocomplete="off" spellcheck="false"><span id="fbCount" class="sub"></span>
      <button class="btn" data-fb="prev" title="Vorheriger (⇧↩)">↑</button><button class="btn" data-fb="next" title="Nächster (↩)">↓</button>
      <input id="fbR" placeholder="Ersetzen durch" autocomplete="off" spellcheck="false"><button class="btn" data-fb="one">Ersetzen</button><button class="btn" data-fb="all">Alle</button>
      <button class="x" data-fb="close" title="Schließen (esc)">×</button>`;
    $('#fbQ').oninput = e => { FIND.q = e.target.value; FIND.i = 0; findRefresh(true); };
    bar.addEventListener('keydown', e => {
      if (e.key == 'Escape') { e.preventDefault(); closeFindBar(); }
      if (e.key == 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    });
    bar.addEventListener('click', e => { const a = e.target.dataset.fb; if (!a) return;
      if (a == 'close') closeFindBar(); else if (a == 'next') findStep(1); else if (a == 'prev') findStep(-1); else if (a == 'one') replaceOne(); else if (a == 'all') replaceAll(); });
  }
  const {from, to} = editor.state.selection;
  if (to > from && to - from < 60) { $('#fbQ').value = FIND.q = editor.state.doc.textBetween(from, to); FIND.i = 0; }
  $('#fbR').disabled = !editor.isEditable;
  $('#fbQ').focus(); $('#fbQ').select();
  findRefresh(false);
}
function closeFindBar() { $('#findbar').hidden = true; FIND.q = ''; findRefresh(false); editor.commands.focus(); }
function findStep(d) { if (!FIND.hits.length) return; FIND.i = (FIND.i + d + FIND.hits.length) % FIND.hits.length; findRefresh(true); }
function replaceOne() {
  const h = FIND.hits[FIND.i]; if (!h || !editor.isEditable) return;
  const r = $('#fbR').value;
  editor.view.dispatch(r ? editor.state.tr.insertText(r, h.from, h.to) : editor.state.tr.delete(h.from, h.to));
  findRefresh(true);
}
function replaceAll() {
  if (!FIND.hits.length || !editor.isEditable) return 0;
  const r = $('#fbR').value, n = FIND.hits.length, tr = editor.state.tr;
  for (const h of [...FIND.hits].reverse()) r ? tr.insertText(r, h.from, h.to) : tr.delete(h.from, h.to);  // von hinten, damit Positionen stimmen
  editor.view.dispatch(tr);
  findRefresh(false);
  status(`${n} ersetzt`);
  return n;
}

// ---------- Einfügen: Menü und „/“-Befehle ----------
function insertItems() {
  const ed = () => editor.chain().focus();
  const items = [
    {icon: '📎', label: 'Datei oder Bild', run: () => $('#filepick').click()},
    {icon: '📋', label: 'Tabelle aus Excel/CSV', sub: '.xlsx, .csv, .tsv', run: () => tableFromFile()},
    {icon: '∑', label: 'Formel', sub: 'LaTeX, im Text', run: () => mathDialog()},
    {icon: '∑', label: 'Formel (eigene Zeile)', sub: 'LaTeX', run: () => mathDialog({block: true})},
    {icon: '↗', label: 'Verweis auf Eintrag', sub: '[[', run: () => ed().insertContent('[[').run()},
    {icon: '📚', label: 'Quelle zitieren', sub: 'DOI, PMID, Bibliothek', run: () => citeDialog()},
    {icon: '🔗', label: 'Rohdaten verlinken', sub: 'große Dateien bleiben am Ort', run: () => linkRawFiles()},
    ...Object.entries(CALC_KINDS).map(([k, c]) => ({icon: '🧮', label: c.title, sub: 'Rechner', run: () => insertCalc(k)})),
    {icon: '📈', label: 'Diagramm', sub: 'Standardkurve, t-Test, x/y', run: () => insertChart()},
    {icon: '📊', label: 'Ergebnistabelle', sub: 'nach Vorlage, für die Auswertung', run: () => insertResults()},
    {icon: '🧫', label: 'Plattenlayout 96', run: () => insertPlate(96)},
    {icon: '🧫', label: 'Plattenlayout 384', run: () => insertPlate(384)},
    {icon: '📦', label: 'Verbrauch einer Charge', run: () => insertUsage()},
    {icon: '🧬', label: 'Sequenzkarte', run: () => insertSequenceBlock()},
    {icon: '↻', label: 'Passage (Zellkultur)', run: () => insertCultureBlock()},
    {icon: '⚗️', label: 'Strukturformel', sub: 'SMILES', run: () => insertChem()},
    {icon: '⌗', label: 'Code', run: () => ed().toggleCodeBlock().run()},
    {icon: '❝', label: 'Zitat (Absatz)', run: () => ed().toggleBlockquote().run()},
    {icon: '—', label: 'Trennlinie', run: () => ed().setHorizontalRule().run()},
    ...(typeof extBlocks == 'function' ? extBlocks() : []).map(b => ({icon: b.icon, label: b.title, sub: `Erweiterung ${b.extName}`, run: () => insertExtBlock(b.ext, b.id)})),
    ...(typeof AI_ON != 'undefined' && AI_ON ? [{icon: '✨', label: 'Zusammenfassen', sub: 'Claude', run: () => aiSummary()}, {icon: '✨', label: 'Protokoll aus Stichpunkten', sub: 'Claude', run: () => aiProtocol()}] : []),
  ];
  return items.map((it, i) => ({...it, id: String(i)}));
}

function insertMenu(btn) {
  const items = insertItems();
  popMenu(btn, `<input class="imq" placeholder="Filtern …" autocomplete="off">${items.map(it => `<div class="opt" data-ii="${it.id}">${it.icon} ${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>`).join('')}
    <div class="opt" data-ikeys>⌘? Tastenkürzel</div>`, el => {
    const q = el.querySelector('.imq');
    q.oninput = () => el.querySelectorAll('[data-ii]').forEach(o => o.hidden = !o.textContent.toLowerCase().includes(q.value.toLowerCase()));
    q.onkeydown = e => { if (e.key == 'Enter') { const o = [...el.querySelectorAll('[data-ii]')].find(x => !x.hidden); if (o) { e.preventDefault(); el.close(); items[+o.dataset.ii].run(); } } if (e.key == 'Escape') el.close(); };
    el.addEventListener('mousedown', e => {
      const o = e.target.closest('[data-ii],[data-ikeys]'); if (!o) return;
      e.preventDefault(); el.close();
      if (o.dataset.ikeys !== undefined) return shortcutsDialog();
      items[+o.dataset.ii].run();
    });
    setTimeout(() => q.focus());
  });
}

/// „/“ am Wortanfang: dieselben Einträge wie das Einfügemenü, als Vorschlagsliste unter der Schreibmarke
const SlashCommands = TT.Mention.extend({name: 'slashcmd'}).configure({
  suggestion: {
    char: '/', startOfLine: false, allowSpaces: false, render: () => suggestionRender(),  // suggestionRender steht in app.js (lädt später)
    items: ({query}) => insertItems().filter(it => `${it.label} ${it.sub || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
      .map(it => ({...it, label: `${it.icon} ${it.label}`})),
    command: ({editor: ed, range, props}) => { ed.chain().focus().deleteRange(range).run(); props.run(); },
  },
});

// ---------- Tabelle aus Datei ----------
function rowsToTable(rows) {
  const cell = (t, head) => ({type: head ? 'tableHeader' : 'tableCell', content: [{type: 'paragraph', content: t ? [{type: 'text', text: String(t)}] : []}]});
  return {type: 'table', content: rows.map((r, i) => ({type: 'tableRow', content: r.map(c => cell(c, i == 0))}))};
}

async function insertTableFromBuffer(buf, name) {
  let rows, note = '';
  if (/\.xlsx$/i.test(name)) {
    const r = await XLSX.readXlsx(buf);
    rows = r.rows; if (r.sheets.length > 1) note = ` (Blatt „${r.sheets[0]}“ von ${r.sheets.length})`;
  } else rows = XLSX.readDelimited(new TextDecoder().decode(buf));
  rows = rows.filter(r => r.some(c => String(c).trim()));
  if (!rows.length) throw new Error('Die Datei enthält keine Werte');
  if (rows.length > 500 || rows[0].length > 40) throw new Error(`Zu groß für eine Tabelle im Eintrag (${rows.length} × ${rows[0].length}); bitte als Datei anhängen`);
  editor.chain().focus().insertContent([rowsToTable(rows), {type: 'paragraph'}]).run();
  status(`${rows.length} Zeilen aus ${name}${note} eingefügt`);
  return rows;
}

function tableFromFile() {
  let p = document.getElementById('tablepick');
  if (!p) {
    p = Object.assign(document.createElement('input'), {type: 'file', id: 'tablepick', hidden: true, accept: '.xlsx,.csv,.tsv,.txt'});
    p.onchange = async () => { const f = p.files[0]; if (!f) return; try { await insertTableFromBuffer(await f.arrayBuffer(), f.name); } catch (e) { alert(`${f.name}: ${e.message}`); } p.value = ''; };
    document.body.appendChild(p);
  }
  p.click();
}

// ---------- Tastenkürzel ----------
const SHORTCUTS = [
  ['Eintrag', [['⌘N', 'Neuer Eintrag'], ['⌘S', 'Revision sichern'], ['⌘P', 'Als PDF'], ['⇧⌘D', 'Tagesabschnitt „Heute“'], ['⌘F', 'Suche in der Liste'], ['⌥⌘F', 'Suchen & Ersetzen im Eintrag'], ['⌘T / ⌥⌘N', 'Neuer Tab / neues Fenster'], ['⌘L', 'Sperren'], ['⇧⌘E', 'Laborbuch exportieren']]],
  ['Text', [['⌘B', 'Fett'], ['⌘I', 'Kursiv'], ['⌘U', 'Unterstrichen'], ['⇧⌘S', 'Durchgestrichen'], ['⌘.', 'Hochgestellt'], ['⌘,', 'Tiefgestellt'], ['⇧⌘H', 'Textmarker'], ['⌘K', 'Link'], ['⌘Z / ⇧⌘Z', 'Widerrufen / Wiederholen']]],
  ['Tippen', [['/', 'Einfügen-Befehle (Tabelle, Rechner, Formel …)'], ['[[', 'Verweis auf einen Eintrag'], ['@', 'Registry-Objekt'], ['$x^2$', 'Formel im Text'], ['# + Leerzeichen', 'Überschrift'], ['- / 1. / [ ]', 'Liste / nummeriert / Checkliste']]],
];
function shortcutsDialog() {
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Tastenkürzel</h3>${SHORTCUTS.map(([g, rows]) => `<h4>${g}</h4><table class="kbd">${rows.map(([k, t]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(t)}</td></tr>`).join('')}</table>`).join('')}
    <div class="dlgbtns"><button value="ok" class="btn on">Schließen</button></div></form>`;
  dlg.showModal();
}

/// Tastenkürzel, die nicht von den Erweiterungen selbst kommen
const ExtraKeys = TT.Extension.create({
  name: 'extrakeys',
  addKeyboardShortcuts() { return {'Mod-k': () => { linkDialog(); return true; }, 'Mod-Shift-h': () => this.editor.chain().focus().toggleHighlight({color: MARK_COLORS[0][1]}).run()}; },
});
