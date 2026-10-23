// Export (Ordner mit HTML, Markdown, JSON, Dateien und .eln) und Import (.eln, Markdown, Word/RTF/ODT/HTML, Scans).
// Swift liest und schreibt die Dateien; hier entstehen Inhalte und Einträge.
'use strict';

let HEADLESS = null;  // Editor ohne Oberfläche: JSON ↔ HTML für Export und Import
const headless = () => HEADLESS ||= new TT.Editor({extensions: editorExtensions(false)});

const slug = s => String(s || 'eintrag').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'eintrag';
const safeName = s => String(s || 'datei').replace(/[\/\\:\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 100);
const KIND_DE = {experiment: 'Experiment', note: 'Notiz', protocol: 'Protokoll'};

// ---------- Export des ganzen Buches ----------
async function exportBook() {
  await flush();
  status('Export wird vorbereitet …');
  const d = await call('exportData');
  const H = headless();
  const fileName = a => `files/${a.sha256.slice(0, 12)}-${safeName(a.name)}`;
  const att = new Map(d.attachments.map(a => [a.sha256, a]));
  const base = e => `entries/${String(e.id).padStart(4, '0')}-${slug(e.title)}`;
  const byId = new Map(d.entries.map(e => [e.id, e]));
  const sigOf = id => d.signatures.find(g => g.entry_id == id && g.kind == 'author');
  const witnesses = id => d.signatures.filter(g => g.entry_id == id && g.kind == 'witness');
  const texts = [], copies = d.attachments.filter(a => a.stored == 'copy').map(a => ({sha: a.sha256, path: fileName(a)}));

  // HTML eines Eintrags mit Pfaden relativ zur Seite (prefix: Weg zurück zur Wurzel)
  const entryHTML = (json, prefix) => {
    H.commands.setContent(json, {emitUpdate: false});
    const doc = new DOMParser().parseFromString(`<body>${withBibliography(H.getHTML())}</body>`, 'text/html');
    doc.querySelectorAll('img').forEach(img => {
      const m = /^lab:\/\/files\/([0-9a-f]{64})$/.exec(img.getAttribute('src') || '');
      if (m && att.has(m[1])) img.setAttribute('src', prefix + fileName(att.get(m[1])));
    });
    doc.querySelectorAll('a.elink[data-entry]').forEach(a => { const t = byId.get(+a.dataset.entry); a.setAttribute('href', t ? prefix + base(t) + '.html' : '#'); });
    doc.querySelectorAll('div[data-file]').forEach(div => {
      const sha = div.getAttribute('data-sha'), a = att.get(sha), link = document.createElement('a');
      link.textContent = div.textContent;
      link.href = a?.stored == 'link' ? 'file://' + encodeURI(a.path) : a ? prefix + fileName(a) : '#';
      div.textContent = ''; div.appendChild(link);
    });
    return doc.body.innerHTML;
  };

  const page = (title, body, prefix) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${PRINT_CSS} body{max-width:820px;margin:32px auto;padding:0 20px} nav{font-size:10pt;margin-bottom:14pt} nav a{color:#2f6f5e}
@media(prefers-color-scheme:dark){body{background:#1b1c1e;color:#e8e6e1}.head{border-color:#555}td,th{border-color:#555}a{color:#6cc2a6}}</style></head>
<body><nav><a href="${prefix}index.html">← Übersicht</a></nav>${body}</body></html>`;

  // Verweise mit aktuellen Titeln (gespeichert ist der Titel zum Zeitpunkt des Einfügens)
  const withTitles = json => { const walk = n => { if (n.type == 'mention' && n.attrs) n.attrs.label = byId.get(+n.attrs.id)?.title || n.attrs.label; (n.content || []).forEach(walk); }; walk(json); return json; };

  for (const e of d.entries) {
    const json = withTitles(e.draft_json ? JSON.parse(e.draft_json) : {type: 'doc', content: []});
    const sig = sigOf(e.id);
    const meta = [`Nr. ${e.id}`, KIND_DE[e.kind] || e.kind, e.project && `Projekt: ${e.project}`, e.tags && `Tags: ${e.tags}`,
      `erstellt ${when(e.created)}`, `geändert ${when(e.updated)}`, `${e.revisions} Revisionen`].filter(Boolean).join(' · ');
    const sigLine = sig ? `<br>Abgeschlossen und signiert von <b>${esc(sig.name)}</b> am ${when(sig.signed_at)} (Revision ${sig.rev_no})`
      + witnesses(e.id).map(w => `<br>Gegengezeichnet von ${esc(w.name)} (${when(w.signed_at)})`).join('') : '';
    const head = `<div class="head">${esc(meta)}${e.last_hash ? `<br>Letzte Revision SHA-256: <span class="hash">${e.last_hash}</span>` : ''}${sigLine}</div>`;
    texts.push({path: base(e) + '.html', text: page(e.title || 'Ohne Titel', `${head}<h1>${esc(e.title || 'Ohne Titel')}</h1>${entryHTML(json, '../')}`, '../')});
    const front = ['---', `id: ${e.id}`, `titel: ${JSON.stringify(e.title || '')}`, `art: ${KIND_DE[e.kind] || e.kind}`,
      e.project && `projekt: ${JSON.stringify(e.project)}`, e.tags && `tags: [${e.tags.split(', ').map(t => JSON.stringify(t)).join(', ')}]`,
      `erstellt: ${e.created}`, `geaendert: ${e.updated}`, `revisionen: ${e.revisions}`, e.last_hash && `letzter_hash: ${e.last_hash}`,
      sig && `signiert: ${JSON.stringify(`${sig.name}, ${sig.signed_at}, Revision ${sig.rev_no}`)}`, '---', ''].filter(Boolean).join('\n');
    const md = MD.toMarkdown(json, {file: (sha, name) => att.has(sha) ? '../' + fileName(att.get(sha)) : name,
      entry: id => byId.has(+id) ? `${base(byId.get(+id)).split('/')[1]}.md` : '#', calc: (k, data) => calcSummary(k, data).text});
    texts.push({path: base(e) + '.md', text: `${front}\n# ${e.title || 'Ohne Titel'}\n\n${md}`});
  }

  const rows = d.entries.map(e => `<tr><td><a href="${base(e)}.html">${esc(e.title || 'Ohne Titel')}</a></td><td>${esc(KIND_DE[e.kind] || '')}</td>
    <td>${esc(e.project || '')}</td><td>${esc(e.tags || '')}</td><td>${when(e.updated)}</td><td>${sigOf(e.id) ? '🔏' : ''}</td></tr>`).join('');
  texts.push({path: 'index.html', text: page(`Laborbuch ${d.book}`, `<h1>Laborbuch „${esc(d.book)}“</h1><p>Export vom ${when(d.exported)} · ${d.entries.length} Einträge</p>
    <table><tr><th>Titel</th><th>Art</th><th>Projekt</th><th>Tags</th><th>Geändert</th><th>Signiert</th></tr>${rows}</table>`, '')});
  texts.push({path: 'index.md', text: `# Laborbuch „${d.book}“\n\nExport vom ${when(d.exported)} · ${d.entries.length} Einträge\n\n| Titel | Art | Projekt | Tags | Geändert |\n| --- | --- | --- | --- | --- |\n`
    + d.entries.map(e => `| [${(e.title || 'Ohne Titel').replace(/\|/g, '\\|')}](${base(e)}.md) | ${KIND_DE[e.kind] || ''} | ${e.project || ''} | ${e.tags || ''} | ${when(e.updated)} |`).join('\n') + '\n'});
  texts.push({path: 'LIESMICH.txt', text: `Export des Laborbuchs „${d.book}“ vom ${when(d.exported)}

Lesbar ohne die App:
  index.html            Übersicht im Browser öffnen; jede Zeile führt zum Eintrag
  entries/*.html|.md    jeder Eintrag als Webseite und als Markdown (mit Kopfdaten)
  files/                alle Anhänge mit Originalnamen (vorne die ersten 12 Zeichen der SHA-256-Prüfsumme)
  data/book.json        vollständige Daten: Einträge, alle Revisionen mit Hash-Kette, Signaturen, Vorlagen, Läufe
  ${d.book}.eln          Austauschformat (RO-Crate), z. B. für eLabFTW

Prüfen: Jede Revision trägt hash = SHA-256(prev_hash, Eintrag, Nummer, Zeitpunkt, Titel, Inhalt – durch Zeilenumbrüche getrennt).
Signaturen sind Ed25519 über „laborbuch-signatur-v1“, Eintrag, Revision, Hash, Name, Zeitpunkt (öffentliche Schlüssel in book.json).
Verlinkte Rohdaten sind nicht im Export enthalten, nur Pfad und Prüfsumme.
`});

  // .eln: ein Ordner je Eintrag mit seinen Dateien; Text als HTML (Bilder verweisen auf lab://files/…, beim Re-Import wieder gültig)
  const root = slug(d.book), graph = [], parts = [], elnCopies = [];
  for (const e of d.entries) {
    const dir = `${String(e.id).padStart(4, '0')}-${slug(e.title)}`;
    const json = withTitles(e.draft_json ? JSON.parse(e.draft_json) : {type: 'doc', content: []});
    H.commands.setContent(json, {emitUpdate: false});
    const files = d.entry_files.filter(f => f.entry_id == e.id).map(f => att.get(f.sha256)).filter(a => a && a.stored == 'copy');
    const fileNodes = files.map(a => ({'@id': `./${dir}/${safeName(a.name)}`, '@type': 'File', name: a.name, encodingFormat: a.mime, contentSize: String(a.size), sha256: a.sha256}));
    files.forEach(a => elnCopies.push({sha: a.sha256, path: `${dir}/${safeName(a.name)}`}));
    parts.push({'@id': `./${dir}/`});
    graph.push({'@id': `./${dir}/`, '@type': 'Dataset', name: e.title || 'Ohne Titel', text: H.getHTML(), dateCreated: e.created, dateModified: e.updated,
      genre: KIND_DE[e.kind] || e.kind, ...(e.tags ? {keywords: e.tags} : {}), hasPart: fileNodes.map(f => ({'@id': f['@id']}))}, ...fileNodes);
  }
  const crate = {'@context': 'https://w3id.org/ro/crate/1.1/context', '@graph': [
    {'@id': 'ro-crate-metadata.json', '@type': 'CreativeWork', about: {'@id': './'}, conformsTo: {'@id': 'https://w3id.org/ro/crate/1.1'},
      dateCreated: d.exported, sdPublisher: {'@id': '#laborbuch'}},
    {'@id': '#laborbuch', '@type': 'Organization', name: 'Laborbuch'},
    {'@id': './', '@type': 'Dataset', name: d.book, dateCreated: d.exported, hasPart: parts}, ...graph]};

  try {
    const r = await call('exportWrite', {texts, copies, eln: {folder: root, metadata: JSON.stringify(crate, null, 1), copies: elnCopies}});
    status(r ? `Exportiert nach ${r.path}` : 'Export abgebrochen');
    return r;
  } catch (e) { status(''); alert('Export fehlgeschlagen: ' + e.message); }
}

// ---------- Eintrag als PDF / PDF/A ----------
async function exportEntryPDF(pdfa) {
  if (!cur) return;
  await flush();
  const [hist, book] = await Promise.all([call('history', {id: cur}), call('book')]);
  const sig = curSigned ? await call('signedRevision', {id: cur}) : null;
  const last = hist[0];
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>
    <div class="head"><b>Laborbuch „${esc(book.name)}“</b> · Eintrag Nr. ${cur}${last ? ` · Revision ${last.no}` : ''} · gedruckt ${when(new Date().toISOString())}
    ${last ? `<br>Revisions-Hash (SHA-256): <span class="hash">${last.hash}</span>` : '<br>Noch keine Revision gesichert'}
    ${sig ? `<br>Abgeschlossen und signiert von <b>${esc(sig.name)}</b> am ${when(sig.signed_at)}` : ''}</div>
    <h1>${esc($('#title').value)}</h1>${withBibliography(editor.getHTML())}</body></html>`;
  status(pdfa ? 'PDF/A wird erstellt …' : 'PDF wird erstellt …');
  try {
    const r = await call('entryPDF', {html, pdfa, hash: last?.hash || '', name: `${$('#title').value || 'Eintrag'}${pdfa ? ' (PDF-A)' : ''}.pdf`});
    status(r ? `${pdfa ? 'PDF/A' : 'PDF'} gespeichert: ${r.path}` : '');
    return r;
  } catch (e) { status(''); alert(e.message); }
}

// ---------- Import ----------
/// Fremdes HTML entschärfen: keine Skripte, keine Bilder aus dem Netz (sonst lädt die App beim Anzeigen fremde Inhalte)
function sanitizeImport(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(n => n.remove());
  doc.querySelectorAll('img').forEach(img => {
    if (!/^lab:\/\/files\/[0-9a-f]{64}$/.test(img.getAttribute('src') || '')) img.replaceWith(doc.createTextNode(img.alt ? `[Bild: ${img.alt}]` : ''));
  });
  return doc.body.innerHTML;
}

async function importFiles(testPaths) {
  let items;
  try { items = await call('importPick', testPaths ? {testPaths} : {}); } catch (e) { return alert('Import fehlgeschlagen: ' + e.message); }
  if (!items?.length) return [];
  await flush();
  const H = headless(), ids = [], today = new Date().toLocaleDateString('de-DE');
  for (const it of items) {
    const html = it.kind == 'markdown' ? MD.fromMarkdown(it.text) : it.html || '';
    H.commands.setContent(sanitizeImport(html), {emitUpdate: false});
    const doc = H.getJSON();
    const used = new Set(); H.state.doc.descendants(n => { if (n.type.name == 'image') used.add(n.attrs.src); });
    const files = it.kind == 'scan' ? [it.file] : it.files || [];
    const extra = files.filter(f => !used.has(`lab://files/${f.sha256}`)).map(f => f.mime.startsWith('image/')
      ? {type: 'image', attrs: {src: `lab://files/${f.sha256}`, alt: f.name}} : {type: 'file', attrs: {sha: f.sha256, name: f.name, mime: f.mime, size: f.size}});
    const recognized = it.kind == 'scan' && it.text ? [{type: 'heading', attrs: {level: 3}, content: [{type: 'text', text: 'Erkannter Text'}]},
      ...it.text.split(/\n+/).filter(l => l.trim()).map(l => ({type: 'paragraph', content: [{type: 'text', text: l}]}))] : [];
    const origin = {type: 'paragraph', content: [{type: 'text', text: `Importiert aus „${it.source}“ am ${today}${it.created ? `, ursprünglich erstellt am ${when(it.created)}` : ''}.`, marks: [{type: 'italic'}]}]};
    const content = {type: 'doc', content: [origin, ...(doc.content || []).filter(n => !(n.type == 'paragraph' && !n.content)), ...extra, ...recognized]};
    H.commands.setContent(content, {emitUpdate: false});
    const id = await call('create', {title: it.title, ...(project > 0 ? {project} : {})});
    await call('save', {id, title: it.title, json: JSON.stringify(content), text: H.getText(), ...collectRefs(content)});
    if (it.tags?.length) await call('setTags', {id, names: it.tags});
    ids.push(id);
  }
  await loadProjects(); await loadTags();
  $('#search').value = '';
  await refreshList(ids[0]);
  status(`${ids.length} Eintrag/Einträge importiert`);
  return ids;
}
