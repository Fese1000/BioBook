// Laborbuch – Oberfläche und Logik. Daten gehen nur über die Brücke an Swift (window.webkit.messageHandlers.lab).
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const call = (cmd, args = {}) => window.webkit.messageHandlers.lab.postMessage({cmd, args});
const when = iso => new Date(iso).toLocaleString('de-DE', {dateStyle: 'medium', timeStyle: 'short'});

const SNAPSHOT_MS = 5 * 60 * 1000;  // spätestens alle 5 Minuten eine unveränderliche Revision
const KINDS = {experiment: 'Experiment', note: 'Notiz', protocol: 'Protokoll'};
let editor = null, cur = null, saveTimer = null, dirty = false, changedSinceSnap = false, lastSnap = 0;
let projects = [], project = null;  // project: null = alle, 0 = ohne Projekt, sonst ID
let tags = [], tag = null;          // tag: gewählter Tag-Filter (ID) oder null
let preview = null;                 // angezeigte alte Revision (nur lesen) oder null
let curTrashed = null;              // Zeitpunkt, seit dem der offene Eintrag im Papierkorb liegt
let curSigned = null;               // Revisionsnummer, mit der der offene Eintrag abgeschlossen wurde

// ---------- Editor ----------
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const PREVIEW = {pdf: /^application\/pdf$/, table: /^text\/(csv|tab-separated-values)$/, text: /^(text\/|application\/json$)/};
const fileIcon = m => /pdf/.test(m) ? '📄' : /csv|spreadsheet|excel|tab-separated/.test(m) ? '📊' : /zip|compressed/.test(m) ? '🗜' : /text|json/.test(m) ? '📝' : '📎';

// Datei-Anhang als eigener Block: Karte mit Öffnen und Vorschau (PDF, CSV/TSV, Text)
const FileNode = TT.Node.create({
  name: 'file', group: 'block', atom: true, draggable: true,
  addAttributes() {
    const a = k => ({default: null, parseHTML: el => el.getAttribute('data-' + k), renderHTML: v => ({['data-' + k]: v[k]})});
    return {sha: a('sha'), name: a('name'), mime: a('mime'), size: {...a('size'), parseHTML: el => +el.getAttribute('data-size')},
      link: {default: false, parseHTML: el => el.getAttribute('data-link') == '1', renderHTML: v => v.link ? {'data-link': '1'} : {}}, path: a('path')};
  },
  parseHTML: () => [{tag: 'div[data-file]'}],
  renderHTML: ({node, HTMLAttributes}) => ['div', TT.mergeAttributes({'data-file': ''}, HTMLAttributes),
    `${node.attrs.link ? '🔗 verlinkt' : '📎'} ${node.attrs.name} (${fmtSize(node.attrs.size || 0)})${node.attrs.link ? ` · ${node.attrs.path} · SHA-256 ${node.attrs.sha}` : ''}`],
  addNodeView: () => ({node}) => {
    const {sha, name, mime, size, link, path} = node.attrs;
    // Vorschau für verlinkte Rohdaten nur bei kleinen Dateien (die App lädt sie dafür ganz)
    const kind = link && size > 20 * 1048576 ? null : Object.keys(PREVIEW).find(k => PREVIEW[k].test(mime || ''));
    const dom = document.createElement('div');
    dom.className = 'filecard' + (link ? ' linked' : ''); dom.contentEditable = 'false'; dom.dataset.sha = sha;
    dom.innerHTML = `<div class="fhead"><span class="ficon">${link ? '🔗' : fileIcon(mime || '')}</span>
      <span class="fname" title="${esc(link ? path : name)}">${esc(name)}${link ? `<small>${esc(path)}</small>` : ''}</span>
      ${link ? `<span class="lstat" title="SHA-256 ${sha}">${LINK_STATUS[sha] ? linkBadge(LINK_STATUS[sha]) : 'verlinkt'}</span>` : ''}
      <span class="fsize">${fmtSize(size || 0)}</span>${kind ? '<button class="btn" data-fprev>Vorschau</button>' : ''}<button class="btn" data-fopen>Öffnen</button></div><div class="fprev" hidden></div>`;
    dom.addEventListener('click', async e => {
      if (e.target.dataset.fopen !== undefined) return call('openFile', {sha256: sha, name}).catch(err => alert(err.message));
      if (e.target.dataset.fprev === undefined) return;
      const box = dom.querySelector('.fprev');
      box.hidden = !box.hidden;
      e.target.textContent = box.hidden ? 'Vorschau' : 'Vorschau schließen';
      if (box.hidden || box.dataset.done) return;
      box.dataset.done = '1';
      const url = `/files/${sha}`;  // gleicher Ursprung wie die Oberfläche, sonst blockiert WebKit fetch
      if (kind == 'pdf') { box.innerHTML = `<iframe src="${url}" title="${esc(name)}"></iframe>`; return; }
      const text = await (await fetch(url)).text();
      if (kind == 'table') {
        const sep = /tab-separated/.test(mime) ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
        const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 31).map(l => l.split(sep));
        box.innerHTML = `<table>${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>`
          + (text.split(/\r?\n/).filter(Boolean).length > 31 ? '<p class="sub">Nur die ersten 30 Zeilen.</p>' : '');
      } else box.innerHTML = `<pre>${esc(text.slice(0, 20000))}${text.length > 20000 ? '\n…' : ''}</pre>`;
    });
    return {dom};
  },
});

// Status verlinkter Rohdaten (vom Swift-Teil geprüft): ok | changed | missing
const LINK_STATUS = {};
const linkBadge = st => st == 'ok' ? '✓ unverändert' : st == 'changed' ? '⚠ verändert seit dem Verlinken' : '⚠ Datei fehlt';

async function checkLinks() {
  const shas = [];
  editor.state.doc.descendants(n => { if (n.type.name == 'file' && n.attrs.link) shas.push(n.attrs.sha); });
  if (!shas.length) return;
  const res = await call('checkLinks', {shas});
  for (const [sha, r] of Object.entries(res)) {
    LINK_STATUS[sha] = r.status;
    document.querySelectorAll(`.filecard[data-sha="${sha}"] .lstat`).forEach(el => { el.textContent = linkBadge(r.status); el.className = `lstat ${r.status}`; });
  }
  const bad = Object.values(res).filter(r => r.status != 'ok').length;
  if (bad) status(`${bad} verlinkte Rohdatei(en) verändert oder nicht gefunden`);
}

async function linkRawFiles(testPaths) {
  if (!cur || preview || curSigned) return;
  status('Prüfsumme wird berechnet …');
  try {
    const list = await call('linkFiles', testPaths ? {testPaths} : {});
    for (const a of list) {
      LINK_STATUS[a.sha256] = 'ok';
      editor.chain().focus().insertContent({type: 'file', attrs: {sha: a.sha256, name: a.name, mime: a.mime, size: a.size, link: true, path: a.path}}).run();
    }
    status(list.length ? `${list.length} Rohdatei(en) verlinkt` : '');
    return list;
  } catch (e) { status(''); alert('Verlinken fehlgeschlagen: ' + e.message); }
}

/// Vorschlagsliste unter der Schreibmarke (für [[ und @)
function suggestionRender() {
  let el, sel = 0, items = [], cmd;
  const draw = () => {
    el.innerHTML = items.length ? items.map((it, i) => `<div class="opt ${i == sel ? 'on' : ''}" data-i="${i}">${esc(it.label)}<small>${esc(it.sub || '')}</small></div>`).join('')
      : '<div class="none">Nichts gefunden</div>';
  };
  // an der Schreibmarke, aber nie über den Fensterrand hinaus
  const place = rect => { const r = rect?.(); if (!r) return;
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${r.bottom + 4 + el.offsetHeight > innerHeight ? r.top - el.offsetHeight - 4 : r.bottom + 4}px`; };
  const take = p => { items = p.items; cmd = p.command; sel = 0; draw(); place(p.clientRect); };
  return {
    onStart: p => {
      el = document.createElement('div'); el.className = 'suggest'; document.body.appendChild(el);
      el.addEventListener('mousedown', e => { const o = e.target.closest('[data-i]'); if (o) { e.preventDefault(); cmd(items[+o.dataset.i]); } });
      take(p);
    },
    onUpdate: take,
    onKeyDown: ({event: e}) => {
      if (e.key == 'ArrowDown' || e.key == 'ArrowUp') { sel = (sel + (e.key == 'ArrowDown' ? 1 : items.length - 1)) % Math.max(items.length, 1); draw(); return true; }
      if ((e.key == 'Enter' || e.key == 'Tab') && items[sel]) { cmd(items[sel]); return true; }
      return false;
    },
    onExit: () => el?.remove(),
  };
}

// Verweise: „[[“ auf einen Eintrag, „@“ auf ein Registry-Objekt (ID „ent:<nummer>“)
const isEnt = n => String(n.attrs.id).startsWith('ent:');
const EntryLink = TT.Mention.configure({
  renderText: ({node}) => isEnt(node) ? `@${node.attrs.label}` : `[[${node.attrs.label}]]`,
  renderHTML: ({node}) => isEnt(node)
    ? ['a', {class: 'eref', href: '#', 'data-ent': String(node.attrs.id).slice(4), title: 'Objekt öffnen'}, node.attrs.label]
    : ['a', {class: 'elink', href: '#', 'data-entry': node.attrs.id, title: 'Eintrag öffnen'}, `↗ ${node.attrs.label}`],
  suggestions: [
    {char: '[[', allowSpaces: true, render: suggestionRender,
      items: async ({query}) => (query ? await call('search', {q: query}) : await call('list')).filter(r => r.id != cur).slice(0, 8)
        .map(r => ({id: String(r.id), label: r.title || 'Ohne Titel', sub: KINDS[r.kind] || ''}))},
    {char: '@', render: suggestionRender,
      items: async ({query}) => (await call('entities', {q: query})).slice(0, 8).map(e => ({id: `ent:${e.id}`, label: `${e.code} ${e.name}`, sub: e.type_name}))},
  ],
});

/// Erweiterungen des Editors; ohne Oberfläche (forUI = false) auch für Export und Import
function editorExtensions(forUI = true) {
  return [
    TT.StarterKit.configure({link: {openOnClick: false}}),
    AnnotImage,
    TT.TableKit.configure({table: {resizable: forUI}}),
    TT.TaskList, TT.TaskItem.configure({nested: true}),
    ...(forUI ? [TT.Placeholder.configure({placeholder: 'Schreib los … Dateien per Drag & Drop, [[ verweist auf einen anderen Eintrag.'})] : []),
    TT.CharacterCount,
    FileNode, EntryLink, CalcNode, UsageNode, PlateNode, ResultsNode, CultureNode, SequenceNode, ChartNode, CiteNode, ChemNode, ExtNode, DayNode, DbLinks, DueDates,
    ...MARKS, ...(forUI ? [FindReplace, SlashCommands, ExtraKeys] : []),
  ];
}

function makeEditor() {
  editor = new TT.Editor({
    element: $('#editor'),
    extensions: editorExtensions(),
    onUpdate: changed,
    onSelectionUpdate: renderToolbar,
    onTransaction: renderToolbar,
    editorProps: {
      handlePaste: (view, e) => insertFiles([...(e.clipboardData?.files || [])]),
      handleDrop: (view, e) => {
        const files = [...(e.dataTransfer?.files || [])];
        const pos = view.posAtCoords({left: e.clientX, top: e.clientY})?.pos;
        return insertFiles(files, pos);
      },
    },
  });
}

/// Verweise und Dateien im Dokument einsammeln (für Rückverweise und Dateiliste im Speicher)
function collectRefs(doc) {
  const links = new Set(), files = new Set(), entities = new Set();
  const walk = n => {
    if (n.type == 'mention' && n.attrs?.id) (String(n.attrs.id).startsWith('ent:') ? entities : links).add(+String(n.attrs.id).replace('ent:', ''));
    if (n.type == 'file' && n.attrs?.sha) files.add(n.attrs.sha);
    if (n.type == 'seqref' && n.attrs?.entity) entities.add(+n.attrs.entity);
    if (n.type == 'image') { const m = /^lab:\/\/files\/([0-9a-f]{64})$/.exec(n.attrs?.src || ''); if (m) files.add(m[1]); }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return {links: [...links], files: [...files], entities: [...entities], results: collectResults(doc), tasks: collectTasks(doc), days: Days.daysOf(doc)};
}

/// Verweis-Beschriftungen auf die aktuellen Titel bringen (Titel können sich geändert haben)
async function refreshLinkLabels(doc) {
  const titles = new Map((await call('titles')).map(t => [String(t.id), t.title || 'Ohne Titel']));
  let ents = null;
  const hasEnt = JSON.stringify(doc).includes('"ent:');
  if (hasEnt) ents = new Map((await call('entities', {})).map(e => [`ent:${e.id}`, `${e.code} ${e.name}`]));
  const walk = n => {
    if (n.type == 'mention' && n.attrs) n.attrs.label = (String(n.attrs.id).startsWith('ent:') ? ents?.get(String(n.attrs.id)) : titles.get(String(n.attrs.id))) ?? `${n.attrs.label} (gelöscht)`;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return doc;
}

const TOOLS = [
  ['B', 'Fett (⌘B)', e => e.chain().focus().toggleBold().run(), e => e.isActive('bold')],
  ['I', 'Kursiv (⌘I)', e => e.chain().focus().toggleItalic().run(), e => e.isActive('italic')],
  ['U', 'Unterstrichen (⌘U)', e => e.chain().focus().toggleUnderline().run(), e => e.isActive('underline')],
  ['S', 'Durchgestrichen (⇧⌘S)', e => e.chain().focus().toggleStrike().run(), e => e.isActive('strike')],
  ['X²', 'Hochgestellt (⌘.)', e => e.chain().focus().toggleSuperscript().run(), e => e.isActive('superscript')],
  ['X₂', 'Tiefgestellt (⌘,)', e => e.chain().focus().toggleSubscript().run(), e => e.isActive('subscript')],
  ['🎨', 'Textfarbe und Textmarker', (e, btn) => colorMenu(btn)],
  ['🔗', 'Link (⌘K)', () => linkDialog(), e => e.isActive('link')],
  ['|'],
  ['📅 Heute', 'Tagesabschnitt für heute anlegen oder hinspringen (⇧⌘D)', () => addToday()],
  ['|'],
  ['H1', 'Überschrift 1', e => e.chain().focus().toggleHeading({level: 1}).run(), e => e.isActive('heading', {level: 1})],
  ['H2', 'Überschrift 2', e => e.chain().focus().toggleHeading({level: 2}).run(), e => e.isActive('heading', {level: 2})],
  ['H3', 'Überschrift 3', e => e.chain().focus().toggleHeading({level: 3}).run(), e => e.isActive('heading', {level: 3})],
  ['|'],
  ['•', 'Aufzählung', e => e.chain().focus().toggleBulletList().run(), e => e.isActive('bulletList')],
  ['1.', 'Nummerierte Liste', e => e.chain().focus().toggleOrderedList().run(), e => e.isActive('orderedList')],
  ['☑', 'Checkliste', e => e.chain().focus().toggleTaskList().run(), e => e.isActive('taskList')],
  ['⊞', 'Tabelle 3 × 3 einfügen', e => e.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()],
  ['+ Zeile', 'Zeile darunter', e => e.chain().focus().addRowAfter().run(), null, e => e.isActive('table')],
  ['+ Spalte', 'Spalte rechts', e => e.chain().focus().addColumnAfter().run(), null, e => e.isActive('table')],
  ['⧉ Verbinden', 'Markierte Zellen verbinden oder wieder teilen', e => e.chain().focus().mergeOrSplit().run(), null, e => e.isActive('table')],
  ['− Tabelle', 'Tabelle löschen', e => e.chain().focus().deleteTable().run(), null, e => e.isActive('table')],
  ['✎ Beschriften', 'Ausgewähltes Bild beschriften (oder Doppelklick aufs Bild)', () => annotateSelected(), null, e => e.isActive('image')],
  ['|'],
  ['＋ Einfügen', 'Datei, Formel, Rechner, Diagramm, Platte, Sequenz … – oder „/“ im Text tippen', (e, btn) => insertMenu(btn)],
  ['🔍', 'Suchen und Ersetzen im Eintrag (⌥⌘F)', () => openFindBar()],
  ['|'],
  ['↶', 'Widerrufen (⌘Z)', e => e.chain().focus().undo().run()],
  ['↷', 'Wiederholen (⇧⌘Z)', e => e.chain().focus().redo().run()],
  ['⌘?', 'Tastenkürzel', () => shortcutsDialog()],
];

function renderToolbar() {
  if (!editor) return;
  $('#toolbar').innerHTML = TOOLS.map(([l, title, , active, show], i) => l == '|' ? '<span class="sep"></span>'
    : show && !show(editor) ? '' : `<button data-tool="${i}" title="${esc(title)}" class="${active && active(editor) ? 'on' : ''}">${esc(l)}</button>`).join('');
}

// ---------- Bilder und Dateien ----------
const MAX_FILE = 50 * 1048576;  // größere Rohdaten werden ab M5 verlinkt statt kopiert

function insertFiles(files, pos) {
  if (!files.length || preview) return false;  // keine Datei: Editor macht das Übliche
  (async () => {
    for (const f of files) {
      if (f.size > MAX_FILE) { alert(`„${f.name}“ ist größer als 50 MB und wurde nicht übernommen.\n\nGroße Rohdaten bitte mit „🔗 Rohdaten“ verlinken: Sie bleiben am Ort, das Laborbuch merkt sich die Prüfsumme und meldet Änderungen.`); continue; }
      status(`Speichert „${f.name}“ …`);
      const sha = await upload(f);
      const node = f.type.startsWith('image/') ? {type: 'image', attrs: {src: `lab://files/${sha}`, alt: f.name}}
        : {type: 'file', attrs: {sha, name: f.name, mime: f.type || 'application/octet-stream', size: f.size}};
      if (pos != null) { editor.chain().focus().insertContentAt(pos, node).run(); pos += 1; }
      else editor.chain().focus().insertContent(node).run();
    }
  })().catch(e => alert('Datei konnte nicht gespeichert werden: ' + e.message));
  return true;
}

async function upload(blob, name = blob.name || 'bild.png') {
  const b64 = await new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result.split(',', 2)[1]); r.onerror = bad;
    r.readAsDataURL(blob);
  });
  return (await call('putFile', {name, mime: blob.type || 'application/octet-stream', base64: b64})).sha256;
}

// ---------- Projekte ----------
const projectName = id => id == 0 ? 'Ohne Projekt' : projects.find(p => p.id == id)?.name ?? '';

async function loadProjects() {
  projects = await call('projects');
  const li = (p, label, extra = '', cls = '') => `<li data-p="${p}" class="${String(project) == String(p) ? 'cur ' : ''}${cls}"><span class="n">${esc(label)}</span>${extra}</li>`;
  const nTrash = (await call('trash')).length;
  $('#projects').innerHTML = li('', 'Alle Einträge') + li(0, 'Ohne Projekt')
    + (nTrash || project == 'trash' ? li('trash', '🗑 Papierkorb', `<span class="c">${nTrash}</span>`) : '')
    + projects.map(p => li(p.id, p.name, `<span class="c">${p.entries}</span><button class="ed" data-rename="${p.id}" title="Umbenennen">✎</button>`
      + `<button class="ed" data-archive="${p.id}" title="${p.archived ? 'Wiederherstellen' : 'Archivieren'}">${p.archived ? '↺' : '🗄'}</button>`, p.archived ? 'arch' : '')).join('');
  $('#listTitle').textContent = project == null ? 'Einträge' : project == 'trash' ? 'Papierkorb' : projectName(project);
  fillMetaProject();
}

function fillMetaProject(sel = $('#metaProject').value) {
  const opts = [['0', '— ohne —'], ...projects.filter(p => !p.archived || String(p.id) == sel).map(p => [String(p.id), p.name])];
  $('#metaProject').innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('#metaProject').value = sel || '0';
}

async function selectProject(p) {
  project = p === '' ? null : p == 'trash' ? 'trash' : +p;
  document.querySelectorAll('#projects li').forEach(li => li.classList.toggle('cur', li.dataset.p == p));  // sofort, die Zahlen folgen
  await loadProjects();
  await refreshList();
}

async function newProject() {
  const name = prompt('Name des neuen Projekts');
  if (!name?.trim()) return;
  try { await selectProject(await call('createProject', {name})); } catch (e) { alert(e.message); }
}

async function renameProject(id) {
  const p = projects.find(x => x.id == id);
  const name = prompt('Neuer Name', p.name);
  if (!name?.trim() || name == p.name) return;
  try { await call('updateProject', {id, name}); await loadProjects(); } catch (e) { alert(e.message); }
}

async function archiveProject(id) {
  const p = projects.find(x => x.id == id);
  if (!p.archived && !confirm(`Projekt „${p.name}“ archivieren? Die Einträge bleiben erhalten und sind weiter über „Alle Einträge“ und die Suche erreichbar.`)) return;
  await call('updateProject', {id, archived: !p.archived});
  await loadProjects();
}

// ---------- Tags ----------
async function loadTags() {
  tags = await call('tags');
  if (tag != null && !tags.some(t => t.id == tag)) tag = null;  // Tag gibt es nicht mehr
  $('#tagsec').hidden = !tags.length;
  $('#tags').innerHTML = tags.map(t => `<button class="tagchip ${t.id == tag ? 'on' : ''}" data-tag="${t.id}">#${esc(t.name)} <small>${t.entries}</small></button>`).join('');
  $('#tagnames').innerHTML = tags.map(t => `<option value="${esc(t.name)}">`).join('');
}

function renderEntryTags(list) {
  $('#etags').innerHTML = list.map(n => `<span class="tagchip">#${esc(n)} <button data-untag="${esc(n)}" title="Tag entfernen">×</button></span>`).join('');
  $('#etags').dataset.names = JSON.stringify(list);
}

async function saveEntryTags(names) {
  try { renderEntryTags(await call('setTags', {id: cur, names})); } catch (e) { return alert(e.message); }
  await loadTags();
  await refreshList();
}

function addTagFromInput() {
  const inp = $('#tagInput'), names = inp.value.split(',').map(s => s.trim().replace(/^#+/, '')).filter(Boolean);
  inp.value = '';
  if (names.length) saveEntryTags([...JSON.parse($('#etags').dataset.names || '[]'), ...names]);
}

// ---------- Vorlagen ----------
let templates = [], curTemplate = null;  // curTemplate: {id, version} des offenen Eintrags

async function loadTemplates() {
  templates = await call('templates');
  $('#tplsec').hidden = !templates.length;
  $('#templates').innerHTML = templates.map(t => `<li data-tpl="${t.id}" class="${t.archived ? 'arch' : ''}" title="Neuer Eintrag aus „${esc(t.name)}“ (Version ${t.version})">
    <span class="n">📋 ${esc(t.name)}</span><button class="ed vchip" data-tplver="${t.id}" title="Ältere Version verwenden">v${t.version}</button>
    <button class="ed" data-tplarch="${t.id}" title="${t.archived ? 'Wiederherstellen' : 'Archivieren'}">${t.archived ? '↺' : '🗄'}</button></li>`).join('');
  renderTemplateInfo();
}

function renderTemplateInfo() {
  const t = curTemplate && templates.find(x => x.id == curTemplate.id);
  $('#tplinfo').innerHTML = t ? `aus Vorlage <b>${esc(t.name)}</b> v${curTemplate.version}${t.version > curTemplate.version ? ` <span class="sub">(neueste: v${t.version})</span>` : ''}` : '';
}

async function saveAsTemplate() {
  if (!cur) return;
  await flush();
  const own = curTemplate && templates.find(x => x.id == curTemplate.id);
  const name = prompt('Name der Vorlage (gibt es den Namen schon, entsteht eine neue Version)', own?.name || $('#title').value);
  if (!name?.trim()) return;
  try {
    const r = await call('saveTemplate', {name, entry: cur});
    status(r.unchanged ? `Vorlage „${name.trim()}“ ist schon auf diesem Stand (v${r.version})` : `Vorlage „${name.trim()}“ als Version ${r.version} gespeichert`);
    await loadTemplates();
  } catch (e) { alert(e.message); }
}

async function fromTemplate(id, version) {
  try {
    const eid = await call('createFromTemplate', {id, ...(version ? {version} : {}), ...(project > 0 ? {project} : {})});
    $('#search').value = '';
    await loadProjects();
    await refreshList(eid);
    dirty = true; await flush();  // Text für die Suche speichern
  } catch (e) { alert(e.message); }
}

async function pickTemplateVersion(id) {
  const vs = await call('templateVersions', {id});
  const v = prompt(`Version wählen:\n${vs.map(x => `v${x.version} vom ${when(x.created)}`).join('\n')}`, String(vs[0].version));
  if (v == null) return;
  if (!vs.some(x => x.version == +v)) return alert('Diese Version gibt es nicht.');
  fromTemplate(id, +v);
}

// ---------- Einträge ----------
let listSeq = 0;
async function refreshList(selectId) {
  const seq = ++listSeq;  // schnelle Folge (Tippen, Klicken): nur die jüngste Antwort wird gezeigt
  const q = $('#search').value.trim();
  const filter = {...(project == null ? {} : {project}), ...(tag == null ? {} : {tag})};
  let rows = project == 'trash' ? (await call('trash')).map(r => ({...r, updated: r.deleted}))
    : q ? await call('search', {q}) : await call('list', filter);
  if (seq != listSeq) return;
  if (q && project != null && project != 'trash') rows = rows.filter(r => (r.project_id ?? 0) == project);  // Suche im gewählten Projekt
  if (q && tag != null) { const n = tags.find(t => t.id == tag)?.name.toLowerCase(); rows = rows.filter(r => (r.tags || '').toLowerCase().split(', ').includes(n)); }
  if (project != 'trash') rows = Manage.filterSort(rows, q && LISTF.sort == 'updated' ? {...LISTF, sort: 'none'} : LISTF);  // Suche: Trefferreihenfolge bleibt
  if (LIST_SELECT) for (const id of [...LIST_SELECT]) if (!rows.some(r => r.id == id)) LIST_SELECT.delete(id);
  renderListBar();
  const listScroll = $('#list').scrollTop;
  $('#list').innerHTML = rows.map(r => `<li data-id="${r.id}" class="${r.id == cur ? 'cur' : ''} ${LIST_SELECT?.has(r.id) ? 'picked' : ''}">
    <div class="t">${LIST_SELECT ? `<input type="checkbox" class="lpick" ${LIST_SELECT.has(r.id) ? 'checked' : ''}> ` : ''}${r.pinned ? '📌 ' : ''}${statusDot(r.status)}${esc(r.title || 'Ohne Titel')}</div>
    <div class="m">${KINDS[r.kind] || ''} · ${r.day_first ? `📅 ${Days.rangeLabel(r.day_first, r.day_last)}` : when(r.updated)}${r.revisions ? ` · ${r.revisions} Rev.` : ''}${project == null && r.project_id ? ` · ${esc(projectName(r.project_id))}` : ''}</div>
    ${r.tags ? `<div class="m">${r.tags.split(', ').map(t => '#' + esc(t)).join(' ')}</div>` : ''}
    ${r.snippet ? `<div class="s">${esc(r.snippet).replace(/\[(.*?)\]/g, '<mark>$1</mark>')}</div>` : ''}</li>`).join('');
  $('#list').scrollTop = listScroll;  // die Liste springt beim Auffrischen nicht nach oben
  $('#listTitle').textContent = [project == null ? 'Einträge' : project == 'trash' ? 'Papierkorb' : projectName(project), tag != null ? '#' + (tags.find(t => t.id == tag)?.name || '') : ''].filter(Boolean).join(' · ');
  if (project == 'trash' && rows.length) $('#list').insertAdjacentHTML('afterbegin', '<li class="trashhead"><button class="btn danger" data-emptytrash>Papierkorb leeren</button></li>');
  $('#empty').hidden = !!(rows.length || q || cur || project != null || tag != null);
  if (selectId) await open(selectId);
}

async function showBacklinks() {
  const b = await call('backlinks', {id: cur});
  $('#backlinks').hidden = !b.length;
  $('#backlinks').innerHTML = `<h4>Verweise auf diesen Eintrag</h4>` + b.map(r => `<a href="#" class="elink" data-entry="${r.id}">↗ ${esc(r.title || 'Ohne Titel')}</a>`).join(' ');
  refreshDbRefs(); refreshCiteBox();
}

let openSeq = 0;
const markListCur = id => document.querySelectorAll('#list li').forEach(li => li.classList.toggle('cur', li.dataset.id == id));
async function open(id, {find} = {}) {
  if (cur == id && !preview) { if (find) jumpToText(find); return; }
  const seq = ++openSeq;  // wer später klickt, gewinnt; ältere Ladevorgänge hören auf
  markListCur(id);  // Auswahl sofort sichtbar, nicht erst nach dem Laden
  await flush();
  if (seq != openSeq) return;
  if (cur && changedSinceSnap) await snapshot(true);
  if (seq != openSeq) return;
  const e = await call('load', {id});
  if (seq != openSeq) return;
  setPreview(null);
  if (!$('#reg').hidden) showView('doc');
  cur = e.id;
  $('#doc').hidden = false; $('#empty').hidden = true;
  $('#title').value = e.title;
  fillMetaProject(String(e.project_id ?? 0));
  $('#metaKind').value = e.kind;
  renderEntryTags(e.tags || []);
  curTemplate = e.template_id ? {id: e.template_id, version: e.template_version} : null;
  curSigned = e.signed_no ?? null;
  curTrashed = e.deleted ?? null;
  renderTemplateInfo();
  if (RUN && RUN.entry != e.id) hideRun();
  const content = e.draft_json ? await refreshLinkLabels(JSON.parse(e.draft_json)) : '';
  if (seq != openSeq) { markListCur(cur); return; }
  editor.commands.setContent(content, {emitUpdate: false});
  showBacklinks();
  dirty = changedSinceSnap = false; lastSnap = Date.now();
  status('Gespeichert');
  updateCounts();
  markListCur(cur);
  applyLock();
  renderSignInfo();
  renderTrashInfo();
  checkLinks();
  if (!$('#history').hidden) showHistory();
  updateRunBar();
  if (SIDE == e.id || SIDE < 0) closeSide();  // negativ: Versionsvergleich des vorigen Eintrags
  call('touchOpened', {id: e.id}).catch(() => {});
  renderEntryFlags();
  if (ETAB != 'notes') showEntryTab('notes'); else renderEntryTabs();
  if (find && jumpToText(find)) return;
  if (!e.title) $('#title').focus(); else editor.commands.focus('start');
}

// ---------- Papierkorb ----------
function renderTrashInfo() {
  $('#trashinfo').hidden = !curTrashed;
  if (curTrashed) $('#trashinfo').innerHTML = `<span class="grow">🗑 <b>Im Papierkorb</b> seit ${when(curTrashed)} · nur lesen</span>
    <button class="btn on" data-trestore>Wiederherstellen</button><button class="btn danger" data-tpurge>Endgültig löschen</button>`;
}

async function trashEntry() {
  if (!cur || curTrashed) return;
  if (curSigned) return alert('Signierte Einträge lassen sich nicht löschen. Änderungen bitte als Nachtrag.');
  await flush();
  if (changedSinceSnap) await snapshot(true);
  const title = $('#title').value || 'Ohne Titel';
  try { await call('trashEntry', {id: cur}); } catch (e) { return alert(e.message); }
  const gone = cur; cur = null;
  status(`„${title}“ liegt im Papierkorb`);
  await loadProjects(); await loadTags();
  await refreshList();
  const next = [...document.querySelectorAll('#list li[data-id]')].find(li => li.dataset.id != gone);
  if (next) await open(+next.dataset.id); else { $('#doc').hidden = true; $('#empty').hidden = false; }
}

async function restoreEntry() {
  const id = cur;
  await call('restoreEntry', {id});
  cur = null;
  project = null; await loadProjects();
  await refreshList(id);
  status('Wiederhergestellt');
}

async function purgeEntry() {
  if (!confirm(`„${$('#title').value || 'Ohne Titel'}“ endgültig löschen? Alle Revisionen dieses Eintrags gehen verloren. Das lässt sich nicht rückgängig machen.`)) return;
  try { await call('purgeEntry', {id: cur}); } catch (e) { return alert(e.message); }
  cur = null;
  await loadProjects(); await loadTags();
  await refreshList();
  const next = $('#list li[data-id]'); if (next) await open(+next.dataset.id); else { $('#doc').hidden = true; $('#empty').hidden = false; }
  status('Endgültig gelöscht');
}

async function emptyTrash() {
  const n = (await call('trash')).length;
  if (!n || !confirm(`${n} Eintrag/Einträge im Papierkorb endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
  await call('emptyTrash');
  cur = null; project = null;
  await loadProjects(); await loadTags(); await refreshList();
  const first = $('#list li'); if (first) await open(+first.dataset.id);
  status('Papierkorb geleert');
}

async function newEntry() {
  if (project == 'trash') project = null;
  const id = await call('create', {title: '', ...(project > 0 ? {project} : {})});
  $('#search').value = '';
  await loadProjects();
  await refreshList(id);
}

async function setMeta(args) {
  if (!cur) return;
  try { await call('setMeta', {id: cur, ...args}); } catch (e) { return alert(e.message); }
  await loadProjects();
  await refreshList();
}

// ---------- Alte Revisionen (nur lesen, wiederherstellbar) ----------
function setPreview(r) {
  preview = r;
  applyLock();
  $('#meta').hidden = !!r;
  $('#preview').hidden = !r;
  if (r) $('#preview').innerHTML = `<span class="grow"><b>Revision ${r.no}</b> vom ${when(r.created)} · nur lesen</span>
    <button class="btn" data-diff="${r.no}">Änderungen zum aktuellen Stand</button><button class="btn on" data-restore>Diese Fassung wiederherstellen</button><button class="btn" data-back>Zurück zum aktuellen Stand</button>`;
  document.querySelectorAll('#revlist li').forEach(li => li.classList.toggle('cur', r && li.value == r.no));
}

async function showRevision(no) {
  await flush();
  const r = await call('revision', {id: cur, no});
  setPreview(r);
  $('#title').value = r.title;
  editor.commands.setContent(await refreshLinkLabels(JSON.parse(r.content_json)), {emitUpdate: false});
  updateCounts();
}

async function leavePreview(restore) {
  const r = preview;
  if (!r) return;
  if (restore) {
    setPreview(null);
    changed();  // die angezeigte Fassung wird zum neuen Arbeitsstand; alte Revisionen bleiben unverändert
    await snapshot(true);
    status(`Fassung von Revision ${r.no} wiederhergestellt`);
  } else {
    const id = cur; cur = null;
    await open(id);
  }
}

// ---------- Speichern ----------
function changed() {
  if (curSigned) return;  // abgeschlossene Einträge werden nicht mehr gespeichert
  dirty = changedSinceSnap = true;
  status('Nicht gespeichert');
  updateCounts();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
  clearTimeout(dbRefTimer); dbRefTimer = setTimeout(() => { refreshDbRefs(); refreshCiteBox(); refreshAgendaBadge(); }, 800);
}
let dbRefTimer;

async function flush() {
  if (!preview) CALC_PENDING.forEach(f => f());  // Rechner-Eingaben übernehmen, die noch im Feld stehen
  clearTimeout(saveTimer);
  if (!cur || !dirty) return;
  dirty = false;
  status('Speichert …');
  try {
    const doc = editor.getJSON();
    await call('save', {id: cur, title: $('#title').value, json: JSON.stringify(doc), text: editor.getText(), ...collectRefs(doc)});
    status('Gespeichert');
    if (Date.now() - lastSnap > SNAPSHOT_MS && changedSinceSnap) await snapshot(true);
    const li = document.querySelector(`#list li[data-id="${cur}"] .t`);
    if (li) li.textContent = $('#title').value || 'Ohne Titel';
  } catch (e) { dirty = true; status('Fehler beim Speichern: ' + e.message); }
}

/// Unveränderliche Revision anlegen (automatisch alle 5 Min., beim Wechseln, mit ⌘S und beim Beenden).
async function snapshot(quiet) {
  if (!cur) return;
  await flush();
  const r = await call('snapshot', {id: cur});
  changedSinceSnap = false; lastSnap = Date.now();
  if (r && !quiet) status(`Revision ${r.no} gesichert`);
  updateCounts();
  if (!$('#history').hidden) showHistory();
}

function status(t) { $('#saved').textContent = t; }

async function updateCounts() {
  if (!cur) return;
  $('#words').textContent = `${editor.storage.characterCount.words().toLocaleString('de-DE')} Wörter`;
}

// ---------- Verlauf ----------
async function showHistory() {
  if (!cur) return;
  const [revs, v] = await Promise.all([call('history', {id: cur}), call('verify', {id: cur})]);
  $('#revs').textContent = `${revs.length} Revisionen`;
  $('#chain').innerHTML = !v.count ? '<span class="sub">Noch keine Revision. ⌘S sichert eine.</span>'
    : v.ok ? `<span class="ok">✓ Hash-Kette intakt (${v.count})</span>` : `<span class="bad">✗ Kette bei Revision ${v.broken} verletzt</span>`;
  $('#revlist').innerHTML = revs.map(r => `<li value="${r.no}" title="Diese Fassung ansehen" class="${preview?.no == r.no ? 'cur' : ''}">${when(r.created)}`
    + `${r.no == curSigned ? ' · 🔏' : ''}<br><code>${r.hash.slice(0, 16)}…</code></li>`).join('');
  $('#sigs').innerHTML = (v.signatures || []).map(g => g.kind == 'author'
    ? `<div class="${g.valid ? 'ok' : 'bad'}">${g.valid ? '✓' : '✗'} ${g.valid ? 'Signatur gültig' : 'Signatur ungültig'}: ${esc(g.name)}, Rev. ${g.rev_no}<br><span class="sub">${when(g.signed_at)} · Schlüssel ${esc(g.fingerprint)}</span></div>`
    : `<div class="${g.hash_found ? 'ok' : 'warn'}">${g.hash_found ? '✓' : '⚠'} Zeuge: ${esc(g.name)} (${when(g.signed_at)})<br><span class="sub">${g.hash_found ? 'Hash im PDF gefunden' : 'Hash nicht im PDF gefunden (Scan?) – bitte Ausdruck prüfen'}</span>`
      + ` <a href="#" data-openpdf="${g.file_sha256}">PDF öffnen</a></div>`).join('');
}

// ---------- Leistungstest (M0) ----------
async function perfTest() {
  const t = () => performance.now(), out = [];
  let t0 = t();
  const imgs = [];
  for (let i = 0; i < 20; i++) {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 1200, 800);
    gr.addColorStop(0, `hsl(${i * 18},60%,45%)`); gr.addColorStop(1, `hsl(${i * 18 + 120},60%,25%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 1200, 800);
    for (let k = 0; k < 400; k++) { g.fillStyle = `hsla(${k * 7},70%,70%,.35)`; g.beginPath(); g.arc(Math.random() * 1200, Math.random() * 800, Math.random() * 30, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText(`Gel ${i + 1}`, 40, 100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    imgs.push(await upload(blob, `test-${i + 1}.png`));
  }
  out.push(`20 Bilder speichern: ${(t() - t0).toFixed(0)} ms`);
  const words = 'Puffer Probe Zentrifuge Pellet Überstand Inkubation Plasmid Primer Gel Bande Ladder Ausbeute Konzentration Verdünnung Messung Kontrolle'.split(' ');
  const content = [];
  let n = 0;
  for (let p = 0; n < 5000; p++) {
    if (p % 12 == 0) content.push({type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: `Abschnitt ${p / 12 + 1}`}]});
    const len = 20 + (p % 7) * 3;
    content.push({type: 'paragraph', content: [{type: 'text', text: Array.from({length: len}, (_, k) => words[(p * 31 + k * 7) % words.length]).join(' ') + '.'}]});
    n += len;
    if (p % 13 == 5 && imgs.length) content.push({type: 'image', attrs: {src: `lab://files/${imgs.pop()}`, alt: 'Testbild'}});
  }
  const id = await call('create', {title: 'Leistungstest'});
  await refreshList(id);
  t0 = t();
  editor.commands.setContent({type: 'doc', content});
  document.body.getBoundingClientRect();
  out.push(`Dokument laden (${editor.storage.characterCount.words()} Wörter): ${(t() - t0).toFixed(0)} ms`);
  editor.commands.focus('end');
  const per = [];
  for (let i = 0; i < 300; i++) {
    const s = t();
    editor.commands.insertContent('x');
    $('#editor').getBoundingClientRect(); void $('#editor').offsetHeight;  // Layout erzwingen wie beim echten Tippen
    per.push(t() - s);
  }
  per.sort((a, b) => a - b);
  out.push(`Tippen (300 Zeichen am Ende): Median ${per[150].toFixed(2)} ms, 95 % ${per[285].toFixed(2)} ms, max ${per[299].toFixed(2)} ms`);
  t0 = t(); dirty = true; await flush();
  out.push(`Speichern: ${(t() - t0).toFixed(0)} ms (${(JSON.stringify(editor.getJSON()).length / 1024).toFixed(0)} KB JSON)`);
  t0 = t(); await snapshot(true);
  out.push(`Revision sichern: ${(t() - t0).toFixed(0)} ms`);
  window.perfResult = out;
  console.log(out.join('\n'));
  if (!window.TESTING) alert('Leistungstest\n\n' + out.join('\n'));  // im automatischen Lauf würde die Meldung ewig warten
}

// ---------- Selbsttest in der echten App (--selftest) ----------
async function selfTest() {
  window.TESTING = true;  // externe Links nicht wirklich öffnen
  const jsErrors = [];  // jeder unbehandelte Fehler während des Laufs zählt als Fehlschlag, auch wenn die Prüfung selbst grün ist
  const onErr = e => jsErrors.push(String(e.error?.stack || e.message || e.reason?.stack || e.reason));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  const out = [], sleep = ms => new Promise(r => setTimeout(r, ms));
  const ok = (c, what) => { const l = `${c ? 'ok  ' : 'FAIL'} ${what}`; out.push(l); call('testProgress', {line: l}).catch(() => {}); };
  const a = await call('create', {title: 'Selbsttest Ziel'}), b = await call('create', {title: 'Selbsttest Quelle'});
  await refreshList(b);
  const csv = 'Probe;Wert\nA1;42,7\nA2;38,1\n';
  const sha = await upload(new File([csv], 'werte.csv', {type: 'text/csv'}));
  ok(await (await fetch(`/files/${sha}`)).text() == csv, 'Anhang über /files lesbar (fetch)');
  const img = await new Promise(r => { const c = document.createElement('canvas'); c.width = c.height = 8; c.toBlob(r, 'image/png'); });
  const isha = await upload(img, 'punkt.png');
  ok(await new Promise(r => { const i = new Image(); i.onload = () => r(i.width == 8); i.onerror = () => r(false); i.src = `lab://files/${isha}`; }), 'Bild über lab://files ladbar');
  editor.commands.setContent({type: 'doc', content: [
    {type: 'paragraph', content: [{type: 'text', text: 'siehe '}, {type: 'mention', attrs: {id: String(a), label: 'x'}}]},
    {type: 'file', attrs: {sha, name: 'werte.csv', mime: 'text/csv', size: csv.length}}]});
  changed(); await flush();
  document.querySelector('.filecard [data-fprev]').click(); await sleep(300);
  ok(document.querySelectorAll('.fprev tr').length == 3, 'CSV-Vorschau zeigt 3 Zeilen');
  ok((await call('backlinks', {id: a})).some(r => r.id == b), 'Rückverweis gespeichert');
  await call('setTags', {id: b, names: ['selbsttest']});
  const t = (await call('tags')).find(x => x.name == 'selbsttest');
  ok(t && (await call('list', {tag: t.id})).length == 1, 'Tag-Filter');
  document.querySelector('.ProseMirror a.elink').click(); await sleep(300);
  ok(cur == a, 'Klick auf Verweis öffnet Ziel');

  // Rechner: Eingabe wird übernommen, wenn der Fokus den Block verlässt
  editor.commands.setContent(''); insertCalc('dilution'); await sleep(50);
  const c1 = document.querySelector('.calc [data-k="c1"]');
  c1.focus(); c1.value = '10'; c1.dispatchEvent(new Event('input', {bubbles: true}));
  document.querySelector('#title').focus(); await sleep(50);
  ok(editor.getJSON().content.find(n => n.type == 'calc')?.attrs.data.c1.v == '10', 'Rechner übernimmt Eingabe beim Verlassen (Fokus)');

  // Vorlage und Lauf
  editor.commands.setContent({type: 'doc', content: [{type: 'orderedList', content: ['Ansetzen', '5 min inkubieren', 'Messen'].map(t => ({type: 'listItem', content: [{type: 'paragraph', content: [{type: 'text', text: t}]}]}))}]});
  changed(); await flush();
  const tpl = await call('saveTemplate', {name: 'Selbsttest-Vorlage', entry: cur});
  const fromT = await call('createFromTemplate', {id: tpl.id});
  await refreshList(fromT);
  ok(cur == fromT && extractSteps(editor.getJSON()).length == 3, 'Eintrag aus Vorlage mit 3 Schritten');
  await startRun(); await sleep(100);
  document.querySelector('[data-rdone]').click(); await sleep(150);
  ok(!!document.querySelector('[data-rtimer="300"]'), 'Timer für „5 min“ erkannt');
  window.confirm = () => true;
  await finishRun(false); await sleep(200);
  ok(editor.getJSON().content.some(n => n.type == 'table') && !(await call('activeRun', {entry: cur})), 'Lauf beendet, Ablaufprotokoll angehängt');

  // Abschließen, signieren, Zeugen-PDF
  const signId = cur;
  await signEntry(); await sleep(200);
  const v = await call('verify', {id: signId});
  ok(curSigned && v.ok && v.signatures[0]?.valid, 'Eintrag signiert, Signatur gültig');
  ok(!editor.isEditable && $('#toolbar').hidden && !$('#signinfo').hidden, 'Signierter Eintrag ist schreibgeschützt');
  let rejected = false;
  try { await call('save', {id: signId, title: 'x', json: '{}', text: ''}); } catch { rejected = true; }
  ok(rejected, 'Speicher lehnt Änderung am signierten Eintrag ab');
  const pdf = await makeWitnessPDF();
  ok(pdf && pdf.bytes > 1000, `Zeugen-PDF erzeugt (${pdf?.bytes} Bytes)`);
  window.prompt = () => 'Dr. Test Zeuge';
  const w = await attachWitness(pdf?.path);
  ok(w && w.hash_found, 'Zeugen-PDF wieder angehängt, Hash darin gefunden');
  const v2 = await call('verify', {id: signId});
  ok(v2.signatures.length == 2 && v2.signatures[1].kind == 'witness', 'Verlauf zeigt Autor und Zeuge');
  await addendum(); await sleep(150);
  ok(cur != signId && (await call('backlinks', {id: signId})).some(r => r.id == cur), 'Nachtrag verweist auf den signierten Eintrag');
  // Langer Eintrag: das Zeugen-PDF muss auf mehrere Seiten umbrechen
  const longId = await call('create', {title: 'Langer Eintrag'});
  await refreshList(longId);
  editor.commands.setContent({type: 'doc', content: Array.from({length: 120}, (_, i) => ({type: 'paragraph', content: [{type: 'text', text: `Absatz ${i + 1}: Probe zentrifugiert, Überstand verworfen, Pellet in Puffer aufgenommen und auf Eis gestellt.`}]}))});
  changed(); await flush();
  await signEntry(); await sleep(200);
  const longPdf = await makeWitnessPDF();
  ok(longPdf && longPdf.pages > 1, `Langer Eintrag: Zeugen-PDF mit ${longPdf?.pages} Seiten`);

  // M5: Texterkennung, Rohdaten, Beschriftung, Übernahme vom iPhone
  const ocrId = await call('create', {title: 'Gescanntes Protokoll'});
  await refreshList(ocrId);
  const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 500;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 500); g.fillStyle = '#000'; g.font = 'bold 72px Helvetica';
  g.fillText('Lysepuffer RIPA', 60, 160); g.fillText('Zentrifuge 13000 rpm', 60, 320);
  const scanSha = await upload(await new Promise(r => cv.toBlob(r, 'image/png')), 'scan.png');
  editor.commands.setContent({type: 'doc', content: [{type: 'image', attrs: {src: `lab://files/${scanSha}`, alt: 'scan.png'}}]});
  changed(); await flush();
  let txt = null;
  for (let i = 0; i < 60 && txt == null; i++) { await sleep(250); txt = await call('ocrText', {sha256: scanSha}); }
  ok(/lysepuffer/i.test(txt || ''), `Text im Bild erkannt: „${(txt || '').replace(/\n/g, ' / ')}“`);
  ok((await call('search', {q: 'lysepuff'})).some(r => r.id == ocrId), 'Suche findet Text aus dem Bild');

  const rawPath = await call('testWriteFile', {name: 'messung.fcs', bytes: 5000000});
  const linked = await linkRawFiles([rawPath]);
  ok(linked?.[0]?.stored == 'link' && document.querySelector('.filecard.linked'), 'Rohdatei verlinkt (nicht kopiert)');
  changed(); await flush();
  await checkLinks();
  ok(LINK_STATUS[linked[0].sha256] == 'ok', 'Verlinkte Rohdatei unverändert');
  await call('testModifyFile', {name: 'messung.fcs'});
  await checkLinks(); await sleep(50);
  ok(LINK_STATUS[linked[0].sha256] == 'changed' && /verändert/.test(document.querySelector('.filecard.linked .lstat').textContent), 'Geänderte Rohdatei wird gemeldet');

  editor.commands.setContent({type: 'doc', content: [{type: 'image', attrs: {src: `lab://files/${scanSha}`, alt: 'gel',
    notes: {aspect: 2.8, shapes: [{t: 'lanes', y: 60, xs: [100, 300, 500], labels: ['M', 'P1', 'NK'], c: '#e53935'}, {t: 'arrow', x1: 600, y1: 300, x2: 500, y2: 200, c: '#fdd835'}]}}}]});
  await sleep(100);
  const labels = [...document.querySelectorAll('.ProseMirror .annot-svg text')].map(t => t.textContent);
  ok(labels.join(',') == 'M,P1,NK' && editor.getHTML().includes('figure class="annot"'), 'Gelbild mit Spurenbelegung angezeigt und im HTML/PDF enthalten');

  editor.commands.setContent(''); editor.commands.focus();
  const got = await call('testReceive');
  await sleep(150);
  ok(got && editor.getJSON().content.some(n => n.type == 'image' && /^Foto /.test(n.attrs.alt)), 'Übernahme (wie vom iPhone) fügt Foto ein');

  // M6: Export, Re-Import, Import aus Markdown/RTF/Scan, PDF, Sicherung
  const alerts = []; window.alert = m => alerts.push(m);
  const before = (await call('list')).length + (await call('trash')).length;  // der Export enthält auch den Papierkorb
  const ex = await exportBook();
  const files = ex ? await call('testList') : [];
  const exDir = ex?.path.split('/').pop();
  const idx = ex ? await call('testReadText', {path: `${exDir}/index.html`}) : '';
  const bookJson = ex ? JSON.parse(await call('testReadText', {path: `${exDir}/data/book.json`})) : {};
  const mdFile = files.find(f => f.startsWith(exDir + '/entries/') && f.endsWith('.md') && /gescanntes-protokoll/.test(f));
  const md = mdFile ? await call('testReadText', {path: mdFile}) : '';
  ok(ex && idx.includes('Gescanntes Protokoll') && files.some(f => f.endsWith('.eln')) && files.some(f => f.includes('/files/')), `Export: Übersicht, Einträge, Dateien, .eln (${files.length} Dateien)`);
  ok(bookJson.entries?.length == before && bookJson.revisions?.length > 0 && bookJson.signatures?.length > 0, 'Export: book.json mit allen Einträgen, Revisionen und Signaturen');
  ok(/^---\nid: \d+/.test(md) && md.includes('# Gescanntes Protokoll') && md.includes('](../files/'), 'Export: Markdown mit Kopfdaten und Bild-Link');

  const elnPath = `${ex.path}/${files.find(f => f.endsWith('.eln')).split('/').pop()}`;
  const reIds = await importFiles([elnPath]);
  ok(reIds.length == before, `Re-Import der .eln: ${reIds.length} von ${before} Einträgen`);
  const origTitles = bookJson.entries.map(e => e.title || 'Ohne Titel').sort().join('|');  // .eln braucht einen Namen, leere Titel kommen so zurück
  const reTitles = (await Promise.all(reIds.map(id => call('load', {id})))).map(e => e.title).sort().join('|');
  const reImgs = (await Promise.all(reIds.map(id => call('load', {id})))).flatMap(e => [...(e.draft_json || '').matchAll(/lab:\/\/files\/([0-9a-f]{64})/g)].map(m => m[1]));
  const imgOk = reImgs.length && (await Promise.all(reImgs.map(sh => fetch(`/files/${sh}`).then(r => r.ok)))).every(Boolean);
  ok(reTitles == origTitles && imgOk, `Re-Import: gleiche Titel, ${reImgs.length} Bild(er) wieder ladbar`);

  const mdPath = await call('testWriteText', {name: 'protokoll.md', text: '# Western Blot\n\n1. Gel laden\n2. Blotten **60 min**\n\n| Antikörper | Verdünnung |\n|---|---|\n| anti-GAPDH | 1:5000 |\n\n<script>alert(1)</script>'});
  const rtfPath = await call('testWriteText', {name: 'notiz.rtf', text: '{\\rtf1\\ansi {\\b Fett gedruckt} und normal.\\par}'});
  const png = (await new Promise(r => cv.toBlob(r, 'image/png')));
  const pngPath = await call('testWriteBase64', {name: 'scan-2.png', base64: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(png); })});
  const imp = await importFiles([mdPath, rtfPath, pngPath]);
  const j1 = JSON.parse((await call('load', {id: imp[0]})).draft_json), j2 = JSON.parse((await call('load', {id: imp[1]})).draft_json), j3 = JSON.parse((await call('load', {id: imp[2]})).draft_json);
  const s1 = JSON.stringify(j1);
  ok(s1.includes('"orderedList"') && s1.includes('"table"') && s1.includes('anti-GAPDH') && s1.includes('"bold"') && s1.includes('"text":"<script>alert(1)</script>"'), 'Markdown-Import: Liste, Tabelle, fett; Skript nur als harmloser Text');
  ok(JSON.stringify(j2).includes('Fett gedruckt') && JSON.stringify(j2).includes('"bold"'), 'RTF/Word-Import mit Formatierung');
  ok(j3.content.some(n => n.type == 'image') && JSON.stringify(j3).includes('Erkannter Text') && /Lysepuffer/i.test(JSON.stringify(j3)), 'Scan-Import: Bild und erkannter Text im Eintrag');

  await refreshList(imp[0]);
  const pdf1 = await exportEntryPDF(false);
  ok(pdf1?.pages >= 1, `Eintrag als PDF (${pdf1?.pages} Seite/n)`);
  const pdfa = await exportEntryPDF(true);
  ok(!pdfa && alerts.some(a => /Ghostscript/.test(a)), 'PDF/A ohne Ghostscript: klarer Hinweis statt Absturz');

  const bk = await backupNow();
  ok(bk && bk.copied > 0 && /^db-/.test(bk.db), `Sicherung: Datenbank und ${bk?.copied} Datei(en) kopiert`);
  const bk2 = await backupNow();
  ok(bk2 && bk2.copied == 0, 'Zweite Sicherung kopiert keine Datei doppelt');

  // M7: Tabs/Fenster
  const tabEntry = imp[0];
  await refreshList(tabEntry);
  await call('openInTab', {id: tabEntry});
  let other = null;
  for (let i = 0; i < 40 && !(other?.value); i++) { await sleep(150); other = await call('testOther', {js: 'return typeof cur == "number" ? cur : null'}).catch(() => null); }
  ok(other?.windows == 2 && other.value == tabEntry, `Neuer Tab öffnet den gewünschten Eintrag (${other?.windows} Fenster)`);
  $('#title').value = 'Western Blot (umbenannt)'; changed(); await flush(); await sleep(500);
  const otherTitle = (await call('testOther', {js: 'return document.querySelector("#title").value'})).value;
  ok(otherTitle == 'Western Blot (umbenannt)', 'Änderung erscheint im anderen Fenster');

  // M7: Spotlight (Test-Index wird danach wieder gelöscht)
  const needle = 'Spotlight Test ' + Math.random().toString(36).slice(2, 8);
  const spId = await call('create', {title: needle}); await refreshList(spId);
  const sp = await call('testSpotlight', {title: needle}).catch(e => ({error: e.message}));
  ok(sp.found > 0, `Spotlight findet den Eintrag (${sp.found ?? 0} Treffer, ${sp.tries ?? '?'} Abfragen${sp.error ? ', ' + sp.error : ''})`);

  // M7: Quick Look
  const ql = await call('testQuickLook').catch(e => ({error: e.message}));
  ok(/QuickLook\/Preview\.html/.test(ql.previewURL || '') && ql.thumbnail && ql.html.includes(needle), `Quick Look: Vorschau und Vorschaubild${ql.error ? ' – ' + ql.error : ''}`);

  // M8: Registry
  const types = await call('types');
  ok(types.length >= 6 && types.some(t => t.prefix == 'PL'), `Registry mit ${types.length} Typen`);
  const pl = types.find(t => t.prefix == 'PL');
  const plasmid = await call('createEntity', {type: pl.id, name: 'pUC19', values: {backbone: 'pUC', resistance: 'Ampicillin', sequence: 'atgc gtac'}});
  ok(plasmid.code == 'PL-0001' && JSON.parse(plasmid.fields_json).sequence == 'ATGCGTAC', 'Plasmid PL-0001 angelegt, Sequenz bereinigt');
  const useId = await call('create', {title: 'Klonierung mit pUC19'}); await refreshList(useId);
  editor.commands.setContent({type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Vektor '}, {type: 'mention', attrs: {id: `ent:${plasmid.id}`, label: 'x', mentionSuggestionChar: '@'}}]}]});
  changed(); await flush();
  cur = null; await open(useId); await sleep(100);
  ok(document.querySelector('.ProseMirror a.eref')?.textContent == 'PL-0001 pUC19', '@-Verweis zeigt ID und Namen');
  document.querySelector('.ProseMirror a.eref').click(); await sleep(250);
  ok(!$('#reg').hidden && /PL-0001/.test($('.reghead h2').textContent) && $('.regside').textContent.includes('Klonierung mit pUC19'), 'Klick öffnet Plasmid, „Verwendet in“ zeigt den Eintrag');
  const gp = await call('saveType', {name: 'Gewebeprobe', prefix: 'gp', icon: '🧊', fields: [{key: 'organ', label: 'Organ', type: 'text'}]});
  const probe = await call('createEntity', {type: gp, name: 'Leber Maus 3', values: {organ: 'Leber'}});
  ok(probe.code == 'GP-0001', 'Eigener Typ mit eigenen Feldern');
  await showType(gp); await sleep(100);
  ok(document.querySelectorAll('.regtable tr[data-ent]').length == 1, 'Tabelle des eigenen Typs');
  showView('doc');

  // Papierkorb
  window.confirm = () => true;
  const tId = await call('create', {title: 'Fehlversuch Löschtest'}); await refreshList(tId);
  editor.commands.setContent({type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Rotor falsch gewählt'}]}]}); changed(); await flush();
  await trashEntry();
  ok(cur != tId && !(await call('list')).some(r => r.id == tId) && !(await call('search', {q: 'rotor'})).some(r => r.id == tId), 'Eintrag im Papierkorb: weg aus Liste und Suche');
  await selectProject('trash');
  ok($('#listTitle').textContent == 'Papierkorb' && document.querySelector(`#list li[data-id="${tId}"]`), 'Papierkorb zeigt den Eintrag');
  await open(tId);
  ok(!editor.isEditable && !$('#trashinfo').hidden && $('#trashBtn').hidden, 'Eintrag im Papierkorb ist schreibgeschützt');
  await restoreEntry();
  ok(cur == tId && editor.isEditable && (await call('search', {q: 'rotor'})).some(r => r.id == tId), 'Wiederhergestellt, wieder bearbeitbar und auffindbar');
  await trashEntry(); await selectProject('trash'); await open(tId);
  await purgeEntry();
  ok(!(await call('trash')).some(r => r.id == tId) && !(await call('load', {id: tId}).catch(() => null)), 'Endgültig gelöscht');
  let signedOne = null;
  for (const r of await call('list')) { const e = await call('load', {id: r.id}); if (e.signed_no) { signedOne = e; break; } }
  let refused = false; try { await call('trashEntry', {id: signedOne.id}); } catch { refused = true; }
  ok(signedOne && refused && (await call('list')).some(r => r.id == signedOne.id), 'Signierter Eintrag lässt sich nicht löschen');
  await selectProject('');

  // M9: Bestand
  const fr = await call('saveLocation', {name: 'Gefrierschrank −20', kind: 'geraet', temp: '−20 °C'});
  const bx = await call('saveLocation', {name: 'Box Enzyme', kind: 'box', parent: fr, rows: 9, cols: 9});
  const lotA = await call('saveLot', {values: {name: 'Taq-Polymerase', amount: '500', unit: 'µl', min: '100', location: bx, position: 'A3', lot_no: 'L77'}});
  stockLoc = bx; await showStock('locations'); await renderLocations(); await sleep(100);
  const cellA3 = document.querySelectorAll('.boxgrid tr')[1]?.children[3];
  ok(cellA3?.dataset.lot == lotA.id, 'Charge liegt in Box A3 (Raster)');
  showView('doc');
  const useEntry = await call('create', {title: 'PCR mit Taq'}); await refreshList(useEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'usage', attrs: {lot: lotA.id}}, {type: 'paragraph'}]}); changed(); await flush(); await sleep(300);
  const ub = document.querySelector('.usage');
  ub.querySelector('[data-uamt]').value = '2';
  ub.querySelector('[data-ubook]').click(); await sleep(400);
  const afterUse = await call('lot', {id: lotA.id});
  const uNode = editor.getJSON().content.find(n => n.type == 'usage');
  ok(afterUse.amount == 498 && uNode.attrs.move && /verbucht/.test(document.querySelector('.usage').textContent), 'Verbrauch 2 µl verbucht: 500 → 498 µl');
  ok(afterUse.moves[0].entry_id == useEntry, 'Bewegung verweist auf den Eintrag');
  document.querySelector('.usage [data-ustorno]').click(); await sleep(400);
  ok((await call('lot', {id: lotA.id})).amount == 500 && editor.getJSON().content.find(n => n.type == 'usage').attrs.canceled, 'Storno bucht zurück');
  editor.commands.setContent({type: 'doc', content: [{type: 'usage', attrs: {lot: lotA.id}}, {type: 'paragraph'}]}); changed(); await flush(); await sleep(300);
  const ub2 = document.querySelector('.usage');
  ub2.querySelector('[data-uamt]').value = '0,45'; ub2.querySelector('[data-uunit]').value = 'ml';
  ub2.querySelector('[data-ubook]').click(); await sleep(400);
  const lowLot = await call('lot', {id: lotA.id});
  ok(lowLot.amount == 50 && lowLot.warnings.includes('low'), 'Umrechnung 0,45 ml → 450 µl; danach knapp');
  await call('saveLot', {values: {name: 'Alter Puffer', amount: '1', unit: 'l', expiry: '2020-01-01'}});
  const nWarn = await refreshStockBadge();
  ok(nWarn >= 2 && !$('#stockBadge').hidden, `Warnungen gemeldet (${nWarn})`);
  await showStock('lots'); stockFilter = 'warnings'; await renderLots(); await sleep(100);
  ok(document.querySelectorAll('#stock tr[data-lot]').length == nWarn, 'Liste „Nur Warnungen“');
  stockFilter = 'all'; showView('doc');

  // M10: QR-Etiketten, Scannen, Platte
  const lab = await labelFor('lot', lotA.id);
  const qr = await call('qr', {text: lab.url});
  const decoded = await call('testDecodeQR', {base64: qr});
  ok(decoded[0] == lab.url && /^laborbuch:\/\/open\?book=.+&t=lot&id=\d+$/.test(lab.url), 'QR-Code erzeugt und wie ein Kamerabild erkannt');
  ok(await openCode(decoded[0]) && !$('#stock').hidden && $('#stock .reghead h2').textContent.includes(lab.code), 'Gescannter Code öffnet die Charge');
  const pdfLab = await printLabels([lab, await labelFor('entity', plasmid.id), await labelFor('location', bx)], 'a4_3x8', 'Etiketten Test');
  ok(pdfLab?.pages == 1, `Etiketten als PDF (${pdfLab?.pages} Seite)`);
  const many = await printLabels(Array.from({length: 30}, () => lab), 'a4_3x8', 'Etiketten viele');
  ok(many?.pages == 2, `30 Etiketten auf A4 3 × 8 ergeben ${many?.pages} Seiten`);
  showView('doc');
  $('#search').value = plasmid.code; $('#search').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await sleep(300);
  ok(!$('#reg').hidden && /PL-0001/.test($('#reg .reghead h2').textContent), 'Handscanner-Eingabe im Suchfeld öffnet das Objekt');
  showView('doc');
  const plEntry = await call('create', {title: 'qPCR-Platte'}); await refreshList(plEntry);
  editor.commands.setContent(''); insertPlate(96); await sleep(100);
  const pv = document.querySelector('.plate');
  const ev = (el, type) => el.dispatchEvent(new MouseEvent(type, {bubbles: true}));
  ev(pv.querySelector('[data-well="A1"]'), 'mousedown'); ev(pv.querySelector('[data-well="A2"]'), 'mouseover'); ev(pv.querySelector('[data-well="A3"]'), 'mouseover');
  document.dispatchEvent(new MouseEvent('mouseup')); await sleep(50);
  document.querySelector('.plate [data-padd]').click(); await sleep(50);
  ev(document.querySelector('.plate [data-well="B1"]'), 'mousedown'); document.dispatchEvent(new MouseEvent('mouseup')); await sleep(50);
  const pnode = editor.getJSON().content.find(n => n.type == 'plate');
  ok(Object.keys(pnode.attrs.wells).length == 4 && plateSummary(pnode.attrs) == 'Probe 1: A1–A3; Probe 2: B1', `Platte belegt: ${plateSummary(pnode.attrs)}`);
  changed(); await flush();
  ok((await call('search', {q: 'B1'})).some(r => r.id == plEntry) || editor.getText().includes('A1–A3'), 'Belegung steht im Text des Eintrags');
  ok(editor.getHTML().includes('class="platetab"'), 'Platte erscheint im HTML/PDF als Tabelle');

  // M11: Ergebnisse und Auswertung
  await loadResultSchemas();
  const prep = RESULT_SCHEMAS.find(x => x.name == 'Plasmid-Präp');
  const preps = [[250, 50], [310, 50], [180, 40]];
  for (const [i, [konz, vol]] of preps.entries()) {
    const id = await call('create', {title: `Plasmid-Präp ${i + 1}`}); await refreshList(id);
    editor.commands.setContent(''); editor.commands.insertContent([{type: 'results', attrs: {schema: prep.id, rows: [{}]}}, {type: 'paragraph'}]); await sleep(80);
    const rb = document.querySelector('.results');
    const put = (k, v) => { const inp = rb.querySelector(`[data-k="${k}"]`); inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', {bubbles: true})); };
    put('probe', `Klon ${i + 1}`); put('konz', String(konz)); put('volumen', String(vol));
    if (i == 0) ok(rb.querySelector('[data-fk="ausbeute"]').textContent == '12,5', 'Formel rechnet live: 250 ng/µl × 50 µl = 12,5 µg');
    $('#title').focus(); await sleep(50);
    changed(); await flush();
  }
  const rowsDB = await call('resultRows', {schema: prep.id});
  ok(rowsDB.length == 3 && JSON.parse(rowsDB[0].values_json).ausbeute == 12.5, 'Ergebniszeilen samt Ausbeute gespeichert');
  AN.schema = prep.id; AN.y = 'ausbeute'; AN.x = 'date';
  await showAnalysis(); await sleep(100);
  const tileMean = [...document.querySelectorAll('#analysis .tile')].find(t => t.textContent.startsWith('Mittelwert'))?.querySelector('b').textContent;
  ok(document.querySelectorAll('#analysis .antable tr').length == 4 && document.querySelectorAll('#analysis svg.chart circle.pt').length == 3, 'Auswertung: Tabelle mit 3 Präps und 3 Punkte im Diagramm');
  ok(tileMean == '11,73 µg', `Mittelwert der Ausbeute über Einträge: (12,5 + 15,5 + 7,2) / 3 = ${tileMean}`);
  document.querySelector('#analysis circle.hit').dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); await sleep(30);
  ok(!$('#analysis .ctip').hidden && /µg/.test($('#analysis .ctip').textContent), 'Tooltip beim Darüberfahren');
  AN.x = 'konz'; await renderAnalysis();
  ok(document.querySelectorAll('#analysis svg.chart circle.pt').length == 3 && !document.querySelector('#analysis polyline'), 'Streudiagramm Ausbeute gegen Konzentration');
  const csvOut = await analysisCSV();
  const csvText = csvOut ? await call('testReadText', {path: csvOut.path.split('/').pop()}) : '';
  ok(csvText.includes('Ausbeute (µg)') && csvText.includes('12,5'), 'CSV-Export mit Einheiten und Komma');
  showView('doc');

  // M12: Zellkultur und Gerätebuch
  const snap = name => call('testSnapshot', {name}).catch(() => {});
  const zlType = (await call('types')).find(t => t.prefix == 'ZL');
  const hela = await call('createEntity', {type: zlType.id, name: 'HeLa', values: {}});
  const ku = await call('saveCulture', {values: {name: 'HeLa Flasche 1', entity: hela.id, passage: '12', medium: 'DMEM + 10 % FKS', vessel: 'T75'}});
  const kuEntry = await call('create', {title: 'HeLa splitten'}); await refreshList(kuEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'cultev', attrs: {culture: ku.id}}, {type: 'paragraph'}]}); changed(); await flush(); await sleep(300);
  document.querySelector('.cultev [data-csplit]').value = '1:10';
  document.querySelector('.cultev [data-cbook]').click(); await sleep(400);
  const ku13 = await call('culture', {id: ku.id});
  await snap('m12-block.png');
  ok(ku13.passage == 13 && /P12 → P13 \(1:10\) verbucht/.test(document.querySelector('.cultev').textContent) && ku13.events[0].entry_id == kuEntry,
    'Passage 12 → 13 im Eintrag verbucht, Ereignis verweist auf den Eintrag');
  await flush();
  ok((await call('search', {q: 'P13'})).some(r => r.id == kuEntry), 'Passage steht im Text des Eintrags (Suche, Export)');
  await showCulture(ku.id); await sleep(100);
  await snap('m12-kultur.png');
  ok(!$('#cult').hidden && $('#cult .amtbig').textContent == 'P13' && $('#cult .reghist').textContent.includes('P12 → P13') && $('#cult .reghist .elink'), 'Kulturansicht: P13, Verlauf mit Link zum Eintrag');
  document.querySelector('#cult [data-cev="myco"]').click(); await sleep(100);
  $('#ceResult').value = 'negativ'; $('#ceSave').click(); await sleep(300);
  ok(/negativ/.test($('#cult .reghist').textContent) && !$('#locdlg').open, 'Mycoplasma-Test negativ über den Dialog verbucht');
  const tank = await call('saveLocation', {name: 'Stickstofftank', kind: 'box', rows: 10, cols: 10, temp: '−196 °C'});
  document.querySelector('#cult [data-cev="freeze"]').click(); await sleep(150);
  $('#ceCount').value = '3'; $('#ceLoc').value = String(tank); $('#cePos').value = 'C4'; $('#ceSave').click(); await sleep(300);
  await showCultures('frozen'); await sleep(100);
  const frow = document.querySelector('#cult [data-thaw]')?.closest('tr');
  ok(frow && /P13/.test(frow.textContent) && /Stickstofftank · C4/.test(frow.textContent) && frow.children[4].textContent == '3', 'Einfrierliste: 3 Röhrchen P13 im Tank C4');
  await snap('m12-einfrierliste.png');
  const keepPrompt = window.prompt; window.prompt = () => 'HeLa aufgetaut';
  frow.querySelector('[data-thaw]').click(); await sleep(500);
  window.prompt = keepPrompt;
  ok(/HeLa aufgetaut/.test($('#cult .reghead h2').textContent) && $('#cult .amtbig').textContent == 'P13' && /Aufgetaut/.test($('#cult .reghist').textContent), 'Auftauen legt neue Kultur P13 an');
  ok((await call('frozenStock'))[0].amount == 2, 'Ein Röhrchen weniger in der Einfrierliste');
  await call('saveCulture', {values: {name: 'CHO alt', passage: 5, day: '2026-01-02', myco_days: 30}});
  const care1 = await refreshCareBadges();
  ok(care1.cultures == 1 && $('#cultBadge').textContent == '1', 'Überfälliger Mycoplasma-Test wird in der Seitenleiste gemeldet');
  await showEntity(hela.id); await sleep(200);
  ok(document.querySelectorAll('#entCults [data-cult]').length == 2, 'Zelllinie HeLa zeigt ihre zwei Kulturen');

  const zent = await call('saveDevice', {values: {name: 'Zentrifuge 5424', model: 'Eppendorf 5424', serial: 'Z-77'}});
  await call('saveDeviceTask', {device: zent.id, values: {kind: 'kalibrierung', interval: '365', next_due: '2026-01-15'}});
  const care2 = await refreshCareBadges();
  ok(care2.devices == 1 && !$('#devBadge').hidden, 'Fällige Kalibrierung wird gemeldet');
  await showDevices(); devFilter = 'warnings'; await renderDevices(); await sleep(100);
  ok(document.querySelectorAll('#dev tr[data-dev]').length == 1 && /überfällig/.test($('#dev tr[data-dev]').textContent), 'Geräteliste „Nur fällige“ zeigt die überfällige Zentrifuge');
  await snap('m12-geraete.png');
  devFilter = 'all';
  await showDevice(zent.id); await sleep(100);
  document.querySelector('#dev [data-taskdone]').click(); await sleep(150);
  $('#gNote').value = 'Drehzahl geprüft, Zertifikat 2026-118'; $('#gSave').click(); await sleep(300);
  const zentAfter = await call('device', {id: zent.id});
  ok(zentAfter.warnings.length == 0 && zentAfter.tasks[0].next_due > today() && /Zertifikat/.test($('#dev .reghist').textContent), 'Kalibrierung erledigt: nicht mehr fällig, im Protokoll');
  ok($('#devBadge').hidden, 'Meldung in der Seitenleiste verschwindet');
  document.querySelector('#dev [data-dlog="stoerung"]').click(); await sleep(150);
  $('#gNote').value = 'Unwucht'; $('#gSave').click(); await sleep(300);
  ok(/defekt/.test($('#dev .reghead').textContent) && (await refreshCareBadges()).devices == 1, 'Störung: Gerät als defekt gemeldet');
  await snap('m12-geraet.png');
  const devLab = await labelFor('device', zent.id);
  showView('doc');
  ok(await openCode(devLab.url) && !$('#dev').hidden && $('#dev .reghead h2').textContent.includes('Zentrifuge'), 'Etikett am Gerät öffnet das Gerätebuch');
  showView('doc');
  $('#search').value = ku13.code; $('#search').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await sleep(300);
  ok(!$('#cult').hidden && $('#cult .reghead h2').textContent.includes(ku13.code), 'Handscanner: Kulturcode öffnet die Kultur');
  showView('doc');

  // M13: Bestellungen und Wareneingang
  const tryp = await call('saveLot', {values: {name: 'Trypsin-EDTA', amount: '10', unit: 'ml', min: '20', supplier: 'Gibco', catalog: '25300-054'}});
  const oc0 = await refreshOrderBadge();
  ok(oc0.suggestions >= 1 && !$('#orderBadge').hidden, `Knappe Chargen ohne Bestellung in der Seitenleiste (${oc0.suggestions})`);
  await showOrders(); await sleep(100);
  const sbtn = document.querySelector(`#orders [data-osugg="${tryp.id}"]`);
  ok(!!sbtn, 'Trypsin steht unter „Knapp und nicht bestellt“');
  sbtn.click(); await sleep(150);
  $('#oQty').value = '2'; $('#oAmt').value = '100'; $('#oPrice').value = '38,50 €'; $('#oSave').click(); await sleep(300);
  const orow = [...document.querySelectorAll('#orders tr[data-order]')].find(r => r.textContent.includes('Trypsin'));
  ok(orow && /2 × 100 ml/.test(orow.textContent) && /offen/.test(orow.textContent) && !document.querySelector(`#orders [data-osugg="${tryp.id}"]`), 'Knappes Reagenz auf der Bestellliste (2 × 100 ml, offen)');
  orow.querySelector('[data-ostat="bestellt"]').click(); await sleep(250);
  const orow2 = [...document.querySelectorAll('#orders tr[data-order]')].find(r => r.textContent.includes('Trypsin'));
  ok(/bestellt/.test(orow2.textContent), 'Status „bestellt“');
  const ocsv = await ordersCSV();
  const ocsvText = ocsv ? await call('testReadText', {path: ocsv.path.split('/').pop()}) : '';
  ok(/Trypsin-EDTA;2;100;ml;Gibco;25300-054;38,50 €;bestellt/.test(ocsvText), 'Bestellliste als CSV');
  orow2.querySelector('[data-orecv]').click(); await sleep(200);
  ok($('#rAmt').value == '200', 'Eingang schlägt 200 ml vor');
  $('#rLotNo').value = '2611A'; $('#rExp').value = '2027-06-30'; $('#rLoc').value = String(fr); $('#rSave').click(); await sleep(400);
  const recvLot = (await call('lots', {q: 'Trypsin'})).find(l => l.lot_no == '2611A');
  ok(recvLot && recvLot.amount == 200 && !$('#stock').hidden && $('#stock .reghead h2').textContent.includes(recvLot.code), 'Eingang verbucht neue Charge (200 ml, Ch. 2611A) und öffnet sie');
  ok(!(await call('lot', {id: tryp.id})).warnings.includes('low') && !(await call('purchaseSuggestions')).some(x => x.name == 'Trypsin-EDTA'), 'Altes Trypsin nicht mehr knapp, kein Vorschlag mehr');
  orderFilter = 'all'; await showOrders(); await sleep(100);
  ok(/geliefert/.test([...document.querySelectorAll('#orders tr[data-order]')].find(r => r.textContent.includes('Trypsin')).textContent), 'Erledigte Bestellung mit Status „geliefert“ und neuer Charge');
  await call('testSnapshot', {name: 'm13-bestellungen.png'}).catch(() => {});
  orderFilter = 'open';
  showView('doc');

  // M14: Sequenzen
  const plT = (await call('types')).find(t => t.prefix == 'PL');
  const seqS = 'CCGAATTCGG' + 'ATGAAA' + 'GCT'.repeat(110) + 'TAA' + 'GGAAGCTTCC' + 'A'.repeat(200);
  const gbText = Bio.toGenBank({name: 'pSelbst', seq: seqS, circular: true, features: [{type: 'CDS', label: 'testA', start: 11, end: 349, strand: 1},
    {type: 'promoter', label: 'pRev', start: 400, end: 450, strand: -1}]});
  regType = plT.id; await showEntity('new'); await sleep(100);
  importSeqText('sequence', gbText, 'pSelbst.gb');
  ok(document.querySelector('#entform [data-field="sequence"]').value.length == 559 && document.querySelector('#entform [data-name]').value == 'pSelbst'
    && document.querySelector('#entform [data-field="size"]').value == '559' && /559 bp, ringförmig, 2 Feature/.test(document.querySelector('#entform .seqnote').textContent), 'GenBank-Import füllt Sequenz und Name (559 bp, ringförmig, 2 Features)');
  const pSelbst = await saveEntityForm(); await sleep(200);
  const panel = document.querySelector('#reg .seqpanel');
  ok(panel && panel.querySelector('svg.ring') && panel.querySelectorAll('.feattab tr').length == 3 && /559 bp · ringförmig/.test(panel.querySelector('.seqbar').textContent),
    'Ringkarte mit beiden Features nach dem Speichern');
  const mi = panel.querySelector('[data-svmotif]'); mi.value = 'GAATTC'; mi.dispatchEvent(new Event('input', {bubbles: true})); await sleep(350);
  ok(/1 Treffer: 3/.test(document.querySelector('#reg [data-svhits]').textContent) && document.querySelectorAll('#reg .seqmap .hit').length == 1 && document.querySelector('#reg pre.seqtext mark')?.textContent == 'GAATTC',
    'Motivsuche: GAATTC einmal an Position 3, auf Karte und in den Basen markiert');
  document.querySelector('#reg [data-svorf]').click(); await sleep(100);
  ok(/ORF 112 aa/.test(document.querySelector('#reg .feattab').textContent), 'ORF-Suche findet das Leseraster (112 aa)');
  document.querySelector('#reg [data-svkeep]').click(); await sleep(300);
  ok((await call('seqAnnotation', {entity: pSelbst.id, field: 'sequence'})).features.length == 3, 'ORF als Feature übernommen');
  const fr1 = document.querySelector('#reg [data-svframe]'); fr1.value = '2'; fr1.dispatchEvent(new Event('change', {bubbles: true})); await sleep(100);
  ok((document.querySelector('#reg pre.seqtext .aa')?.textContent || '').replace(/\s/g, '').includes('MKAAA'), 'Übersetzung im Rahmen +2 (ORF ab Position 11: M K A …)');
  document.querySelector('#reg .seqmapbox').scrollIntoView(); await sleep(50);
  await call('testSnapshot', {name: 'm14-sequenz.png'}).catch(() => {});
  const gbOut = await exportSeq(document.querySelector('#reg .seqpanel'), 'gb');
  const reread = Bio.parseAny(await call('testReadText', {path: gbOut.path.split('/').pop()}))[0];
  ok(reread.seq == seqS && reread.circular && reread.features.length == 3, 'GenBank-Export wieder eingelesen: gleiche Sequenz, Ring, 3 Features');
  showView('doc');
  const sqEntry = await call('create', {title: 'Klonierung pSelbst'}); await refreshList(sqEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'seqref', attrs: {entity: pSelbst.id, field: 'sequence', label: `${pSelbst.code} pSelbst`, length: 559}}, {type: 'paragraph'}]});
  changed(); await flush(); await sleep(300);
  ok(document.querySelector('.seqblock svg.ring') && (await call('entity', {id: pSelbst.id})).used_in.some(u => u.id == sqEntry), 'Sequenz-Block im Eintrag zeigt die Karte; Objekt kennt den Eintrag');
  await showEntity(pSelbst.id); await sleep(100);
  const sqTa = document.querySelector('#entform [data-field="sequence"]'); sqTa.value += 'A';
  await saveEntityForm(); await sleep(200);
  ok(/Features veraltet/.test(document.querySelector('#reg .seqpanel .seqbar').textContent), 'Sequenz geändert: Features als veraltet gemeldet');

  // M15: Primer und Restriktion (pSelbst hat jetzt 560 bp: EcoRI schneidet nach 3, HindIII nach 352)
  const typeIn = async (sel, v) => { const i = document.querySelector(`#reg ${sel}`); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); await sleep(400); };
  await typeIn('[data-svenz]', 'ecori, HindIII');
  const fragText = [...document.querySelectorAll('#reg .digest .feattab td b')].map(b => b.textContent);
  ok(fragText.join(' + ') == '349 bp + 211 bp' && /EcoRI 3 · HindIII 352/.test(document.querySelector('#reg .digest').textContent), `Verdau EcoRI + HindIII: ${fragText.join(' + ')}`);
  ok(document.querySelectorAll('#reg svg.gel rect.band').length == LADDER.length + 2, 'Virtuelles Gel mit Leiter und zwei Banden');
  document.querySelector('#reg [data-svsingle]').click(); await sleep(150);
  const chips = [...document.querySelectorAll('#reg .enzchips .chip')].map(c => c.textContent);
  ok(chips.includes('EcoRI') && chips.includes('HindIII'), `Einzelschneider gefunden (${chips.length})`);
  await typeIn('[data-svprimer]', 'ATGAAAGCTGCTGCTGCTGC');
  const pb = document.querySelector('#reg .primerbox')?.textContent || '';
  ok(/20 nt · Tm \d+,?\d* °C/.test(pb) && /bindet 11–30 \(\+\)/.test(pb) && pb.includes(Calc.fmt(Bio.tm('ATGAAAGCTGCTGCTGCTGC'))), 'Primer: Tm (Nearest-Neighbor) und Bindestelle 11–30');
  document.querySelector('#reg .digest').scrollIntoView(); await sleep(50);
  await call('testSnapshot', {name: 'm15-verdau.png'}).catch(() => {});
  ok(/Tm ≈ 66,3 °C/.test(seqStats('CGTTCCAAAGATGTGGGCATGAGCTTAC')), 'Primer in der Registry: Tm wie Primer3 (66,3 °C)');
  showView('doc');

  // M16: Datenbank-Verweise (Netz im Test durch hinterlegte Antworten ersetzt)
  await call('testSetNet', {source: 'ncbi-nuccore', id: 'L09137', text: Bio.toGenBank({name: 'SYNPUC19CV', description: 'Cloning vector pUC19c, complete sequence.', seq: seqS, circular: true,
    features: [{type: 'CDS', label: 'bla', start: 11, end: 349, strand: 1}]})});
  await call('testSetNet', {source: 'uniprot', id: 'P04637', text: JSON.stringify({primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN', genes: [{geneName: {value: 'TP53'}}],
    proteinDescription: {recommendedName: {fullName: {value: 'Cellular tumor antigen p53'}}}, organism: {scientificName: 'Homo sapiens'}, sequence: {value: 'MEEPQSDPSV', length: 393}})});
  const dbEntry = await call('create', {title: 'Kennungen'}); await refreshList(dbEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Vektor L09137, mRNA NM_000546, p53 P04637, PMID: 2851488, Code PL-0001.'}]}]});
  changed(); await flush(); await sleep(900);
  const dls = [...document.querySelectorAll('#editor .dblink')];
  ok(dls.map(d => d.textContent).join('|') == 'L09137|NM_000546|P04637|PMID: 2851488', `Kennungen im Text werden Links: ${dls.map(d => d.textContent).join(', ')}`);
  dls[1].dispatchEvent(new MouseEvent('click', {bubbles: true, metaKey: true}));
  ok(OPENED.at(-1) == 'https://www.ncbi.nlm.nih.gov/nuccore/NM_000546', '⌘-Klick öffnet NM_000546 bei NCBI');
  ok(!$('#dbrefs').hidden && document.querySelectorAll('#dbrefs .dbref').length == 4 && document.querySelectorAll('#dbrefs [data-dbfetch]').length == 3, 'Liste „Datenbank-Verweise“ unter dem Eintrag');
  document.querySelector('#dbrefs [data-dbid="L09137"]').click(); await sleep(150);
  $('#dbType').value = String(plT.id); $('#dbGo').click(); await sleep(700);
  const fetched = (await call('entities', {type: plT.id})).find(x => x.name.startsWith('L09137'));
  const fAnn = fetched && await call('seqAnnotation', {entity: fetched.id, field: 'sequence'});
  ok(fetched && fAnn.circular && fAnn.features.length == 1 && fAnn.source == 'NCBI L09137' && !$('#reg').hidden && document.querySelector('#reg .seqpanel svg.ring'),
    'L09137 geholt: Plasmid mit Sequenz, Ring und Feature angelegt und geöffnet');
  showView('doc'); await open(dbEntry); await sleep(200);
  document.querySelector('#dbrefs [data-dbid="NM_000546"]').click(); await sleep(150);
  $('#dbGo').click(); await sleep(300);
  ok(/Keine Verbindung/.test($('#dbMsg').textContent) && $('#locdlg').open, `Ohne Netz verständliche Meldung: „${$('#dbMsg').textContent}“`);
  $('#locdlg').close();
  const prot = await dbImport('uniprot', 'P04637');
  const protE = await call('entity', {id: prot.id});
  ok(protE.type_name == 'Protein' && parseJSON(protE.fields_json, {}).gene == 'TP53' && /p53/.test(protE.name), 'UniProt P04637 als Protein (Gen TP53) angelegt');
  showView('doc');

  // M17: Diagramme und Statistik
  const cell = (t, h) => ({type: h ? 'tableHeader' : 'tableCell', content: [{type: 'paragraph', content: t === '' ? [] : [{type: 'text', text: String(t)}]}]});
  const bsaRows = [['BSA µg/ml', 'A595'], [0, '0'], [125, '0,095'], [250, '0,185'], [500, '0,350'], [750, '0,520'], [1000, '0,665'], [1500, '0,910'], [2000, '1,130']];
  const chEntry = await call('create', {title: 'Bradford'}); await refreshList(chEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'table', content: bsaRows.map((r, i) => ({type: 'tableRow', content: r.map(c => cell(c, i == 0))}))},
    {type: 'chart', attrs: {mode: 'curve', title: 'Bradford', unit: 'µg/ml', xlabel: 'BSA (µg/ml)', ylabel: 'A595'}}, {type: 'paragraph'}]});
  changed(); await flush(); await sleep(200);
  document.querySelector('.chartblock [data-cfrom]').click(); await sleep(150);
  const smpTa = document.querySelector('.chartblock [data-ck="samples"]');
  smpTa.focus(); smpTa.value = 'Probe A\t0,400\nProbe B\t0,512\t2'; smpTa.dispatchEvent(new Event('input', {bubbles: true}));
  $('#title').focus(); await sleep(150);
  const fitRef = Stats.linreg(bsaRows.slice(1).map(r => [r[0], r[1]]));
  const ctab = [...document.querySelectorAll('.chartblock .ctab tr')].map(tr => tr.textContent);
  ok(document.querySelectorAll('.chartblock svg.chart .pt').length == 8 && document.querySelectorAll('.chartblock svg.chart .smp').length == 2, 'Standardkurve aus der Tabelle darüber: 8 Standards, 2 Proben im Diagramm');
  ok(ctab[1].includes(Calc.fmt((0.4 - fitRef.intercept) / fitRef.slope)) && ctab[2].includes(Calc.fmt((0.512 - fitRef.intercept) / fitRef.slope * 2)) && /R² = 0,9904/.test(document.querySelector('.chartblock .chartout').textContent),
    `Unbekannte Proben gegen Handrechnung: A = ${Calc.fmt((0.4 - fitRef.intercept) / fitRef.slope)}, B = ${Calc.fmt((0.512 - fitRef.intercept) / fitRef.slope * 2)} µg/ml; R² = 0,9904`);
  await flush();
  ok(editor.getText().includes('R² = 0,9904') && editor.getHTML().includes('svg class="chart"'), 'Ergebnis steht im Text (Suche) und das Diagramm im Export');
  editor.chain().focus('end').insertContent([{type: 'chart', attrs: {mode: 'groups', title: 'Behandlung', unit: 'mg', data: 'Kontrolle\tBehandelt\n5,1\t6,2\n4,9\t6,8\n5,6\t6,1\n5,8\t7,0\n6,0\t6,6\n5,3\t'}}, {type: 'paragraph'}]).run();
  await sleep(200);
  const gBlock = [...document.querySelectorAll('.chartblock')].at(-1);
  ok(gBlock.querySelectorAll('svg.chart .bar').length == 2 && /p = 0,0016/.test(gBlock.textContent) && /\*\*/.test(gBlock.querySelector('.sig').textContent), 't-Test nach Welch: p = 0,0016 (wie scipy), Balken mit Fehlerbalken und Sternchen');
  gBlock.querySelector('svg').scrollIntoView(); await sleep(50);
  await call('testSnapshot', {name: 'm17-diagramm.png'}).catch(() => {});
  document.querySelector('.chartblock svg').scrollIntoView(); await sleep(50);
  await call('testSnapshot', {name: 'm17-kurve.png'}).catch(() => {});
  changed(); await flush();
  showView('doc');

  // M18: Literatur (Crossref/PubMed-Antworten wie echt, gekürzt)
  const doi = '10.1016/0378-1119(85)90120-9';
  await call('testSetNet', {source: 'crossref', id: doi, text: JSON.stringify({message: {DOI: doi, type: 'journal-article', title: ['Improved M13 phage cloning vectors and host strains: nucleotide sequences of the M13mpl8 and pUC19 vectors'],
    author: [{given: 'Celeste', family: 'Yanisch-Perron'}, {given: 'Jeffrey', family: 'Vieira'}, {given: 'Joachim', family: 'Messing'}], 'container-title': ['Gene'], issued: {'date-parts': [[1985, 1]]}, volume: '33', issue: '1', page: '103-119'}})});
  await call('testSetNet', {source: 'pubmed', id: '2985470', text: JSON.stringify({result: {uids: ['2985470'], 2985470: {uid: '2985470', title: 'Improved M13 phage cloning vectors.', authors: [{name: 'Yanisch-Perron C', authtype: 'Author'}],
    source: 'Gene', pubdate: '1985', volume: '33', issue: '1', pages: '103-19', articleids: [{idtype: 'doi', value: doi}]}}})});
  const bib = '@article{Sanger1977, author = {Sanger, F. and Nicklen, S. and Coulson, A. R.}, title = {{DNA} sequencing with chain-terminating inhibitors}, journal = {Proc. Natl. Acad. Sci. USA}, year = 1977, volume = {74}, pages = {5463--5467}, doi = {10.1073/pnas.74.12.5463}}\n'
    + '@article{mullis86, author = "Kary B. Mullis and Fred A. Faloona", title = "Specific synthesis of DNA in vitro", journal = {Methods Enzymol.}, year = {1987}, volume = {155}, pages = {335-350}}\n'
    + '@book{Sambrook, author = {Sambrook, J. and Russell, D. W.}, title = {Molecular Cloning}, year = {2001}}';
  const imp3 = await importReferenceText(bib, 'test.bib');
  await showLiterature(null); await sleep(100);
  ok(imp3.added == 3 && document.querySelectorAll('#lit tr[data-lit]').length == 3, 'BibTeX-Datei mit 3 Quellen importiert');
  $('#litfetch').value = doi; document.querySelector('#lit [data-litfetch]').click(); await sleep(400);
  const side = document.querySelector('#lit .regside')?.textContent || '';
  ok(/Yanisch-Perron et al\. 1985/.test(side) && /Gene 33\(1\):103–119/.test(side), 'DOI ergibt „Yanisch-Perron et al. 1985, Gene 33(1):103–119“');
  showView('doc');
  const litEntry = await call('create', {title: 'Klonierung mit pUC19 (Literatur)'}); await refreshList(litEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Vektor wie beschrieben. Vgl. PMID: 2985470.'}]}]});
  editor.commands.focus('end');
  for (const q of ['Yanisch', 'Sanger']) {
    citeDialog(); await sleep(150);
    const qi = $('#ciQ'); qi.value = q; qi.dispatchEvent(new Event('input')); await sleep(150);
    document.querySelector('#ciList [data-ci]').click(); await sleep(150);
  }
  changed(); await flush(); await sleep(900);
  ok(editor.getText().includes('(Yanisch-Perron et al. 1985)') && editor.getText().includes('(Sanger et al. 1977)') && document.querySelectorAll('#citebox li').length == 2,
    'Zitate im Text, Literaturliste unter dem Eintrag');
  const bibHTML = withBibliography(editor.getHTML());
  ok(/<h3>Literatur<\/h3><ol><li>Yanisch-Perron C, Vieira J, Messing J \(1985\)/.test(bibHTML) && /Sanger F, Nicklen S, Coulson AR \(1977\)/.test(bibHTML), 'Literaturliste im PDF/Export (Reihenfolge der Zitate)');
  const yRef = (await call('references', {q: 'Yanisch'}))[0];
  ok((await call('reference', {id: yRef.id})).cited_in.some(e => e.id == litEntry), 'Quelle kennt den zitierenden Eintrag');
  document.querySelector('#dbrefs [data-dblit="2985470"]').click(); await sleep(500);
  ok((await call('references')).length == 4 && /War schon in der Bibliothek/.test($('#status').textContent) && !$('#lit').hidden, 'PMID derselben Arbeit: als vorhanden erkannt (gleiche DOI)');
  document.querySelector('#lit [data-litexport]').click(); await sleep(300);
  const bibOut = Refs.parseBibTeX(await call('testReadText', {path: 'Literatur.bib'}));
  ok(bibOut.length == 4 && bibOut.some(r => r.doi == doi), 'Bibliothek als BibTeX exportiert und wieder lesbar');
  await call('testSnapshot', {name: 'm18-literatur.png'}).catch(() => {});
  showView('doc');

  // M19: Aufgaben und Termine
  const tday = Agenda.iso(new Date());
  const ti = (text, checked = false) => ({type: 'taskItem', attrs: {checked}, content: [{type: 'paragraph', content: [{type: 'text', text}]}]});
  const agEntry = await call('create', {title: 'Wochenplan'}); await refreshList(agEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'taskList', content: [ti('Antikörper bestellen bis morgen'), ti('Gel vom 2026-01-01 auswerten'), ti('Puffer ohne Datum'), ti('Erledigt heute', true)]}]});
  changed(); await flush(); await sleep(900);
  const dds = [...document.querySelectorAll('#editor .duedate')];
  ok(dds.length == 3 && dds[1].classList.contains('overdue') && dds[0].textContent == 'morgen' && dds[2].classList.contains('done'), 'Termine in der Checkliste markiert (überfällig rot, erledigt durchgestrichen)');
  const zentDev = (await call('devices', {})).find(d => d.name.startsWith('Zentrifuge'));
  await call('saveDeviceTask', {device: zentDev.id, values: {kind: 'wartung', interval: '90', next_due: Agenda.addDays(tday, 3)}});
  await call('saveLot', {values: {name: 'Ampicillin-Stock', amount: '5', unit: 'ml', expiry: Agenda.addDays(tday, 5)}});
  await showAgenda(); await sleep(150);
  const agText = $('#agenda').textContent, overdueText = document.querySelector('#agenda .aglist')?.textContent || '';
  ok(/Antikörper bestellen bis morgen/.test(agText) && /Wartung: Zentrifuge/.test(agText) && /Läuft ab: Ampicillin-Stock/.test(agText) && !/Puffer ohne Datum|Erledigt heute/.test(agText),
    'Übersicht: Aufgabe, fällige Wartung und ablaufende Charge; ohne Datum und Erledigtes nicht');
  ok(/Gel vom 2026-01-01 auswerten/.test(overdueText) && /Mycoplasma-Test: CHO alt/.test(overdueText) && /Läuft ab: Alter Puffer/.test(overdueText), 'Überfällig: alte Aufgabe, Mycoplasma-Test, abgelaufene Charge');
  ok(!$('#agendaBadge').hidden && +$('#agendaBadge').textContent >= 3, `Seitenleiste meldet ${$('#agendaBadge').textContent} fällige Punkte`);
  await call('testSnapshot', {name: 'm19-faellig.png'}).catch(() => {});
  const icsOut = await agendaICS();
  const icsText = await call('testReadText', {path: icsOut.path.split('/').pop()});
  ok((icsText.match(/BEGIN:VEVENT/g) || []).length >= 6 && icsText.includes('SUMMARY:Antikörper bestellen bis morgen') && icsText.includes(`DTSTART;VALUE=DATE:${Agenda.addDays(tday, 1).replace(/-/g, '')}`),
    'Kalenderdatei (.ics) mit allen Terminen');
  [...document.querySelectorAll('#agenda .agrow')].find(r => r.textContent.includes('Antikörper')).click(); await sleep(300);
  ok(cur == agEntry && !$('#doc').hidden, 'Klick auf die Aufgabe öffnet den Eintrag');
  showView('doc');

  // M20: Gerätedateien (Testdateien wie typische Exporte)
  const R8 = 'ABCDEFGH', pval = (r, c) => +(0.05 + 0.1 * r + 0.01 * c).toFixed(3);
  const gridCSV = ['Application: Tecan i-control', 'Measurement Wavelength;595;nm', '', '<>;' + [...Array(12)].map((_, c) => c + 1).join(';'),
    ...[...R8].map((L, r) => L + ';' + [...Array(12)].map((_, c) => pval(r, c + 1).toFixed(3).replace('.', ',')).join(';'))].join('\r\n');
  const dfEntry = await call('create', {title: 'Bradford-Platte'}); await refreshList(dfEntry);
  editor.commands.setContent({type: 'doc', content: [{type: 'plate', attrs: {format: 96, samples: [{name: 'Blank', color: PLATE_COLORS[0]}, {name: 'Standard', color: PLATE_COLORS[1]}],
    wells: {A1: 0, A2: 0, A3: 0, B1: 1, B2: 1, B3: 1}}}, {type: 'paragraph'}]});
  changed(); await flush(); await sleep(150);
  document.querySelector('.plate [data-pimport]').click();
  DEVFILE_TARGET.apply(gridCSV, 'messung.csv'); await sleep(200);
  const heatCells = [...document.querySelectorAll('.plate td[data-well]')].filter(td => td.style.background.startsWith('rgb'));
  ok(heatCells.length == 96 && document.querySelector('.plate [data-well="H12"] .pv')?.textContent == '0,87', 'Plattenleser-Export: 96 Werte als Heatmap (H12 = 0,87)');
  ok(/Blank: 0,07 ± 0,01 \(n = 3\); Standard: 0,17 ± 0,01 \(n = 3\)/.test(document.querySelector('.plate .psum').textContent) && /595 nm/.test(document.querySelector('.plate .pscale').textContent),
    'Mittelwert ± SD je Probe aus den Messwerten, Wellenlänge erkannt');
  await flush();
  ok(/Messwerte: Blank: 0,07/.test(editor.getText()) && editor.getHTML().includes('>0,87</td>'), 'Messwerte im Text und im PDF-Export');
  await call('testSnapshot', {name: 'm20-platte.png'}).catch(() => {});
  const ndTSV = 'Sample ID\tUser name\tDate\tTime\tNucleic Acid(ng/uL)\tA260 (Abs)\tA280 (Abs)\t260/280\t260/230\tSample Type\tFactor\n'
    + 'Klon 1\tfelix\t23.10.2026\t10:01\t250.4\t5.008\t2.703\t1.85\t2.10\tDNA\t50.00\nKlon 2\tfelix\t23.10.2026\t10:02\t312.9\t6.258\t3.384\t1.85\t2.21\tDNA\t50.00\n';
  const qpcrCSV = 'Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev\nA01,SYBR,GAPDH,Unkn,Kontrolle,,18.12,,\nA02,SYBR,GAPDH,Unkn,Kontrolle,,18.20,,\n'
    + 'A03,SYBR,IL6,Unkn,Kontrolle,,27.40,,\nA04,SYBR,IL6,Unkn,Kontrolle,,27.62,,\nC01,SYBR,IL6,Unkn,NTC,,NaN,,\n';
  const qT = RESULT_SCHEMAS.find(x => x.name == 'qPCR');
  editor.commands.setContent({type: 'doc', content: [{type: 'results', attrs: {schema: prep.id, rows: [{}]}}, {type: 'results', attrs: {schema: qT.id, rows: [{}]}}, {type: 'paragraph'}]});
  await sleep(150);
  document.querySelector('.results [data-rdev="nanodrop"]').click();
  DEVFILE_TARGET.apply(ndTSV, 'nanodrop.tsv'); await sleep(200);
  const ndRows = [...document.querySelectorAll('.results')[0].querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('[data-k]')].map(i => i.value));
  ok(ndRows.length == 2 && ndRows[0][0] == 'Klon 1' && ndRows[0][1] == '250,4' && ndRows[1][2] == '1,85', 'NanoDrop-Export füllt die Plasmid-Präp-Tabelle (2 Proben)');
  document.querySelector('.results [data-rdev="qpcr"]').click();
  DEVFILE_TARGET.apply(qpcrCSV, 'qpcr.csv'); await sleep(200);
  const qb = document.querySelectorAll('.results')[1];
  ok(qb.querySelectorAll('tbody tr').length == 1 && qb.querySelector('[data-k="gen"]').value == 'IL6' && qb.querySelector('[data-fk="dct"]').textContent == '9,35',
    'qPCR-Export: Replikate gemittelt, GAPDH als Referenz, ΔCt = 27,51 − 18,16 = 9,35');
  changed(); await flush();
  showView('doc');

  // M21: Chemie
  const chEntry2 = await call('create', {title: 'Tris-Puffer ansetzen'}); await refreshList(chEntry2);
  editor.commands.setContent(''); insertChem(); await sleep(100);
  const cb = document.querySelector('.chemblock');
  cb.querySelector('[data-cname]').value = 'Tris'; cb.querySelector('[data-cname]').dispatchEvent(new Event('change', {bubbles: true}));
  const si = cb.querySelector('[data-csmiles]'); si.value = 'OCC(N)(CO)CO'; si.dispatchEvent(new Event('change', {bubbles: true})); await sleep(600);
  const cb2 = document.querySelector('.chemblock');
  ok(cb2.querySelector('.chemfacts .hill')?.textContent == 'C4H11NO3' && /121,14 g\/mol/.test(cb2.querySelector('.chemfacts').textContent), 'SMILES von Tris: C4H11NO3, 121,14 g/mol');
  ok(!!cb2.querySelector('.chempic svg') && editor.getJSON().content[0].attrs.svg.startsWith('<svg'), 'Strukturbild gezeichnet und für den Druck gespeichert');
  const probeSub = Object.assign(document.createElement('span'), {className: 'sub', textContent: 'x'}); document.body.appendChild(probeSub);
  const subSize = parseFloat(getComputedStyle(probeSub).fontSize); probeSub.remove();
  ok(subSize >= 10, `Stil des Strukturbilds bleibt im Bild (.sub anderswo ${subSize}px, nicht 5 pt)`);
  cb2.querySelector('[data-cweigh]').click(); await sleep(200);
  const calcNode = editor.getJSON().content.find(n => n.type == 'calc');
  ok(calcNode?.attrs.kind == 'molarity' && calcNode.attrs.data.mw.v == '121,14', 'Einwaage-Rechner übernimmt die Molmasse 121,14 g/mol');
  changed(); await flush();
  ok(/Tris: OCC\(N\)\(CO\)CO \(C4H11NO3, 121,14 g\/mol\)/.test(editor.getText()) && editor.getHTML().includes('C<sub>4</sub>H<sub>11</sub>NO<sub>3</sub>'), 'Struktur im Text (Suche) und im Export');
  const chType = (await call('types')).find(t => t.prefix == 'CH');
  const tris = await call('createEntity', {type: chType.id, name: 'Tris', values: {smiles: 'OCC(N)(CO)CO', cas: '77-86-1'}});
  await showEntity(tris.id); await sleep(500);
  ok(/C4H11NO3 · 121,14 g\/mol/.test(document.querySelector('#reg .chempanel').textContent) && document.querySelector('#reg .chempanel svg'), 'Chemikalie in der Registry zeigt Struktur, Formel und Molmasse');
  document.querySelector('#reg [data-chemmw]').click(); await sleep(400);
  ok(parseJSON((await call('entity', {id: tris.id})).fields_json, {}).mw == '121,14' && !document.querySelector('#reg [data-chemmw]'), 'Molmasse ins Feld übernommen');
  await call('testSnapshot', {name: 'm21-chemie.png'}).catch(() => {});
  showView('doc');

  // M22: AppleScript, Kurzbefehle (laborbuch://), Dienste
  const as = await call('testAppleScript', {source: `tell current application
    set n to «event LBokCrEn» given «class titl»:"Aus AppleScript", «class ctxt»:"Zeile 1"
    «event LBokApTx» "Zeile 2" given «class entr»:n
    set t to «event LBokGtTx» n
    set f to «event LBokFind» "AppleScript"
  end tell
  return {n, t, f}`});
  ok(Number.isInteger(as[0]) && /Aus AppleScript\n\nZeile 1\nZeile 2/.test(as[1]) && as[2].includes(`${as[0]}: Aus AppleScript`), 'AppleScript: Eintrag anlegen, Text anhängen, lesen, suchen');
  let asErr = '';
  try { await call('testAppleScript', {source: `tell current application to «event LBokApTx» "x" given «class entr»:${signedOne.id}`}); } catch (e) { asErr = e.message; }
  ok(/abgeschlossen/.test(asErr), 'AppleScript schreibt nicht in abgeschlossene Einträge');
  await call('testOpenURL', {url: 'laborbuch://new?title=Kurzbefehl&text=' + encodeURIComponent('Erste Zeile\nZweite Zeile')}); await sleep(500);
  const kbId = cur;
  ok($('#title').value == 'Kurzbefehl' && editor.getText().includes('Zweite Zeile'), 'laborbuch://new legt einen Eintrag an und öffnet ihn');
  await call('testOpenURL', {url: `laborbuch://append?id=${kbId}&text=${encodeURIComponent('Messung 42')}`}); await sleep(500);
  ok(cur == kbId && editor.getText().includes('Messung 42'), 'laborbuch://append hängt Text an, das offene Fenster zeigt ihn');
  await call('testOpenURL', {url: 'laborbuch://search?q=Kurzbefehl'}); await sleep(400);
  ok($('#search').value == 'Kurzbefehl' && document.querySelector(`#list li[data-id="${kbId}"]`), 'laborbuch://search sucht im Laborbuch');
  $('#search').value = ''; await refreshList();
  const svcMsg = await call('testService', {text: 'Notiz aus Safari\nmit zweiter Zeile'}); await sleep(500);
  ok(!svcMsg && $('#title').value == 'Notiz aus Safari' && editor.getText().includes('mit zweiter Zeile'), 'Dienst „Neuer Laborbuch-Eintrag“ übernimmt markierten Text');
  showView('doc');

  // M23: KI-Assistent (Antworten im Test hinterlegt, kein Netz, nie der echte Schlüsselbund)
  await refreshAI();
  ok(!AI_ON && !insertItems().some(i => i.icon == '✨') && document.querySelector('#stockNav [data-stock="ask"]').hidden, 'Ohne Schlüssel ist der Assistent unsichtbar');
  ok($('#aiBtn').hidden, 'KI-Assistent in der Fußzeile: ohne Schlüssel unsichtbar');
  let keyErr = ''; try { await call('aiSetKey', {key: 'geheim'}); } catch (e) { keyErr = e.message; }
  await call('aiSetKey', {key: 'sk-ant-test-0000'}); await refreshAI();
  ok(/sk-ant-/.test(keyErr) && AI_ON && insertItems().some(i => i.label == 'Zusammenfassen') && !document.querySelector('#stockNav [data-stock="ask"]').hidden, 'Mit Schlüssel erscheinen Zusammenfassen, Protokoll und „Fragen“');
  ok(!$('#aiBtn').hidden && getComputedStyle($('#aiBtn')).display != 'none' && $('#aiBtn').compareDocumentPosition($('#histBtn')) & Node.DOCUMENT_POSITION_FOLLOWING, 'KI-Assistent in der Fußzeile: mit Schlüssel sichtbar, links neben „Verlauf“');
  const reply = text => call('testAiReply', {reply: {model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {input_tokens: 120, output_tokens: 40},
    content: [{type: 'thinking', thinking: ''}, {type: 'text', text}]}});
  const prepEntries = await call('search', {q: 'Plasmid-Präp'});
  await open(prepEntries[0].id); await sleep(200);
  await reply('- Ziel: Plasmid isolieren\n- Ausbeute **12,5 µg**');
  await aiSummary(); await sleep(100);
  const sumReq = await call('testAiLastRequest');
  ok(!$('#aibox').hidden && $('#aibox .aibody').innerHTML.includes('<b>12,5 µg</b>') && !$('#aibox').textContent.includes('thinking'), 'Zusammenfassung erscheint unter dem Eintrag (nur Text, ohne Denkblock)');
  ok(sumReq.model == 'claude-opus-5-5' && sumReq.fallbacks == 'default' && sumReq.output_config.effort == 'medium' && sumReq.user === undefined && sumReq.messages[0].content.startsWith(`Titel: ${$('#title').value}`),
    'Anfrage: claude-opus-5-5, Fallback bei Ablehnung, nur dieser Eintrag');
  window.AI_CONFIRM = false; await reply('sollte nicht kommen'); const canon = v => JSON.stringify(v, (k, x) => x && typeof x == 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);  // Reihenfolge der Schlüssel egal
  const reqBefore = canon(await call('testAiLastRequest'));
  await aiSummary();
  ok(canon(await call('testAiLastRequest')) == reqBefore, 'Ohne Bestätigung in der Vorschau wird nichts gesendet');
  window.AI_CONFIRM = true;
  await reply('- Ziel: Plasmid isolieren\n- Ausbeute **12,5 µg**'); await aiSummary(); await sleep(50);
  document.querySelector('#aibox [data-aiinsert]').click(); await sleep(100);
  ok(/KI-Zusammenfassung \(Claude, .*\) – bitte prüfen/.test(editor.getText()) && editor.getText().includes('Ausbeute 12,5 µg'), 'Zusammenfassung lässt sich als markierter Abschnitt übernehmen');
  editor.commands.undo(); await flush();
  const srcId = prepEntries[0].id;
  await reply(`Die Ausbeute lag bei 12,5 µg [E${srcId}]; [E999999] gibt es nicht.`);
  await showAsk(); $('#askq').value = 'Plasmid-Präp Ausbeute';
  await aiAsk($('#askq').value); await sleep(100);
  const askReq = await call('testAiLastRequest');
  ok(document.querySelector(`#aianswer a.aicite[data-entry="${srcId}"]`) && !document.querySelector('#aianswer a[data-entry="999999"]') && /Quellen: /.test($('#aianswer').textContent),
    'Frage an das Laborbuch: Antwort mit Verweis auf den Eintrag, erfundene Kennung kein Link');
  ok((askReq.messages[0].content.match(/<eintrag id="E/g) || []).length <= 8 && askReq.messages[0].content.includes(`id="E${srcId}"`), 'Mitgesendet: höchstens 8 gefundene Einträge');
  await call('testAiReply', {reply: {model: 'claude-opus-5-5', stop_reason: 'refusal', content: [], usage: {}}});
  let aiRefused = ''; try { await call('aiAsk', {system: 'x', user: 'y'}); } catch (e) { aiRefused = e.message; }
  ok(/abgelehnt/.test(aiRefused), 'Ablehnung durch Claude wird verständlich gemeldet');
  await call('aiSetKey', {key: null}); await refreshAI();
  ok(!AI_ON && document.querySelector('#stockNav [data-stock="ask"]').hidden, 'Schlüssel entfernt: Assistent wieder unsichtbar');
  ok($('#aiBtn').hidden, 'KI-Assistent in der Fußzeile: ohne Schlüssel unsichtbar (nach Entfernen)');
  showView('doc');

  // M24: Erweiterungen (abgeschottet im Worker eines Sandbox-Rahmens)
  const inst = await call('installExampleExtensions');
  await loadExtensions();
  ok(inst.includes('Zellzahl.js') && EXT.has('zellzahl') && insertItems().some(i => /Zellzahl/.test(i.label)), 'Beispiel-Erweiterung (Zellzahl) installiert und geladen');
  const exEntry = await call('create', {title: 'Zellen zählen'}); await refreshList(exEntry);
  editor.commands.setContent(''); insertExtBlock('zellzahl', 'neubauer'); await sleep(300);
  const xb = document.querySelector('.extblock');
  const setX = (k, v) => { const i = xb.querySelector(`[data-xk="${k}"]`); i.focus(); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); };
  setX('lebend', '150'); setX('tot', '20'); setX('volumen', '10'); await sleep(300);
  $('#title').focus(); await sleep(400);
  const xr = editor.getJSON().content.find(n => n.type == 'extblock')?.attrs.result || [];
  ok(xr[0]?.value == 750000 && Math.abs(xr[1]?.value - 88.235) < 0.01 && xr[2]?.value == 7.5e6 && /7,50 × 10⁶\s*Zellen/.test(document.querySelector('.extblock').textContent),
    'Zellzahl: 150 Zellen in 4 Quadraten × 2 → 7,50 × 10⁵/ml, Viabilität 88,2 %, gesamt 7,50 × 10⁶');
  changed(); await flush();
  ok(editor.getText().includes('Lebende Zellen: 7,50 × 10⁵ Zellen/ml'), 'Ergebnis steht im Text des Eintrags');
  await call('testWriteExtension', {file: 'kaputt.js', code: 'laborbuch.register({id: "kaputt", blocks: [}'});
  await call('testWriteExtension', {file: 'schleife.js', code: 'laborbuch.register({id: "schleife", name: "Schleife", blocks: [{id: "b", title: "Hängt", fields: [], compute() { while (true) {} }}]});'});
  await call('testWriteExtension', {file: 'netz.js', code: 'fetch("lab://app/index.html").then(() => laborbuch.register({id: "netz", blocks: []}));'});
  await call('testWriteExtension', {file: 'bruecke.js', code: 'webkit.messageHandlers.lab.postMessage({cmd: "list"}).then(() => laborbuch.register({id: "bruecke", blocks: []}));'});
  await loadExtensions(); await sleep(300);
  ok(EXT_ERRORS.some(e => e.file == 'kaputt.js') && EXT.has('zellzahl') && EXT.has('schleife') && !EXT.has('netz') && !EXT.has('bruecke'),
    'Kaputte Erweiterung gemeldet; Netz und App-Brücke sind für Erweiterungen nicht erreichbar');
  let ticks = 0; const tick = setInterval(() => ticks++, 50);
  const t0 = Date.now(); let loopErr = '';
  try { await extCompute('schleife', 'b', {}); } catch (e) { loopErr = e.message; }
  clearInterval(tick);
  // Im verborgenen Testfenster drosselt WebKit Zeitgeber (~250 ms); dass der Abbruch-Zeitgeber pünktlich feuert, zeigt schon: der Hauptfaden blieb frei
  ok(/zu lange/.test(loopErr) && Date.now() - t0 < 2500 && ticks >= 3, `Endlosschleife wird nach ${Date.now() - t0} ms abgebrochen, die App blieb bedienbar (${ticks} Takte)`);
  ok((await extCompute('zellzahl', 'neubauer', {lebend: '100', quadrate: '4', verd: '1'}))[0].value == 250000, 'Andere Erweiterungen rechnen danach weiter');
  const guard = await new Promise(res => {
    const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.hidden = true;
    f.srcdoc = `<script>try { window.webkit.messageHandlers.lab.postMessage({cmd: "list"}).then(r => parent.postMessage({leak: true}, "*"), e => parent.postMessage({err: String(e)}, "*")); } catch (e) { parent.postMessage({err: String(e)}, "*"); }<\/script>`;
    const on = e => { if (e.source === f.contentWindow) { removeEventListener('message', on); f.remove(); res(e.data); } };
    addEventListener('message', on); document.body.appendChild(f); setTimeout(() => res({timeout: true}), 2000);
  });
  ok(!guard.leak && (guard.err || guard.timeout), `Eingebettete Rahmen erreichen die App-Brücke nicht (${guard.err || 'keine Antwort'})`);
  await call('setExtensionEnabled', {file: 'Zellzahl.js', enabled: false}); await loadExtensions();
  showView('doc'); cur = null; await open(exEntry); await sleep(200);
  ok(!EXT.has('zellzahl') && /Erweiterung fehlt/.test(document.querySelector('.extblock').textContent) && /7,50 × 10⁶/.test(document.querySelector('.extblock').textContent),
    'Ausgeschaltet: Block zeigt das gespeicherte Ergebnis weiter');
  await call('setExtensionEnabled', {file: 'Zellzahl.js', enabled: true}); await loadExtensions();
  await call('testSnapshot', {name: 'm24-erweiterung.png'}).catch(() => {});
  showView('doc');

  // M25: Laufendes Laborbuch mit Tagesabschnitten
  const tday25 = Days.iso(new Date());
  const para = t => ({type: 'paragraph', content: [{type: 'text', text: t}]});
  const lbId = await call('create', {title: 'Nanoreactor Lab Book'}); await refreshList(lbId);
  editor.commands.setContent({type: 'doc', content: [{type: 'day', attrs: {date: '2026-06-30'}, content: [para('Oligo annealing nach Protokoll')]},
    {type: 'day', attrs: {date: '2026-07-01'}, content: [para('Trafo E. coli')]}, {type: 'day', attrs: {date: '2026-10-15'}, content: [para('Golden Gate Ligation, Kolonie Zebrafink')]}]});
  changed(); await flush(); await sleep(100);
  const dayHeads = [...document.querySelectorAll('#editor section.day .daylabel')].map(x => x.textContent);
  ok(dayHeads.length == 3 && dayHeads[0] == '📅 Dienstag, 30.6.2026', `Tagesabschnitte im Eintrag (${dayHeads[0]})`);
  addToday(); await sleep(50); addToday(); await sleep(50);
  const dates = editor.getJSON().content.filter(n => n.type == 'day').map(n => n.attrs.date);
  const $sel = editor.state.selection.$from; let inToday = false;
  for (let d = $sel.depth; d > 0; d--) if ($sel.node(d).type.name == 'day' && $sel.node(d).attrs.date == tday25) inToday = true;
  ok(dates.length == 4 && dates[3] == tday25 && inToday, '„+ Heute“ legt den Tag einmal an und setzt den Cursor hinein');
  editor.commands.insertContent('heute: Midi-Präp'); changed(); await flush(); await refreshList();
  const lbLi = document.querySelector(`#list li[data-id="${lbId}"] .m`)?.textContent || '';
  ok(lbLi.includes(`📅 ${Days.rangeLabel('2026-06-30', tday25)}`), `Liste zeigt den Zeitraum (${Days.rangeLabel('2026-06-30', tday25)})`);
  const third = document.querySelectorAll('#editor section.day')[2];
  third.querySelector('.dayhead').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  ok(third.classList.contains('collapsed') && getComputedStyle(third.querySelector('.daybody')).display == 'none', 'Tag lässt sich einklappen');
  await open(signedOne.id); await sleep(100);
  $('#search').value = 'Zebrafink'; await refreshList(); await sleep(100);
  document.querySelector(`#list li[data-id="${lbId}"]`).click(); await sleep(400);
  const selTxt = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
  ok(cur == lbId && selTxt.toLowerCase() == 'zebrafink' && !document.querySelectorAll('#editor section.day')[2].classList.contains('collapsed'), 'Suchtreffer im dritten Tag wird angesprungen (Tag klappt auf)');
  $('#search').value = ''; await refreshList();
  const lbHTML = editor.getHTML(), lbMD = MD.toMarkdown(editor.getJSON(), {dayLabel: Days.dayLabel});
  ok(lbHTML.includes('<section data-day="2026-06-30" class="day"><h3 class="dayhead">Dienstag, 30.6.2026</h3>') && lbMD.includes('## Mittwoch, 1.7.2026\n\nTrafo E. coli'), 'Tage im PDF/HTML und im Markdown-Export');
  await call('testSnapshot', {name: 'm25-tage.png'}).catch(() => {});
  showView('doc');

  // M26: Protokolle am Eintrag, Metadaten, Verknüpft
  const ggId = await call('create', {title: 'Golden Gate Assembly', kind: 'protocol'});
  await open(ggId); editor.commands.setContent({type: 'doc', content: [{type: 'orderedList', content: ['BsaI 1 µl', '30 Zyklen 37 °C / 16 °C'].map(t => ({type: 'listItem', content: [para(t)]}))}]});
  changed(); await flush();
  await open(lbId); await sleep(150);
  ok([...document.querySelectorAll('#etabs .etab')].map(t => t.textContent.trim()).slice(0, 3).join('|') == 'Notizen|Metadaten|Verknüpft', 'Reiter Notizen, Metadaten, Verknüpft am Eintrag');
  addToday(); await attachProtocol(ggId, {inline: true}); await sleep(200);
  const ptab = document.querySelector(`#etabs [data-eside="${ggId}"]`);
  ok(ptab && /Golden Gate Assembly/.test(ptab.textContent) && /Midi-Präp nach \[\[Golden Gate Assembly\]\]/.test(editor.getText()), 'Protokoll angehängt: eigener Reiter und Verweis im Text');
  ptab.click(); await sleep(300);
  ok(!$('#sidepane').hidden && /30 Zyklen 37 °C/.test($('#sidepane .sidebody').textContent) && !$('#editor').hidden && $('#history').hidden, 'Protokoll öffnet sich rechts neben dem Eintrag (statt des Verlaufs)');
  await call('testSnapshot', {name: 'm26-daneben.png'}).catch(() => {});
  document.querySelector('#sidepane [data-sideclose]').click(); await sleep(100);
  showEntryTab('meta'); await sleep(200);
  const mr = document.querySelector('#mrows .mrow');
  mr.querySelector('[data-mk]').value = 'Organismus'; mr.querySelector('[data-mv]').value = 'S. cerevisiae';
  document.querySelector('#metapanel [data-madd]').click();
  const mr2 = [...document.querySelectorAll('#mrows .mrow')][1]; mr2.querySelector('[data-mk]').value = 'Stamm'; mr2.querySelector('[data-mv]').value = 'BY4741';
  document.querySelector('#metapanel [data-msave]').click(); await sleep(300);
  ok(parseJSON((await call('load', {id: lbId})).meta_json, []).length == 2 && /Metadaten\s*2/.test($('#etabs').textContent) && $('#editor').hidden, 'Eigene Felder gesichert (Reiter zeigt 2)');
  editor.commands.focus('end'); editor.commands.insertContent([{type: 'mention', attrs: {id: `ent:${plasmid.id}`, label: plasmid.code, mentionSuggestionChar: '@'}}]); changed(); await flush();
  showEntryTab('rel'); await sleep(300);
  const relTxt = $('#relpanel').textContent;
  ok(relTxt.includes(plasmid.code) && /Verweist auf/.test(relTxt) && relTxt.includes('Golden Gate Assembly'), 'Verknüpft listet Plasmid und Protokoll');
  showEntryTab('notes');
  await open(useEntry); showEntryTab('rel'); await sleep(300);
  ok(/Chargen \(Verbrauch\)/.test($('#relpanel').textContent) && $('#relpanel').textContent.includes('Taq-Polymerase'), 'Verknüpft listet die verbrauchte Charge');
  showEntryTab('notes');
  await open(signedOne.id); await sleep(150);
  ok(!document.querySelector('#etabs [data-eadd]'), 'Abgeschlossener Eintrag: keine Protokolle anhängen');
  showView('doc');

  // M27: Editor-Standards
  const edId = await call('create', {title: 'Editor-Standards'}); await refreshList(edId);
  editor.commands.setContent({type: 'doc', content: [para('H2O und 10 hoch 6 Zellen')]});
  const selWord = (w, k = 0) => { const h = findHits(editor.state.doc, w)[k]; editor.commands.setTextSelection(h); };
  const tool = t => [...document.querySelectorAll('#toolbar button')].find(b => b.title.startsWith(t) || b.textContent.trim() == t);
  selWord('2'); tool('Tiefgestellt').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  selWord('6'); tool('Hochgestellt').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  selWord('Zellen'); tool('Unterstrichen').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  ok(/H<sub>2<\/sub>O/.test(editor.getHTML()) && editor.getHTML().includes('<sup>6</sup>') && editor.getHTML().includes('<u>Zellen</u>'), 'Tiefstellen, Hochstellen, Unterstreichen (H₂O, 10⁶)');
  selWord('hoch'); tool('Textfarbe').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); await sleep(50);
  document.querySelector('.popmenu [data-col="#c0392b"]').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  selWord('und'); tool('Textfarbe').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); await sleep(50);
  document.querySelector('.popmenu [data-hl="#fff3a3"]').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  ok(/<span style="color: rgb\(192, 57, 43\);">hoch<\/span>/.test(editor.getHTML()) && /<mark data-color="#fff3a3"[^>]*>und<\/mark>/.test(editor.getHTML()), 'Textfarbe und Textmarker');
  selWord('Zellen'); linkDialog(); $('#lkUrl').value = 'www.addgene.org/12345'; $('#lkOk').click();
  ok(editor.getHTML().includes('href="https://www.addgene.org/12345"'), 'Link setzen (https:// wird ergänzt)');
  editor.commands.focus('end'); mathDialog(); $('#mxIn').value = 'c = \\frac{n}{V}'; $('#mxIn').dispatchEvent(new Event('input')); $('#mxOk').click(); await sleep(100);
  ok(editor.getJSON().content[0].content.some(n => n.type == 'inlineMath' && n.attrs.latex == 'c = \\frac{n}{V}') && /<math[\s\S]*<mfrac>/.test(editor.getHTML()) && editor.getText().includes('$c = \\frac{n}{V}$'),
    'Formel (LaTeX) im Text, im Export als MathML, in der Suche als $…$');
  editor.commands.insertContent(' und '); editor.commands.insertBlockMath({latex: '\\Delta G = \\Delta H - T\\Delta S'}); await sleep(100);
  await call('testSnapshot', {name: 'm27-formel.png'}).catch(() => {});
  changed(); await flush();
  editor.commands.setContent({type: 'doc', content: [para('Taq-Polymerase: Taq 2 µl, taq-frei')]});
  openFindBar(); $('#fbQ').value = 'taq'; $('#fbQ').dispatchEvent(new Event('input')); await sleep(50);
  const fcount = $('#fbCount').textContent;
  $('#fbR').value = 'Q5'; document.querySelector('#findbar [data-fb="all"]').click(); await sleep(50);
  ok(fcount == '1 von 3' && editor.getText() == 'Q5-Polymerase: Q5 2 µl, Q5-frei', `Suchen & Ersetzen: ${fcount}, alle ersetzt`);
  closeFindBar();
  editor.commands.setContent({type: 'doc', content: [para('')]}); editor.commands.focus('end');
  editor.commands.insertContent('/Trennlinie'); await sleep(250);
  const slashOpen = !!document.querySelector('.suggest:not(.popmenu) .opt');
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await sleep(150);
  ok(slashOpen && editor.getJSON().content.some(n => n.type == 'horizontalRule') && !editor.getText().includes('/Trennlinie'), '„/“-Befehl fügt eine Trennlinie ein');
  tool('＋ Einfügen').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); await sleep(80);
  const menuN = document.querySelectorAll('.popmenu [data-ii]').length;
  [...document.querySelectorAll('.popmenu [data-ii]')].find(o => o.textContent.includes('Plattenlayout 96')).dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); await sleep(150);
  ok(menuN >= 20 && editor.getJSON().content.some(n => n.type == 'plate') && document.querySelectorAll('#toolbar button').length <= 30, `Einfügemenü mit ${menuN} Blöcken; Werkzeugleiste kompakt`);
  // kleine .xlsx im Speicher (ZIP ohne Kompression)
  const zipStored = files => {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const [name, text] of Object.entries(files)) {
      const n = enc.encode(name), d = enc.encode(text), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
      parts.push(new Uint8Array(h.buffer), n, d);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), n); off += 30 + n.length + d.length;
    }
    const cdLen = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)]).arrayBuffer();
  };
  const xbuf = await zipStored({'xl/workbook.xml': '<workbook><sheets><sheet name="Messung" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Probe</t></si><si><t>OD600</t></si><si><t>Kultur A</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.82</v></c></row></sheetData></worksheet>'});
  await insertTableFromBuffer(xbuf, 'messung.xlsx'); await sleep(100);
  const tbl = editor.getJSON().content.find(n => n.type == 'table');
  ok(tbl && tbl.content[0].content[0].type == 'tableHeader' && JSON.stringify(tbl).includes('"0,82"') && JSON.stringify(tbl).includes('Kultur A'), 'Excel-Datei als Tabelle eingefügt (Kopfzeile, 0,82)');
  shortcutsDialog(); await sleep(50);
  ok(/⌘\./.test($('#locdlg').textContent) && /Einfügen-Befehle/.test($('#locdlg').textContent), 'Übersicht der Tastenkürzel');
  $('#locdlg').close();
  await call('testSnapshot', {name: 'm27-editor.png'}).catch(() => {});
  changed(); await flush();
  showView('doc');

  // M28: Einträge verwalten
  await open(lbId); await sleep(150);
  $('#metaStatus').value = 'fehlgeschlagen'; $('#metaStatus').dispatchEvent(new Event('change')); await sleep(200);
  $('#pinBtn').click(); await sleep(300);
  const firstLi = document.querySelector('#list li');
  ok(firstLi?.dataset.id == lbId && firstLi.querySelector('.stdot') && /📌/.test(firstLi.textContent), 'Status mit Farbe und Anheften (oben in der Liste)');
  Object.assign(LISTF, {status: 'fehlgeschlagen'}); await refreshList();
  ok([...document.querySelectorAll('#list li')].map(l => +l.dataset.id).join() == String(lbId) && /Filter ●/.test($('#listbar').textContent), 'Filter „fehlgeschlagen“');
  const keepPrompt28 = window.prompt; window.prompt = () => 'Fehlgeschlagen';
  await saveCurrentSearch(); window.prompt = keepPrompt28;
  Object.assign(LISTF, {status: ''}); await refreshList(); await sleep(100);
  document.querySelector('#savedlist [data-ss] .n').click(); await sleep(200);
  ok(!$('#savedsec').hidden && LISTF.status == 'fehlgeschlagen' && document.querySelectorAll('#list li').length == 1, 'Gespeicherte Suche stellt den Filter wieder her');
  Object.assign(LISTF, {status: '', sort: 'title'}); await refreshList();
  const titles = [...document.querySelectorAll('#list li')].filter(l => !/📌/.test(l.textContent)).map(l => l.querySelector('.t').textContent.trim());
  let cut = titles.length; while (cut && titles[cut - 1] == 'Ohne Titel') cut--;  // leere Titel stehen am Ende (ein importierter Eintrag kann wörtlich „Ohne Titel“ heißen)
  const named = titles.slice(0, cut);
  ok(named.length > 3 && named.every((t, i) => !i || named[i - 1].localeCompare(t, 'de', {numeric: true}) <= 0), 'Sortieren nach Titel (ohne Titel am Ende)');
  LISTF.sort = 'updated'; await refreshList();
  await open(useEntry); await sleep(150);
  const lotBefore = (await call('lot', {id: lotA.id})).amount;
  const dupId = await duplicateEntry(); await sleep(200);
  const dupUsage = editor.getJSON().content.find(n => n.type == 'usage');
  ok(cur == dupId && /\(Kopie\)$/.test($('#title').value) && dupUsage && !dupUsage.attrs.move && (await call('lot', {id: lotA.id})).amount == lotBefore,
    'Duplikat: Verbrauch darin noch nicht verbucht, Bestand unverändert');
  window.PREFLIGHT_GO = false;
  await signEntry(); await sleep(150);
  ok(!curSigned && (window.PREFLIGHT_SEEN || []).some(n => /Verbrauch-Block/.test(n.text)), 'Vor dem Abschließen: Hinweis auf unverbuchten Verbrauch, Abschließen abgebrochen');
  window.PREFLIGHT_GO = undefined;
  await open(lbId); await sleep(100);
  editor.commands.focus('end'); editor.commands.insertContent(' Neue Kolonie gepickt.'); changed(); await flush();
  const revs28 = await call('history', {id: lbId});
  await showRevision(revs28[revs28.length - 1].no); await sleep(150);
  document.querySelector('#preview [data-diff]').click(); await sleep(300);
  ok(!$('#sidepane').hidden && [...document.querySelectorAll('#sidepane ins')].some(x => /Kolonie gepickt/.test(x.textContent)), 'Versionsvergleich zeigt den neuen Satz als eingefügt');
  await call('testSnapshot', {name: 'm28-vergleich.png'}).catch(() => {});
  closeSide(); await leavePreview(false); await sleep(100);
  LIST_SELECT = new Set([lbId, dupId]); await refreshList();
  const keepPrompt28b = window.prompt; window.prompt = () => '2';
  await bulkAction('status'); window.prompt = keepPrompt28b; await sleep(150);
  ok((await call('load', {id: dupId})).status == 'fertig' && (await call('load', {id: lbId})).status == 'fertig' && LIST_SELECT.size == 0, 'Mehrfachauswahl: Status für zwei Einträge auf einmal');
  LIST_SELECT = null; await refreshList();
  await call('aiSetKey', {key: 'sk-ant-test-0000'}); await showSettings(); await sleep(150);
  ok(/Eingerichtet/.test($('#aiState').textContent), 'Einstellungen zeigen den eingerichteten KI-Assistenten');
  // Konten in den Einstellungen
  const setV = (id, v) => { $(id).value = v; };
  const acc = async (fill, go = '#accGo') => { fill(); $(go).click(); await sleep(400); };
  $('#accNew').click();
  await acc(() => { setV('#accName', 'Labor Test'); setV('#accPw1', 'passwort-eins'); setV('#accPw2', 'passwort-zwei'); });
  ok(/verschieden/.test($('#accMsg').textContent) && !(await call('accounts')).length, 'Konto anlegen: ungleiche Wiederholung wird abgelehnt');
  await acc(() => setV('#accPw2', 'passwort-eins'));
  ok((await call('accounts')).join() == 'Labor Test' && $('#accList').textContent.includes('Labor Test') && !$('#accMsg').textContent, 'Konto anlegen: erscheint in der Liste');
  document.querySelector('[data-accpw]').click();
  await acc(() => { setV('#accOld', 'falsch-falsch'); setV('#accNew1', 'passwort-drei'); setV('#accNew2', 'passwort-drei'); });
  ok(/stimmt nicht/.test($('#accMsg').textContent) && await call('authenticate', {name: 'Labor Test', password: 'passwort-eins'}), 'Passwort ändern: falsches altes Passwort wird abgelehnt');
  await acc(() => setV('#accOld', 'passwort-eins'));
  ok(await call('authenticate', {name: 'Labor Test', password: 'passwort-drei'}) && !(await call('authenticate', {name: 'Labor Test', password: 'passwort-eins'})), 'Passwort ändern: neues Passwort gilt');
  document.querySelector('[data-accdel]').click();
  await acc(() => setV('#accPw', 'falsch-falsch'));
  ok((await call('accounts')).length == 1 && $('#accMsg').textContent, 'Konto löschen: falsches Passwort scheitert');
  await acc(() => setV('#accPw', 'passwort-drei'));
  ok(!(await call('accounts')).length && /Noch kein Konto/.test($('#accList').textContent) && $('#settings').open, 'Konto löschen: weg, Einstellungen bleiben offen');
  $('#settings').close(); await call('aiSetKey', {key: null}); await refreshAI();
  // Seitenleiste: einklappen, Kalender, schnelles Umschalten
  const regSec = document.querySelector('.sec[data-fold="registry"]'), wasClosed = regSec.classList.contains('closed');  // gemerkter Zustand der App darf den Test nicht stören
  if (wasClosed) regSec.click();
  regSec.click();
  ok($('#types').classList.contains('folded') && $('#stockNav').classList.contains('folded') && regSec.classList.contains('closed') && getComputedStyle($('#types')).display == 'none', 'Seitenleiste: Registry lässt sich einklappen');
  regSec.click();
  ok(!$('#types').classList.contains('folded') && getComputedStyle($('#stockNav')).display != 'none', 'Seitenleiste: und wieder ausklappen');
  if (wasClosed) regSec.click();
  // Kalender als eigene Ansicht
  const tom = SideCal.addDays(todayISO(), 1), tdy = todayISO();
  ok(!document.querySelector('#sidecal') && !document.querySelector('aside .calgrid') && document.querySelector('#stockNav [data-stock="calendar"]'), 'Seitenleiste: nur der Eintrag „Kalender“, kein Tagesraster');
  document.querySelector('#stockNav [data-stock="calendar"]').click(); await sleep(400);
  ok(!$('#calendar').hidden && $('#doc').hidden && document.querySelectorAll('#calendar .ccell').length >= 28 && $('#calendar .ccell.today'), 'Kalender öffnet sich in der Hauptansicht (Monat)');
  $('#calendar [data-cnew]').click(); await sleep(100);
  $('#cfTitle').value = 'Transfektion HeLa'; $('#cfDay').value = tdy; $('#cfFrom').value = '09:30'; $('#cfTo').value = '11:00';
  document.querySelector('input[name=cfKind][value=experiment]').checked = true; $('#cfNote').value = 'Lipofectamin, 24 h';
  $('#cfSave').click(); await sleep(400);
  ok((await call('plans', {from: tdy, to: tdy})).length == 1 && $('#calendar .ccell.today .cchip.plan.experiment')?.textContent.includes('09:30') && $('#calside').textContent.includes('Transfektion HeLa'), 'Kalender: Experiment einplanen (Uhrzeit, Notiz) und im Tag sehen');
  $('#calendar [data-cnew]').click(); await sleep(100);
  $('#cfTitle').value = 'Falsch'; $('#cfDay').value = tdy; $('#cfFrom').value = '15:00'; $('#cfTo').value = '14:00'; $('#cfSave').click(); await sleep(300);
  ok(/Uhrzeit/.test($('#cfMsg').textContent) && (await call('plans', {from: tdy, to: tdy})).length == 1, 'Kalender: ungültige Eingabe zeigt eine Meldung statt zu speichern');
  $('#cfCancel').click(); await sleep(100);
  const planId = (await call('plans', {from: tdy, to: tdy}))[0].id;
  await calMovePlan(planId, tom); await sleep(200);
  ok((await call('plans', {from: tom, to: tom})).length == 1 && document.querySelector(`#calendar .ccell[data-cday="${tom}"] .cchip.plan`) || SideCal.parse(tom).getMonth() != SideCal.parse(tdy).getMonth(), 'Kalender: Plan auf anderen Tag ziehen');
  document.querySelector('#calendar [data-cmode="week"]').click(); await sleep(300);
  ok(document.querySelectorAll('#calendar .ccell').length == 7 && /KW \d+/.test($('#calendar .caltitle').textContent) && $('#calendar .calcells.week'), 'Kalender: Wochenansicht mit sieben Tagen');
  CAL.sel = tom; calDraw(); await sleep(100);
  await call('testSnapshot', {name: 'm30-kalender-woche.png'}).catch(() => {});
  document.querySelector('#calside [data-centryfor]').click(); await sleep(600);
  const planned = await call('load', {id: cur});
  ok(cur && planned.title == 'Transfektion HeLa' && (await call('list', {})).find(r => r.id == cur)?.day_first == tom && $('#doc').hidden == false && document.querySelector(`#editor section.day[data-day="${tom}"]`) && /Lipofectamin/.test(editor.getText()), 'Kalender: „Eintrag anlegen“ erzeugt Eintrag mit Tagesabschnitt und Notiz');
  // Datum eines Tagesabschnitts nachträglich ändern
  const dayEl = () => document.querySelector('#editor section.day');
  dayEl().querySelector('.dayedit').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true})); await sleep(100);
  const dIn = dayEl().querySelector('input[type=date]'), newDay = SideCal.addDays(tom, 3);
  dIn.value = newDay; dIn.dispatchEvent(new Event('change', {bubbles: true})); await sleep(300);
  ok(dayEl().dataset.day == newDay && /\d/.test(dayEl().querySelector('.daylabel').textContent) && editor.getJSON().content.find(n => n.type == 'day').attrs.date == newDay, 'Tagesabschnitt: Datum nachträglich geändert');
  await flush();
  ok((await call('list', {})).find(r => r.id == cur)?.day_first == newDay, 'Tagesabschnitt: neues Datum steht in der Liste (Zeitraum)');
  addToday(); await sleep(200);
  const msgsBefore = []; const keepAlert = window.alert; window.alert = m => msgsBefore.push(m);
  const days2 = [...document.querySelectorAll('#editor section.day')];
  days2.find(d => d.dataset.day == newDay).querySelector('.dayedit').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true})); await sleep(100);
  const dIn2 = days2.find(d => d.dataset.day == newDay).querySelector('input[type=date]'); dIn2.value = todayISO(); dIn2.dispatchEvent(new Event('change', {bubbles: true})); await sleep(200);
  window.alert = keepAlert;
  ok(msgsBefore.length == 1 && document.querySelectorAll(`#editor section.day[data-day="${todayISO()}"]`).length == 1 && document.querySelector(`#editor section.day[data-day="${newDay}"]`), 'Tagesabschnitt: doppeltes Datum wird abgelehnt');
  await showCalendar(); await sleep(200);
  document.querySelector(`#calendar [data-cplan="${planId}"]`) || (CAL.sel = tom, calDraw());
  CAL.mode = 'month'; await calLoad(); await call('testSnapshot', {name: 'm30-kalender-monat.png'}).catch(() => {});
  const keepConfirm = window.confirm; window.confirm = () => true;
  CAL.sel = tom; calDraw(); document.querySelector('#calside [data-cdel]').click(); await sleep(300); window.confirm = keepConfirm;
  ok(!(await call('plans', {from: tom, to: tom})).length && (await call('load', {id: planned.id})).title == 'Transfektion HeLa', 'Kalender: Plan löschen, der Eintrag bleibt');
  showView('doc');
  const two = [...document.querySelectorAll('#list li[data-id]')].map(li => +li.dataset.id).filter(id => id != cur).slice(0, 2);
  if (two.length == 2) {
    const p1 = open(two[0]), p2 = open(two[1]);  // zwei Klicks kurz hintereinander
    await Promise.all([p1, p2]); await sleep(100);
    ok(cur == two[1] && $('#title').value == (await call('load', {id: two[1]})).title && document.querySelectorAll('#list li.cur').length == 1 && document.querySelector('#list li.cur').dataset.id == String(two[1]), 'Schnell zwischen Einträgen klicken: der letzte gewinnt, genau einer markiert');
  }
  showView('doc');

  // M29: Molekularbiologie
  const bb = 'TTGACAGCTAGCTCAGTCCTAGGTATAATGCTAGCTACTAGAGTCACACAGGAAAGTACTAGATGCGTAAAGGCGAAGAGCTGTTCACTGGTGTCGTCCCTATTCTGGTGGAACTGGATGGTGATGTCAACGGTCATAAGTTTTCCGTGCGTGGCGAGGGTGAAGGTGACGCAACTAATGGTAAACTGACGCTGAAGTTCATCTGTACTACTGGTAAACTGCCGGTTCCTTGGCCGACTCTGGTAACGACGCTGACTTATGGTGTTCAGTGCTTTGCTCGTTATCCGGACCATATGAAGCAGCATGACTTCTTCAAGTCCGCCATGCCGGAAGGCTATGTGCAGGAACGCACGATTTCCTTTAAGGATGACGGCACGTACAAAACGCGTGCGGAAGTGAAATTTGAAGGCGATACCCTGGTAAACCGCATTGAGCTGAAAGGCATTGACTTTAAAGAGGACGGCAATATCCTGGGCCATAAGCTGGAATACAATTTTAACAGCCACAATGTTTACATCACCGCCGATAAACAAAAAAATGGCATTAAAGCGAATTTTAAAATTCGCCACAACGTGGAGGATGGCAGCGTGCAGCTGGCTGATCACTACCAGCAAAACACTCCAATCGGTGATGGTCCTGTTCTGCTGCCAGACAATCACTATCTGAGCACGCAAAGCGTTCTGTCTAAAGATCCGAACGAGAAACGCGATCATATGGTTCTGCTGGAGTTCGTAACCGCAGCGGGCATCACGCATGGTATGGATGAACTGTACAAATAA';
  const vecSeq = 'CCCC' + 'GAATTC' + 'A'.repeat(40) + 'AAGCTT' + bb;
  const vecE = await call('createEntity', {type: plT.id, name: 'pVektor29', values: {sequence: vecSeq}});
  await call('setSeqAnnotation', {entity: vecE.id, field: 'sequence', circular: true, features: [{type: 'CDS', label: 'gfp', start: 57 + 52, end: 56 + bb.length, strand: 1}], source: 'Test'});
  const X29 = 'ATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTAA';
  const insE = await call('createEntity', {type: plT.id, name: 'Insert29', values: {sequence: 'TT' + 'GAATTC' + X29 + 'AAGCTT' + 'TT'}});
  await showEntity(vecE.id); await sleep(300);
  let panel29 = () => document.querySelector('#reg .seqpanel[data-seqent]');
  panel29().querySelector('[data-mbedit]').click(); await sleep(100);
  $('#seOp').value = 'insert'; $('#seOp').dispatchEvent(new Event('change')); $('#seAt').value = '1'; $('#seTxt').value = 'GGG'; $('#seOk').click(); await sleep(500);
  const ann29 = await call('seqAnnotation', {entity: vecE.id, field: 'sequence'});
  ok(ann29.length == vecSeq.length + 3 && ann29.features[0].start == 57 + 52 + 3 && !ann29.stale, 'Sequenz bearbeitet (3 Basen eingefügt), Feature wandert mit, nicht „veraltet“');
  panel29().querySelector('[data-mbfeat]').click(); await sleep(100);
  $('#ftName').value = 'MCS'; $('#ftFrom').value = '8'; $('#ftTo').value = '63'; $('#ftOk').click(); await sleep(300);
  ok((await call('seqAnnotation', {entity: vecE.id, field: 'sequence'})).features.some(f => f.label == 'MCS' && f.start == 8 && f.end == 63), 'Feature von Hand gesetzt');
  // kleine .ab1 im Speicher: Lesung = Stück der Referenz mit einer abweichenden Base
  const refNow = 'GGG' + vecSeq, readSeq = refNow.slice(120, 520).split('');
  const mutAt = 200; readSeq[mutAt] = readSeq[mutAt] == 'A' ? 'G' : 'A';
  const abif = (bases, quals) => {
    const n = bases.length, ploc = bases.map((_, i) => 10 + i * 12), traces = {};
    for (const b of 'GATC') { traces[b] = new Array(n * 12 + 20).fill(0); bases.forEach((x, i) => { if (x == b) for (let d = -5; d <= 5; d++) traces[b][ploc[i] + d] = Math.round(800 * Math.exp(-d * d / 6)); }); }
    const tags = [['PBAS', 2, 2, 1, bases.map(c => c.charCodeAt(0))], ['PCON', 2, 2, 1, quals], ['PLOC', 2, 4, 2, ploc], ['FWO_', 1, 2, 1, [...'GATC'].map(c => c.charCodeAt(0))],
      ...[...'GATC'].map((b, i) => ['DATA', 9 + i, 4, 2, traces[b]]), ['SMPL', 1, 18, 1, [7, ...[...'Klon 29'].map(c => c.charCodeAt(0))]]];
    let dataLen = 0; const placed = tags.map(t => { const size = t[4].length * t[3], off = 128 + dataLen; if (size > 4) dataLen += size; return {t, size, off}; });
    const dirOff = 128 + dataLen, buf = new ArrayBuffer(dirOff + tags.length * 28), v = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([65, 66, 73, 70]); v.setInt16(4, 101); v.setInt32(18, tags.length); v.setInt32(22, tags.length * 28); v.setInt32(26, dirOff);
    placed.forEach(({t, size, off}, i) => {
      const o = dirOff + i * 28; for (let k = 0; k < 4; k++) u8[o + k] = t[0].charCodeAt(k);
      v.setInt32(o + 4, t[1]); v.setInt16(o + 8, t[2]); v.setInt16(o + 10, t[3]); v.setInt32(o + 12, t[4].length); v.setInt32(o + 16, size);
      const at = size <= 4 ? o + 20 : off;
      t[4].forEach((x, k) => t[3] == 2 ? v.setInt16(at + k * 2, x) : (u8[at + k] = x));
      if (size > 4) v.setInt32(o + 20, off);
    });
    return buf;
  };
  const sres = sangerShow(panel29(), abif(readSeq, readSeq.map(() => 40)), 'klon29.ab1'); await sleep(100);
  ok(sres.real.length == 1 && sres.real[0].refPos == 121 + mutAt && document.querySelector('#reg .sangerbox svg.chrom') && /Klon 29/.test(document.querySelector('#reg .sangerbox').textContent),
    `Sanger-Lesung: eine Abweichung an Position ${121 + mutAt} mit Chromatogramm`);
  await call('testSnapshot', {name: 'm29-sanger.png'}).catch(() => {});
  panel29().querySelector('[data-mbclone]').click(); await sleep(200);
  const insOpt = [...$('#clIns').options].find(o => /Insert29/.test(o.textContent));
  $('#clIns').value = insOpt.value; $('#clE1').value = 'EcoRI'; $('#clE2').value = 'HindIII';
  $('#clRun').click(); await sleep(300);
  const outTxt = $('#clOut').textContent;
  $('#clName').value = 'pVektor29-Insert'; $('#clSave').click(); await sleep(600);
  const newPl = (await call('entities', {type: plT.id})).find(x => x.name == 'pVektor29-Insert');
  const newAnn = newPl && await call('seqAnnotation', {entity: newPl.id, field: 'sequence'});
  const expLen = refNow.length - 46 + 4 + X29.length + 2;  // Rückgrat ohne MCS-Stück, dazu Insert zwischen den Schnitten
  ok(newPl && newAnn.length == expLen && newAnn.circular && newAnn.features.some(f => f.label == 'gfp') && /Rückgrat/.test(outTxt) && !$('#reg').hidden,
    `Klonierung EcoRI/HindIII: neues Plasmid ${newAnn?.length} bp mit übernommenem gfp-Feature`);
  showView('doc');
  await sleep(300);
  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  ok(!jsErrors.length, `keine unbehandelten JS-Fehler${jsErrors.length ? ': ' + jsErrors.slice(0, 5).join(' | ') : ''}`);
  return out;
}

// ---------- Ereignisse ----------
$('#toolbar').addEventListener('mousedown', e => {
  const b = e.target.closest('[data-tool]'); if (!b) return;
  e.preventDefault();  // Fokus im Editor behalten
  TOOLS[+b.dataset.tool][2](editor, b);
});
$('#list').addEventListener('click', e => {
  if (e.target.dataset.emptytrash !== undefined) return emptyTrash();
  const li = e.target.closest('li'); if (!li || !li.dataset.id) return;
  if (LIST_SELECT) { const id = +li.dataset.id; LIST_SELECT.has(id) ? LIST_SELECT.delete(id) : LIST_SELECT.add(id); return refreshList(); }
  if (!$('#reg').hidden) { showView('doc'); if (li.dataset.id == cur) return; }
  const q = $('#search').value.trim().replace(/["*()]/g, ' ').split(/\s+/).find(w => w.length >= 3);  // bei Suche: zum Treffer springen
  if (e.metaKey) call('openInTab', {id: +li.dataset.id}); else open(+li.dataset.id, {find: q});  // ⌘-Klick: in neuem Tab
});
$('#new').onclick = newEntry;
$('#aiBtn').onclick = e => aiMenu(e.currentTarget);
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshList(), 120); });
$('#title').addEventListener('input', changed);
$('#title').addEventListener('keydown', e => { if (e.key == 'Enter') { e.preventDefault(); editor.commands.focus('start'); } });
$('#filepick').addEventListener('change', e => { insertFiles([...e.target.files]); e.target.value = ''; });
$('#histBtn').onclick = () => { const h = $('#history'); h.hidden = !h.hidden; if (!h.hidden) { if (SIDE) closeSide(); showHistory(); } };  // rechts nur ein Fenster
$('#revlist').addEventListener('click', e => { const li = e.target.closest('li'); if (li && cur) showRevision(li.value); });
$('#preview').addEventListener('click', e => {
  if (e.target.dataset.restore !== undefined && confirm(`Fassung von Revision ${preview.no} als aktuellen Stand übernehmen? Alle Revisionen bleiben erhalten.`)) leavePreview(true);
  if (e.target.dataset.back !== undefined) leavePreview(false);
});
$('#projects').addEventListener('click', e => {
  if (e.target.dataset.rename) return renameProject(+e.target.dataset.rename);
  if (e.target.dataset.archive) return archiveProject(+e.target.dataset.archive);
  const li = e.target.closest('li'); if (li) selectProject(li.dataset.p);
});
$('#newProject').onclick = newProject;
$('#saveTpl').onclick = saveAsTemplate;
$('#runBtn').onclick = startRun;
$('#signBtn').onclick = signEntry;
$('#trashBtn').onclick = trashEntry;
$('#trashinfo').addEventListener('click', e => { if (e.target.dataset.trestore !== undefined) restoreEntry(); if (e.target.dataset.tpurge !== undefined) purgeEntry(); });
$('#templates').addEventListener('click', async e => {
  if (e.target.dataset.tplver) return pickTemplateVersion(+e.target.dataset.tplver);
  if (e.target.dataset.tplarch) { const t = templates.find(x => x.id == e.target.dataset.tplarch); await call('archiveTemplate', {id: t.id, archived: !t.archived}); return loadTemplates(); }
  const li = e.target.closest('li[data-tpl]'); if (li) fromTemplate(+li.dataset.tpl);
});
$('#tags').addEventListener('click', e => {
  const b = e.target.closest('[data-tag]'); if (!b) return;
  tag = tag == +b.dataset.tag ? null : +b.dataset.tag;  // nochmal klicken hebt den Filter auf
  loadTags().then(() => refreshList());
});
$('#etags').addEventListener('click', e => {
  const n = e.target.dataset.untag; if (n == null) return;
  saveEntryTags(JSON.parse($('#etags').dataset.names || '[]').filter(x => x != n));
});
$('#tagInput').addEventListener('keydown', e => { if (e.key == 'Enter' || e.key == ',') { e.preventDefault(); addTagFromInput(); } });
$('#tagInput').addEventListener('change', addTagFromInput);  // Auswahl aus der Vorschlagsliste
// Verweise im Text und Rückverweise öffnen den verlinkten Eintrag
for (const sel of ['#editor', '#backlinks']) {
  $(sel).addEventListener('click', e => {
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); open(+a.dataset.entry); }
    const r = e.target.closest('a.eref'); if (r) { e.preventDefault(); showEntity(+r.dataset.ent); }
  });
}
$('#metaProject').addEventListener('change', e => setMeta({project: +e.target.value}));
$('#metaKind').addEventListener('change', e => setMeta({kind: e.target.value}));
setInterval(() => { if (changedSinceSnap && Date.now() - lastSnap > SNAPSHOT_MS) snapshot(true); }, 30000);

// Von Swift aufgerufen (Menü, Beenden)
window.app = {newEntry, flush, snapshot: () => snapshot(false), focusSearch: () => $('#search').focus(), perfTest, selfTest, startRun, settings: showSettings,
  exportBook, exportEntryPDF, importFiles, backupNow, updateProgress, trashEntry,
  openCode, scan: () => call('scan'),
  openEntry: id => { $('#search').value = ''; showView('doc'); return refreshList(id); },
  search: q => { showView('doc'); $('#search').value = q; return refreshList(); },
  // vom iPhone übernommen (Swift hat die Datei schon gespeichert)
  insertReceived: it => {
    if (!cur || preview || curSigned) return alert('Bitte zuerst einen bearbeitbaren Eintrag öffnen.');
    editor.chain().focus().insertContent(it.kind == 'image' ? {type: 'image', attrs: {src: `lab://files/${it.sha256}`, alt: it.name}}
      : {type: 'file', attrs: {sha: it.sha256, name: it.name, mime: it.mime, size: it.size}}).run();
  },
  ocrDone: () => { if ($('#search').value.trim()) refreshList(); },
  // derselbe Eintrag wurde in einem anderen Fenster gespeichert
  externalChange: async id => {
    await refreshList();
    if (id != cur || preview) return;
    if (dirty) return status('Dieser Eintrag wurde in einem anderen Fenster geändert – zuletzt Gespeichertes gilt');
    cur = null; await open(id);
  }};

async function start() {
  makeEditor();
  renderToolbar();
  const book = await call('book');
  $('#book').textContent = book.name;
  $('#book').title = `${book.path}\nAnderes Laborbuch: ⌘O`;
  $('#metaKind').innerHTML = book.kinds.map(k => `<option value="${k}">${KINDS[k] || k}</option>`).join('');
  await loadProjects();
  await loadTags();
  await loadTemplates();
  initRegistry();
  initStock();
  initLabels();
  initResults();
  initCulture();
  initOrders();
  initSeqView();
  initDbLinks();
  initLiterature();
  initAgenda();
  initEntryTabs();
  initManage();
  initSidebar();
  initCalendar();
  initMolBioUI();
  initAssistant();
  await loadExtensions();
  refreshAgendaBadge();
  refreshOrderBadge();
  await loadResultSchemas();
  refreshCareBadges().then(n => { const t = [n.cultures && `${n.cultures} Kultur(en)`, n.devices && `${n.devices} Gerät(e)`].filter(Boolean);
    if (t.length) setTimeout(() => status(`Fällig: ${t.join(', ')} – siehe Zellkultur und Geräte`), 4000); });
  refreshStockBadge().then(n => { if (n) status(`${n} Charge(n) im Bestand abgelaufen, bald ablaufend oder knapp`); });
  await loadTypes();
  await refreshList();
  const wanted = +new URLSearchParams(location.search).get('entry');  // neuer Tab für einen bestimmten Eintrag
  const first = $('#list li'); if (wanted) await open(wanted); else if (first) await open(+first.dataset.id);
}
start().catch(e => alert('Start fehlgeschlagen: ' + e.message));
