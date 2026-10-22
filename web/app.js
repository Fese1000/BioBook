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

// Verweis auf einen anderen Eintrag: „[[“ tippen, Eintrag wählen
const EntryLink = TT.Mention.configure({
  renderText: ({node}) => `[[${node.attrs.label}]]`,
  renderHTML: ({node}) => ['a', {class: 'elink', href: '#', 'data-entry': node.attrs.id, title: 'Eintrag öffnen'}, `↗ ${node.attrs.label}`],
  suggestion: {
    char: '[[', allowSpaces: true,
    items: async ({query}) => {
      const rows = query ? await call('search', {q: query}) : await call('list');
      return rows.filter(r => r.id != cur).slice(0, 8).map(r => ({id: String(r.id), label: r.title || 'Ohne Titel', kind: r.kind}));
    },
    render: () => {
      let el, sel = 0, items = [], cmd;
      const draw = () => {
        el.innerHTML = items.length ? items.map((it, i) => `<div class="opt ${i == sel ? 'on' : ''}" data-i="${i}">${esc(it.label)}<small>${KINDS[it.kind] || ''}</small></div>`).join('')
          : '<div class="none">Kein Eintrag gefunden</div>';
      };
      const place = rect => { const r = rect?.(); if (r) { el.style.left = `${r.left}px`; el.style.top = `${r.bottom + 4}px`; } };
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
    },
  },
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
    FileNode, EntryLink, CalcNode,
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
  const links = new Set(), files = new Set();
  const walk = n => {
    if (n.type == 'mention' && n.attrs?.id) links.add(+n.attrs.id);
    if (n.type == 'file' && n.attrs?.sha) files.add(n.attrs.sha);
    if (n.type == 'image') { const m = /^lab:\/\/files\/([0-9a-f]{64})$/.exec(n.attrs?.src || ''); if (m) files.add(m[1]); }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return {links: [...links], files: [...files]};
}

/// Verweis-Beschriftungen auf die aktuellen Titel bringen (Titel können sich geändert haben)
async function refreshLinkLabels(doc) {
  const titles = new Map((await call('titles')).map(t => [String(t.id), t.title || 'Ohne Titel']));
  const walk = n => {
    if (n.type == 'mention' && n.attrs) n.attrs.label = titles.get(String(n.attrs.id)) ?? `${n.attrs.label} (gelöscht)`;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return doc;
}

const TOOLS = [
  ['B', 'Fett', e => e.chain().focus().toggleBold().run(), e => e.isActive('bold')],
  ['I', 'Kursiv', e => e.chain().focus().toggleItalic().run(), e => e.isActive('italic')],
  ['S', 'Durchgestrichen', e => e.chain().focus().toggleStrike().run(), e => e.isActive('strike')],
  ['|'],
  ['H1', 'Überschrift 1', e => e.chain().focus().toggleHeading({level: 1}).run(), e => e.isActive('heading', {level: 1})],
  ['H2', 'Überschrift 2', e => e.chain().focus().toggleHeading({level: 2}).run(), e => e.isActive('heading', {level: 2})],
  ['H3', 'Überschrift 3', e => e.chain().focus().toggleHeading({level: 3}).run(), e => e.isActive('heading', {level: 3})],
  ['|'],
  ['• Liste', 'Aufzählung', e => e.chain().focus().toggleBulletList().run(), e => e.isActive('bulletList')],
  ['1. Liste', 'Nummerierte Liste', e => e.chain().focus().toggleOrderedList().run(), e => e.isActive('orderedList')],
  ['☑ Checkliste', 'Checkliste', e => e.chain().focus().toggleTaskList().run(), e => e.isActive('taskList')],
  ['|'],
  ['Tabelle', 'Tabelle 3 × 3 einfügen', e => e.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()],
  ['+ Zeile', 'Zeile darunter', e => e.chain().focus().addRowAfter().run(), null, e => e.isActive('table')],
  ['+ Spalte', 'Spalte rechts', e => e.chain().focus().addColumnAfter().run(), null, e => e.isActive('table')],
  ['− Tabelle', 'Tabelle löschen', e => e.chain().focus().deleteTable().run(), null, e => e.isActive('table')],
  ['|'],
  ['Datei', 'Bild oder Datei einfügen', () => $('#filepick').click()],
  ['↗ Verweis', 'Verweis auf einen Eintrag ([[)', e => e.chain().focus().insertContent('[[').run()],
  ['✎ Beschriften', 'Ausgewähltes Bild beschriften (oder Doppelklick aufs Bild)', () => annotateSelected(), null, e => e.isActive('image')],
  ['🔗 Rohdaten', 'Große Dateien verlinken statt kopieren (Prüfsumme meldet Änderungen)', () => linkRawFiles()],
  ['🧮 Rechner', 'Rechner einfügen: Verdünnung, Einwaage, Mastermix, Umrechnen', (e, btn) => calcMenu(btn)],
  ['Code', 'Codeblock', e => e.chain().focus().toggleCodeBlock().run(), e => e.isActive('codeBlock')],
  ['Zitat', 'Zitat', e => e.chain().focus().toggleBlockquote().run(), e => e.isActive('blockquote')],
  ['|'],
  ['↶', 'Widerrufen (⌘Z)', e => e.chain().focus().undo().run()],
  ['↷', 'Wiederholen (⇧⌘Z)', e => e.chain().focus().redo().run()],
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
  $('#projects').innerHTML = li('', 'Alle Einträge') + li(0, 'Ohne Projekt')
    + projects.map(p => li(p.id, p.name, `<span class="c">${p.entries}</span><button class="ed" data-rename="${p.id}" title="Umbenennen">✎</button>`
      + `<button class="ed" data-archive="${p.id}" title="${p.archived ? 'Wiederherstellen' : 'Archivieren'}">${p.archived ? '↺' : '🗄'}</button>`, p.archived ? 'arch' : '')).join('');
  $('#listTitle').textContent = project == null ? 'Einträge' : projectName(project);
  fillMetaProject();
}

function fillMetaProject(sel = $('#metaProject').value) {
  const opts = [['0', '— ohne —'], ...projects.filter(p => !p.archived || String(p.id) == sel).map(p => [String(p.id), p.name])];
  $('#metaProject').innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('#metaProject').value = sel || '0';
}

async function selectProject(p) {
  project = p === '' ? null : +p;
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
async function refreshList(selectId) {
  const q = $('#search').value.trim();
  const filter = {...(project == null ? {} : {project}), ...(tag == null ? {} : {tag})};
  let rows = q ? await call('search', {q}) : await call('list', filter);
  if (q && project != null) rows = rows.filter(r => (r.project_id ?? 0) == project);  // Suche im gewählten Projekt
  if (q && tag != null) { const n = tags.find(t => t.id == tag)?.name.toLowerCase(); rows = rows.filter(r => (r.tags || '').toLowerCase().split(', ').includes(n)); }
  $('#list').innerHTML = rows.map(r => `<li data-id="${r.id}" class="${r.id == cur ? 'cur' : ''}">
    <div class="t">${esc(r.title || 'Ohne Titel')}</div>
    <div class="m">${KINDS[r.kind] || ''} · ${when(r.updated)}${r.revisions ? ` · ${r.revisions} Rev.` : ''}${project == null && r.project_id ? ` · ${esc(projectName(r.project_id))}` : ''}</div>
    ${r.tags ? `<div class="m">${r.tags.split(', ').map(t => '#' + esc(t)).join(' ')}</div>` : ''}
    ${r.snippet ? `<div class="s">${esc(r.snippet).replace(/\[(.*?)\]/g, '<mark>$1</mark>')}</div>` : ''}</li>`).join('');
  $('#listTitle').textContent = [project == null ? 'Einträge' : projectName(project), tag != null ? '#' + (tags.find(t => t.id == tag)?.name || '') : ''].filter(Boolean).join(' · ');
  $('#empty').hidden = !!(rows.length || q || cur || project != null || tag != null);
  if (selectId) await open(selectId);
}

async function showBacklinks() {
  const b = await call('backlinks', {id: cur});
  $('#backlinks').hidden = !b.length;
  $('#backlinks').innerHTML = `<h4>Verweise auf diesen Eintrag</h4>` + b.map(r => `<a href="#" class="elink" data-entry="${r.id}">↗ ${esc(r.title || 'Ohne Titel')}</a>`).join(' ');
}

async function open(id) {
  if (cur == id && !preview) return;
  await flush();
  if (cur && changedSinceSnap) await snapshot(true);
  const e = await call('load', {id});
  setPreview(null);
  cur = e.id;
  $('#doc').hidden = false; $('#empty').hidden = true;
  $('#title').value = e.title;
  fillMetaProject(String(e.project_id ?? 0));
  $('#metaKind').value = e.kind;
  renderEntryTags(e.tags || []);
  curTemplate = e.template_id ? {id: e.template_id, version: e.template_version} : null;
  curSigned = e.signed_no ?? null;
  renderTemplateInfo();
  if (RUN && RUN.entry != e.id) hideRun();
  editor.commands.setContent(e.draft_json ? await refreshLinkLabels(JSON.parse(e.draft_json)) : '', {emitUpdate: false});
  showBacklinks();
  dirty = changedSinceSnap = false; lastSnap = Date.now();
  status('Gespeichert');
  updateCounts();
  document.querySelectorAll('#list li').forEach(li => li.classList.toggle('cur', li.dataset.id == cur));
  applyLock();
  renderSignInfo();
  checkLinks();
  if (!$('#history').hidden) showHistory();
  updateRunBar();
  if (!e.title) $('#title').focus(); else editor.commands.focus('start');
}

async function newEntry() {
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
    <button class="btn on" data-restore>Diese Fassung wiederherstellen</button><button class="btn" data-back>Zurück zum aktuellen Stand</button>`;
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
}

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
  alert('Leistungstest\n\n' + out.join('\n'));
}

// ---------- Selbsttest in der echten App (--selftest) ----------
async function selfTest() {
  const out = [], ok = (c, what) => out.push(`${c ? 'ok  ' : 'FAIL'} ${what}`), sleep = ms => new Promise(r => setTimeout(r, ms));
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
  const before = (await call('list')).length;
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
  const origTitles = bookJson.entries.map(e => e.title).sort().join('|');
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
  return out;
}

// ---------- Ereignisse ----------
$('#toolbar').addEventListener('mousedown', e => {
  const b = e.target.closest('[data-tool]'); if (!b) return;
  e.preventDefault();  // Fokus im Editor behalten
  TOOLS[+b.dataset.tool][2](editor, b);
});
$('#list').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  if (e.metaKey) call('openInTab', {id: +li.dataset.id}); else open(+li.dataset.id);  // ⌘-Klick: in neuem Tab
});
$('#new').onclick = newEntry;
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshList(), 120); });
$('#title').addEventListener('input', changed);
$('#title').addEventListener('keydown', e => { if (e.key == 'Enter') { e.preventDefault(); editor.commands.focus('start'); } });
$('#filepick').addEventListener('change', e => { insertFiles([...e.target.files]); e.target.value = ''; });
$('#histBtn').onclick = () => { const h = $('#history'); h.hidden = !h.hidden; if (!h.hidden) showHistory(); };
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
  $(sel).addEventListener('click', e => { const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); open(+a.dataset.entry); } });
}
$('#metaProject').addEventListener('change', e => setMeta({project: +e.target.value}));
$('#metaKind').addEventListener('change', e => setMeta({kind: e.target.value}));
setInterval(() => { if (changedSinceSnap && Date.now() - lastSnap > SNAPSHOT_MS) snapshot(true); }, 30000);

// Von Swift aufgerufen (Menü, Beenden)
window.app = {newEntry, flush, snapshot: () => snapshot(false), focusSearch: () => $('#search').focus(), perfTest, selfTest, startRun, settings: showSettings,
  exportBook, exportEntryPDF, importFiles, backupNow, updateProgress,
  openEntry: id => { $('#search').value = ''; return refreshList(id); },
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
  await refreshList();
  const wanted = +new URLSearchParams(location.search).get('entry');  // neuer Tab für einen bestimmten Eintrag
  const first = $('#list li'); if (wanted) await open(wanted); else if (first) await open(+first.dataset.id);
}
start().catch(e => alert('Start fehlgeschlagen: ' + e.message));
