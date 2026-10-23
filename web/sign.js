// Abschließen und Signieren, Nachtrag, Zeugen-PDF, Einstellungen.
// Signiert wird in Swift mit dem Schlüssel aus dem Schlüsselbund; hier nur Oberfläche und Ablauf.
'use strict';

/// Bearbeitbar nur, wenn weder eine alte Revision angezeigt wird noch der Eintrag abgeschlossen ist
function applyLock() {
  const ro = !!preview || !!curSigned || !!curTrashed;
  editor.setEditable(!ro, false);  // false: kein update-Ereignis, sonst würde gespeichert
  $('#title').readOnly = ro;
  $('#toolbar').hidden = ro;
  $('#runBtn').hidden = !!curSigned || !!curTrashed;
  $('#signBtn').hidden = !!curSigned || !!curTrashed;
  $('#trashBtn').hidden = !!curSigned || !!curTrashed;
  $('#saveTpl').hidden = !!curTrashed;
}

async function renderSignInfo() {
  const box = $('#signinfo');
  if (!curSigned) { box.hidden = true; return; }
  const r = await call('signedRevision', {id: cur});
  box.hidden = false;
  box.innerHTML = `<span class="grow">🔏 <b>Abgeschlossen</b> und signiert von ${esc(r.name)} am ${when(r.signed_at)} · Revision ${r.no}
      <br><span class="sub">SHA-256 <code>${r.hash}</code> · Schlüssel ${esc(r.fingerprint)}</span></span>
    <button class="btn" data-witnesspdf>Zeugen-PDF erstellen</button>
    <button class="btn" data-witnessadd>Unterschriebenes PDF anhängen</button>
    <button class="btn on" data-addendum>Nachtrag</button>`;
}

async function signEntry() {
  if (!cur || curSigned) return;
  const s = {...await call('settings'), ai: (await call('aiStatus')).configured};
  if (!s.author?.trim()) { alert('Bitte zuerst in den Einstellungen deinen Namen für Signaturen eintragen.'); return showSettings(); }
  if (!confirm(`Eintrag abschließen und als „${s.author}“ signieren?\n\nDanach lässt er sich nicht mehr ändern; Ergänzungen kommen in einen Nachtrag. Signiert wird mit deinem persönlichen Schlüssel aus dem Schlüsselbund.`)) return;
  await flush();
  try {
    const r = await call('signEntry', {id: cur});
    curSigned = r.no;
    applyLock();
    await renderSignInfo();
    status(`Signiert (Revision ${r.no})`);
    if (!$('#history').hidden) showHistory();
    await refreshList();
  } catch (e) { alert('Signieren fehlgeschlagen: ' + e.message); }
}

/// Nachtrag: neuer Eintrag mit Verweis auf den abgeschlossenen, gleiche Art und gleiches Projekt
async function addendum() {
  const src = await call('load', {id: cur});
  const id = await call('create', {title: `Nachtrag zu ${src.title || 'Eintrag'}`, kind: src.kind, ...(src.project_id ? {project: src.project_id} : {})});
  await refreshList(id);
  editor.commands.setContent({type: 'doc', content: [
    {type: 'paragraph', content: [{type: 'text', text: 'Nachtrag zu '}, {type: 'mention', attrs: {id: String(src.id), label: src.title || 'Ohne Titel'}}, {type: 'text', text: ': '}]},
    {type: 'paragraph'}]});
  changed(); await flush();
  editor.commands.focus('end');
}

/// Druckformat für Zeugen-PDF und PDF-Export
const PRINT_CSS = `body{font:11pt/1.5 -apple-system,"Helvetica Neue",sans-serif;color:#111;margin:0}
    h1{font:600 18pt/1.25 "New York",Georgia,serif;margin:0 0 4pt} h2,h3{font-family:"New York",Georgia,serif;margin:14pt 0 4pt}
    .head{border:1px solid #999;border-radius:4pt;padding:8pt 10pt;margin-bottom:14pt;font-size:9pt}
    code,.hash{font:8.5pt/1.4 Menlo,monospace;word-break:break-all}
    img{max-width:100%;height:auto} table{border-collapse:collapse;width:100%;margin:6pt 0} td,th{border:1px solid #999;padding:3pt 5pt;vertical-align:top;font-size:10pt}
    ul[data-type=taskList]{list-style:none;padding-left:0} a{color:#111;text-decoration:none}
    figure.annot{position:relative;display:inline-block;margin:6pt 0;max-width:100%} figure.annot img{display:block;max-width:100%}
    figure.annot svg{position:absolute;inset:0;width:100%;height:100%}
    .platetab{border-collapse:collapse;font-size:6.5pt;width:auto} .platetab td,.platetab th{border:1px solid #bbb;width:5.5mm;height:4.5mm;padding:0;text-align:center}
    div[data-calc],div[data-file]{border:1px solid #bbb;border-radius:4pt;padding:5pt 8pt;margin:6pt 0;font-size:10pt}
    .sign{margin-top:22pt;page-break-inside:avoid;border-top:1px solid #999;padding-top:10pt;font-size:10pt}
    .line{display:flex;gap:24pt;margin-top:28pt}.line div{flex:1;border-top:1px solid #333;padding-top:3pt;font-size:9pt;color:#444}`;

/// HTML für das Zeugen-PDF: Kopf mit Hash und Signatur, Inhalt, Felder für Unterschriften
function witnessHTML(r, book) {
  const css = PRINT_CSS;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="head"><b>Laborbuch „${esc(book)}“</b> · Eintrag Nr. ${cur} · Revision ${r.no}<br>
      Abgeschlossen und signiert von <b>${esc(r.name)}</b> am ${when(r.signed_at)} (Ed25519, Schlüssel ${esc(r.fingerprint)})<br>
      Revisions-Hash (SHA-256): <span class="hash">${r.hash}</span></div>
    <h1>${esc($('#title').value)}</h1>
    ${withBibliography(editor.getHTML())}
    <div class="sign"><b>Gegenzeichnung</b><br>Ich habe den oben stehenden Eintrag gelesen und verstanden.<br>
      Er gehört zur Revision mit dem SHA-256-Hash <span class="hash">${r.hash}</span>.
      <div class="line"><div>Name des Zeugen</div><div>Datum</div><div>Unterschrift</div></div></div>
  </body></html>`;
}

async function makeWitnessPDF() {
  const [r, book] = await Promise.all([call('signedRevision', {id: cur}), call('book')]);
  status('Zeugen-PDF wird erstellt …');
  try {
    const out = await call('witnessPDF', {id: cur, html: witnessHTML(r, book.name), name: `Zeuge – ${$('#title').value || 'Eintrag'} (Rev ${r.no}).pdf`});
    status(out ? `Zeugen-PDF gespeichert: ${out.path}` : 'Zeugen-PDF nicht gespeichert');
    return out;
  } catch (e) { status(''); alert('Zeugen-PDF fehlgeschlagen: ' + e.message); }
}

async function attachWitness(testPath) {
  const name = prompt('Name des Zeugen');
  if (!name?.trim()) return;
  try {
    const w = await call('attachWitness', {id: cur, name, ...(testPath ? {testPath} : {})});
    if (!w) return;
    status(w.hash_found ? `Zeuge ${w.name} vermerkt – Hash im PDF gefunden` : `Zeuge ${w.name} vermerkt – Hash nicht im PDF gefunden, bitte Ausdruck prüfen`);
    if (!$('#history').hidden) showHistory(); else { $('#history').hidden = false; showHistory(); }
    return w;
  } catch (e) { alert('Anhängen fehlgeschlagen: ' + e.message); }
}

// ---------- Einstellungen ----------
async function showSettings() {
  const s = await call('settings');
  const dlg = $('#settings');
  dlg.innerHTML = `<form method="dialog"><h3>Einstellungen</h3>
    <label class="row">Name für Signaturen <input id="setAuthor" value="${esc(s.author)}" autocomplete="off"></label>
    <p class="sub">Persönlicher Signaturschlüssel: ${s.fingerprint ? `<code>${esc(s.fingerprint)}</code> (im Schlüsselbund)` : 'wird beim ersten Signieren angelegt und im Schlüsselbund gespeichert'}</p>
    <label class="row"><input type="checkbox" id="setLock" ${s.lockEnabled ? 'checked' : ''}> Mit Touch ID sperren (beim Start und wenn der Mac schläft)</label>
    <label class="row">… und nach <input id="setLockMin" type="number" min="0" max="240" value="${s.lockMinutes}" style="width:70px"> Minuten ohne Eingabe (0 = nie)</label>
    <p class="row"><b>Sicherung</b></p>
    <p class="sub">Täglich automatisch nach <code id="bkDir">${esc(s.backupDir)}</code><br>Letzte Sicherung: <span id="bkLast">${s.lastBackup ? when(s.lastBackup) : 'noch keine'}</span></p>
    <p class="row"><button type="button" class="btn" id="bkChoose">Anderen Ordner wählen …</button><button type="button" class="btn" id="bkNow">Jetzt sichern</button></p>
    <p class="row"><b>KI-Assistent</b></p>
    <p class="sub" id="aiState">${s.ai ? 'Eingerichtet – Schlüssel im Schlüsselbund. Zusammenfassen, Protokoll und „✨ Fragen“ sind sichtbar.' : 'Aus. Mit einem eigenen Anthropic-API-Schlüssel (console.anthropic.com) erscheinen Zusammenfassen, Protokoll aus Stichpunkten und Fragen an das Laborbuch. Gesendet wird nur auf Klick, nach einer Vorschau.'}</p>
    <p class="row"><input id="aiKey" type="password" placeholder="${s.ai ? 'neuer Schlüssel …' : 'sk-ant-…'}" autocomplete="off" style="flex:1"><button type="button" class="btn" id="aiSave">Schlüssel sichern</button>${s.ai ? '<button type="button" class="btn danger" id="aiDel">Entfernen</button>' : ''}</p>
    <p class="row"><b>Updates</b></p>
    <p class="sub">Laborbuch ${esc(s.version)} · <span id="upMsg">neue Versionen kommen über GitHub-Releases</span></p>
    <p class="row"><button type="button" class="btn" id="upCheck">Nach Updates suchen</button><button type="button" class="btn on" id="upGo" hidden>Aktualisieren und neu starten</button></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button value="ok" class="btn on" id="setSave">Sichern</button></div></form>`;
  dlg.showModal();
  $('#upCheck').onclick = async () => {
    $('#upMsg').textContent = 'suche …';
    try {
      const r = await call('updateCheck');
      $('#upMsg').textContent = !r.available ? 'aktuell' : r.canInstall ? `Version ${r.latest} ist verfügbar` : `Version ${r.latest} ist verfügbar – ${r.reason}`;
      $('#upGo').hidden = !(r.available && r.canInstall);
    } catch (e) { $('#upMsg').textContent = 'Suche fehlgeschlagen: ' + e.message; }
  };
  $('#upGo').onclick = async () => {
    if (!confirm('Update laden, prüfen und die App neu starten? Dein Stand wird vorher gespeichert.')) return;
    $('#upGo').disabled = true;
    try { await call('updateInstall'); } catch (e) { $('#upMsg').textContent = 'Update fehlgeschlagen: ' + e.message; $('#upGo').disabled = false; }
  };
  $('#aiSave').onclick = async () => {
    try { await call('aiSetKey', {key: $('#aiKey').value}); $('#aiKey').value = ''; await refreshAI(); $('#aiState').textContent = AI_ON ? 'Eingerichtet – Schlüssel im Schlüsselbund.' : 'Aus.'; }
    catch (e) { $('#aiState').textContent = e.message; }
  };
  if ($('#aiDel')) $('#aiDel').onclick = async () => { await call('aiSetKey', {key: null}); await refreshAI(); $('#aiState').textContent = 'Aus – Schlüssel entfernt.'; $('#aiDel').remove(); };
  $('#bkChoose').onclick = async () => { const p = await call('chooseBackupDir'); if (p) $('#bkDir').textContent = (await call('settings')).backupDir; };
  $('#bkNow').onclick = async () => { const r = await backupNow(); if (r) $('#bkLast').textContent = when(new Date().toISOString()); };
  dlg.onclose = async () => {
    if (dlg.returnValue != 'ok') return;
    await call('setSettings', {author: $('#setAuthor').value, lockEnabled: $('#setLock').checked, lockMinutes: Math.round(+$('#setLockMin').value || 0)});
    status('Einstellungen gesichert');
  };
}

document.addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.witnesspdf !== undefined) makeWitnessPDF();
  else if (d.witnessadd !== undefined) attachWitness();
  else if (d.addendum !== undefined) addendum();
  else if (d.openpdf) { e.preventDefault(); call('openFile', {sha256: d.openpdf, name: 'Zeugen-PDF.pdf'}).catch(err => alert(err.message)); }
});

async function backupNow() {
  await flush();
  status('Sicherung läuft …');
  try { const r = await call('backupNow'); status(`Gesichert (${r.copied} neue Datei(en)) nach ${r.dir}`); return r; }
  catch (e) { status(''); alert('Sicherung fehlgeschlagen: ' + e.message); }
}

/// Fortschritt des Updates (vom Swift-Teil)
function updateProgress(stage) {
  const t = {download: 'Update wird geladen …', install: 'Update wird geprüft …', restart: 'Neustart …'}[stage] || stage;
  status(t);
  const m = document.querySelector('#upMsg'); if (m) m.textContent = t;
}
