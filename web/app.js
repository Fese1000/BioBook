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
let preview = null;                 // angezeigte alte Revision (nur lesen) oder null

// ---------- Editor ----------
function makeEditor() {
  editor = new TT.Editor({
    element: $('#editor'),
    extensions: [
      TT.StarterKit.configure({link: {openOnClick: false}}),
      TT.Image,
      TT.TableKit.configure({table: {resizable: true}}),
      TT.TaskList, TT.TaskItem.configure({nested: true}),
      TT.Placeholder.configure({placeholder: 'Schreib los … Bilder per Drag & Drop oder Einfügen.'}),
      TT.CharacterCount,
    ],
    onUpdate: changed,
    onSelectionUpdate: renderToolbar,
    onTransaction: renderToolbar,
    editorProps: {
      handlePaste: (view, e) => insertImages([...(e.clipboardData?.files || [])]),
      handleDrop: (view, e) => {
        const files = [...(e.dataTransfer?.files || [])];
        const pos = view.posAtCoords({left: e.clientX, top: e.clientY})?.pos;
        return insertImages(files, pos);
      },
    },
  });
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
  ['Bild', 'Bild einfügen', () => $('#filepick').click()],
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

// ---------- Bilder ----------
function insertImages(files, pos) {
  const imgs = files.filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return false;  // kein Bild: Editor macht das Übliche
  (async () => {
    for (const f of imgs) {
      const sha = await upload(f);
      const node = {type: 'image', attrs: {src: `lab://files/${sha}`, alt: f.name}};
      if (pos != null) { editor.chain().focus().insertContentAt(pos, node).run(); pos += 1; }
      else editor.chain().focus().insertContent(node).run();
    }
  })().catch(e => alert('Bild konnte nicht gespeichert werden: ' + e.message));
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

// ---------- Einträge ----------
async function refreshList(selectId) {
  const q = $('#search').value.trim();
  let rows = q ? await call('search', {q}) : await call('list', project == null ? {} : {project});
  if (q && project != null) rows = rows.filter(r => (r.project_id ?? 0) == project);  // Suche im gewählten Projekt
  $('#list').innerHTML = rows.map(r => `<li data-id="${r.id}" class="${r.id == cur ? 'cur' : ''}">
    <div class="t">${esc(r.title || 'Ohne Titel')}</div>
    <div class="m">${KINDS[r.kind] || ''} · ${when(r.updated)}${r.revisions ? ` · ${r.revisions} Rev.` : ''}${project == null && r.project_id ? ` · ${esc(projectName(r.project_id))}` : ''}</div>
    ${r.snippet ? `<div class="s">${esc(r.snippet).replace(/\[(.*?)\]/g, '<mark>$1</mark>')}</div>` : ''}</li>`).join('');
  $('#empty').hidden = !!(rows.length || q || cur || project != null);
  if (selectId) await open(selectId);
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
  editor.commands.setContent(e.draft_json ? JSON.parse(e.draft_json) : '', {emitUpdate: false});
  dirty = changedSinceSnap = false; lastSnap = Date.now();
  status('Gespeichert');
  updateCounts();
  document.querySelectorAll('#list li').forEach(li => li.classList.toggle('cur', li.dataset.id == cur));
  if (!$('#history').hidden) showHistory();
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
  editor.setEditable(!r, false);  // false: kein update-Ereignis, sonst würde die alte Fassung als Arbeitsstand gespeichert
  $('#title').readOnly = !!r;
  $('#toolbar').hidden = !!r;
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
  editor.commands.setContent(JSON.parse(r.content_json), {emitUpdate: false});
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
  dirty = changedSinceSnap = true;
  status('Nicht gespeichert');
  updateCounts();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!cur || !dirty) return;
  dirty = false;
  status('Speichert …');
  try {
    await call('save', {id: cur, title: $('#title').value, json: JSON.stringify(editor.getJSON()), text: editor.getText()});
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
  $('#revlist').innerHTML = revs.map(r => `<li value="${r.no}" title="Diese Fassung ansehen" class="${preview?.no == r.no ? 'cur' : ''}">${when(r.created)}<br><code>${r.hash.slice(0, 16)}…</code></li>`).join('');
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

// ---------- Ereignisse ----------
$('#toolbar').addEventListener('mousedown', e => {
  const b = e.target.closest('[data-tool]'); if (!b) return;
  e.preventDefault();  // Fokus im Editor behalten
  TOOLS[+b.dataset.tool][2](editor);
});
$('#list').addEventListener('click', e => { const li = e.target.closest('li'); if (li) open(+li.dataset.id); });
$('#new').onclick = newEntry;
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshList(), 120); });
$('#title').addEventListener('input', changed);
$('#title').addEventListener('keydown', e => { if (e.key == 'Enter') { e.preventDefault(); editor.commands.focus('start'); } });
$('#filepick').addEventListener('change', e => { insertImages([...e.target.files]); e.target.value = ''; });
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
$('#metaProject').addEventListener('change', e => setMeta({project: +e.target.value}));
$('#metaKind').addEventListener('change', e => setMeta({kind: e.target.value}));
setInterval(() => { if (changedSinceSnap && Date.now() - lastSnap > SNAPSHOT_MS) snapshot(true); }, 30000);

// Von Swift aufgerufen (Menü, Beenden)
window.app = {newEntry, flush, snapshot: () => snapshot(false), focusSearch: () => $('#search').focus(), perfTest};

async function start() {
  makeEditor();
  renderToolbar();
  const book = await call('book');
  $('#book').textContent = book.name;
  $('#book').title = `${book.path}\nAnderes Laborbuch: ⌘O`;
  $('#metaKind').innerHTML = book.kinds.map(k => `<option value="${k}">${KINDS[k] || k}</option>`).join('');
  await loadProjects();
  await refreshList();
  const first = $('#list li'); if (first) await open(+first.dataset.id);
}
start().catch(e => alert('Start fehlgeschlagen: ' + e.message));
