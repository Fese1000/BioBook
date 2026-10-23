// Einträge verwalten: Status mit Farbe, Anheften, Duplizieren, Sortieren/Filtern, gespeicherte Suchen, Mehrfachauswahl,
// Versionen vergleichen (Wort-Diff) und Prüfung vor dem Abschließen. Reine Funktionen oben (tests/manage.test.js).
(function (root) {
  'use strict';

  const STATUS = {'': ['—', ''], laufend: ['laufend', '#2a78d6'], fertig: ['fertig', '#3a8f5c'], fehlgeschlagen: ['fehlgeschlagen', '#c0392b'], pausiert: ['pausiert', '#8a8a8a']};

  /// Wörter samt Leerraum, damit der Diff den Text exakt wieder zusammensetzt
  const tokens = s => String(s).match(/\s+|[^\s]+/g) || [];

  /// Myers-Diff auf Wörtern: [{op: '=', '+', '-', text}]
  function diffWords(a, b) {
    const x = tokens(a), y = tokens(b), n = x.length, m = y.length, max = n + m, off = max;
    if (max > 60000) return [{op: '-', text: String(a)}, {op: '+', text: String(b)}];  // sehr lange Texte: grob
    const v = new Int32Array(2 * max + 2), trace = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let i = k == -d || (k != d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let j = i - k;
        while (i < n && j < m && x[i] == y[j]) { i++; j++; }
        v[off + k] = i;
        if (i >= n && j >= m) { found = true; break; }
      }
    }
    // Rückweg
    const out = [];
    let i = n, j = m;
    for (let d = trace.length - 1; d >= 0 && (i > 0 || j > 0); d--) {
      const vv = trace[d], k = i - j;
      const down = k == -d || (k != d && vv[off + k - 1] < vv[off + k + 1]);
      const pk = down ? k + 1 : k - 1, pi = vv[off + pk], pj = pi - pk;
      while (i > pi && j > pj) { out.push({op: '=', text: x[--i]}); j--; }
      if (d > 0) { if (down) out.push({op: '+', text: y[--j]}); else out.push({op: '-', text: x[--i]}); }
    }
    while (i > 0 && j > 0) { out.push({op: '=', text: x[--i]}); j--; }
    // zusammenfassen
    const merged = [];
    for (const p of out.reverse()) { const last = merged[merged.length - 1]; if (last && last.op == p.op) last.text += p.text; else merged.push({...p}); }
    return merged;
  }

  /// Hinweise vor dem Abschließen (nichts davon verhindert es): [{level: 'warn'|'info', text}]
  function preflight(doc, title) {
    const out = [], walk = (n, f) => { f(n); (n.content || []).forEach(c => walk(c, f)); };
    let text = '', openTasks = 0, unbooked = 0, unbookedCult = 0, emptyRes = 0, emptyDays = [];
    walk(doc, n => {
      if (n.type == 'text') text += n.text;
      if (n.type == 'taskItem' && !n.attrs?.checked) openTasks++;
      if (n.type == 'usage' && n.attrs?.lot && !n.attrs?.move) unbooked++;
      if (n.type == 'cultev' && n.attrs?.culture && !n.attrs?.event) unbookedCult++;
      if (n.type == 'results' && !(n.attrs?.rows || []).some(r => Object.values(r || {}).some(v => String(v ?? '').trim()))) emptyRes++;
      if (n.type == 'day' && !JSON.stringify(n.content || []).match(/"text":"[^"]*\S/)) emptyDays.push(n.attrs?.date);
    });
    if (!String(title || '').trim()) out.push({level: 'warn', text: 'Der Eintrag hat keinen Titel.'});
    if (!text.trim() && !JSON.stringify(doc).match(/"type":"(image|file|plate|results|chart|chem|calc|seqref|extblock)"/)) out.push({level: 'warn', text: 'Der Eintrag ist leer.'});
    if (unbooked) out.push({level: 'warn', text: `${unbooked} Verbrauch-Block/Blöcke noch nicht verbucht – der Bestand stimmt sonst nicht.`});
    if (unbookedCult) out.push({level: 'warn', text: `${unbookedCult} Passage-Block/Blöcke noch nicht verbucht.`});
    if (emptyRes) out.push({level: 'warn', text: `${emptyRes} Ergebnistabelle(n) ohne Werte.`});
    if (emptyDays.length) out.push({level: 'info', text: `Leere Tagesabschnitte: ${emptyDays.join(', ')}`});
    if (openTasks) out.push({level: 'info', text: `${openTasks} offene Aufgabe(n) in Checklisten.`});
    return out;
  }

  /// Liste filtern und sortieren (Felder wie von „list“/„search“)
  function filterSort(rows, {kind = '', status = '', from = '', to = '', sort = 'updated'} = {}) {
    const day = r => (r.day_last || r.updated || '').slice(0, 10), dayFrom = r => (r.day_first || r.created || r.updated || '').slice(0, 10);
    const keep = rows.filter(r => (!kind || r.kind == kind) && (!status || (status == '—' ? !r.status : r.status == status))
      && (!from || day(r) >= from) && (!to || dayFrom(r) <= to));
    const cmp = {updated: (a, b) => b.updated.localeCompare(a.updated), created: (a, b) => (b.created || '').localeCompare(a.created || ''),
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'de', {numeric: true}), opened: (a, b) => (b.opened || '').localeCompare(a.opened || ''),
      days: (a, b) => (b.day_last || '').localeCompare(a.day_last || '')}[sort] || (() => 0);
    return keep.sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || cmp(a, b));
  }

  const Manage = {STATUS, diffWords, preflight, filterSort, tokens};
  if (typeof module != 'undefined' && module.exports) module.exports = Manage; else root.Manage = Manage;
})(this);

// ---------- Oberfläche ----------
const LISTF = {kind: '', status: '', from: '', to: '', sort: 'updated'};
let LIST_SELECT = null;  // Set der markierten Einträge (Mehrfachauswahl) oder null
const listFiltered = () => !!(LISTF.kind || LISTF.status || LISTF.from || LISTF.to);
const statusDot = st => st && Manage.STATUS[st] ? `<span class="stdot" style="background:${Manage.STATUS[st][1]}" title="${esc(Manage.STATUS[st][0])}"></span>` : '';

function renderListBar() {
  $('#listbar').innerHTML = `<select id="lfSort" title="Sortieren">${[['updated', 'Zuletzt geändert'], ['opened', 'Zuletzt geöffnet'], ['created', 'Erstellt'], ['days', 'Zeitraum'], ['title', 'Titel']]
      .map(([k, t]) => `<option value="${k}" ${LISTF.sort == k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="btn ${listFiltered() ? 'on' : ''}" id="lfBtn" title="Nach Art, Status und Zeitraum filtern">Filter${listFiltered() ? ' ●' : ''}</button>
    ${listFiltered() || $('#search').value.trim() ? '<button class="btn" id="lfSave" title="Diese Suche/Filter merken">☆</button>' : ''}
    <button class="btn ${LIST_SELECT ? 'on' : ''}" id="lfSel" title="Mehrere Einträge auswählen">☑</button>`;
  $('#listsel').hidden = !LIST_SELECT;
  if (LIST_SELECT) $('#listsel').innerHTML = `<span>${LIST_SELECT.size} ausgewählt</span><button class="btn" data-bulk="project">Projekt …</button><button class="btn" data-bulk="tag">Tag …</button>
    <button class="btn" data-bulk="status">Status …</button><button class="btn danger" data-bulk="trash">🗑</button>`;
}

function filterDialog() {
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Liste filtern</h3>
    <label class="rf"><span>Art</span><select id="fKind"><option value="">alle</option>${Object.entries(KINDS).map(([k, t]) => `<option value="${k}" ${LISTF.kind == k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="rf"><span>Status</span><select id="fStatus"><option value="">alle</option>${Object.entries(Manage.STATUS).map(([k, [t]]) => `<option value="${k || '—'}" ${LISTF.status == (k || '—') ? 'selected' : ''}>${t == '—' ? 'ohne Status' : t}</option>`).join('')}</select></label>
    <label class="rf"><span>Zeitraum</span><div><input id="fFrom" type="date" value="${LISTF.from}"> bis <input id="fTo" type="date" value="${LISTF.to}"></div></label>
    <div class="dlgbtns"><button type="button" class="btn" id="fClear">Zurücksetzen</button><span class="grow"></span><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="fOk">Anwenden</button></div></form>`;
  dlg.showModal();
  $('#fClear').onclick = () => { Object.assign(LISTF, {kind: '', status: '', from: '', to: ''}); dlg.close(); refreshList(); };
  $('#fOk').onclick = () => { Object.assign(LISTF, {kind: $('#fKind').value, status: $('#fStatus').value, from: $('#fFrom').value, to: $('#fTo').value}); dlg.close(); refreshList(); };
}

async function renderSavedSearches() {
  const ss = await call('savedSearches');
  $('#savedsec').hidden = !ss.length;
  $('#savedlist').innerHTML = ss.map(x => `<li data-ss="${x.id}" data-q="${esc(x.query_json)}"><span class="n">☆ ${esc(x.name)}</span><button class="x" data-ssdel="${x.id}" title="Entfernen">×</button></li>`).join('');
}

async function saveCurrentSearch() {
  const name = prompt('Name der gespeicherten Suche:', LISTF.status ? Manage.STATUS[LISTF.status]?.[0] || 'Suche' : $('#search').value.trim() || 'Suche');
  if (!name) return;
  await call('saveSearch', {name, query: {...LISTF, q: $('#search').value.trim()}});
  renderSavedSearches();
}

function applySavedSearch(json) {
  const q = parseJSON(json, {});
  Object.assign(LISTF, {kind: q.kind || '', status: q.status || '', from: q.from || '', to: q.to || '', sort: q.sort || 'updated'});
  $('#search').value = q.q || '';
  refreshList();
}

async function bulkAction(kind) {
  const ids = [...(LIST_SELECT || [])]; if (!ids.length) return;
  try {
    if (kind == 'project') {
      const names = projects.filter(p => !p.archived).map((p, i) => `${i + 1}: ${p.name}`).join('\n');
      const pick = prompt(`In welches Projekt? (0 = ohne Projekt)\n${names}`, '0'); if (pick == null) return;
      const p = +pick ? projects.filter(x => !x.archived)[+pick - 1]?.id : 0; if (p == null) return;
      for (const id of ids) await call('setMeta', {id, project: p});
    } else if (kind == 'tag') {
      const t = prompt('Welcher Tag soll dazu?'); if (!t?.trim()) return;
      for (const id of ids) { const e = await call('load', {id}); await call('setTags', {id, names: [...(e.tags || []), t.trim()]}); }
      await loadTags();
    } else if (kind == 'status') {
      const keys = Object.keys(Manage.STATUS);
      const pick = prompt(`Welcher Status?\n${keys.map((k, i) => `${i}: ${Manage.STATUS[k][0]}`).join('\n')}`, '1'); if (pick == null || !keys[+pick] && +pick != 0) return;
      for (const id of ids) await call('setEntryFlags', {id, status: keys[+pick]});
    } else if (kind == 'trash') {
      if (!confirm(`${ids.length} Einträge in den Papierkorb legen? (abgeschlossene bleiben)`)) return;
      for (const id of ids) await call('trashEntry', {id}).catch(() => {});
      if (ids.includes(cur)) { cur = null; showView('doc'); }
    }
  } catch (e) { alert(e.message); }
  LIST_SELECT = new Set(); refreshList();
  status(`${ids.length} Einträge geändert`);
}

/// Kopf des Eintrags: Status, Anheften, Duplizieren
async function renderEntryFlags() {
  if (!cur) return;
  const e = await call('load', {id: cur});
  $('#metaStatus').innerHTML = Object.entries(Manage.STATUS).map(([k, [t]]) => `<option value="${k}" ${e.status == k ? 'selected' : ''}>${t == '—' ? 'Status' : t}</option>`).join('');
  $('#metaStatus').style.borderColor = Manage.STATUS[e.status]?.[1] || '';
  $('#pinBtn').classList.toggle('on', !!e.pinned); $('#pinBtn').title = e.pinned ? 'Nicht mehr anheften' : 'Oben in der Liste anheften';
}

/// Kopie: verbuchte Blöcke (Verbrauch, Passage) gelten in der Kopie als noch nicht verbucht
function resetBookings(doc) {
  const walk = n => {
    if (n.type == 'usage') n.attrs = {...n.attrs, move: null, at: null, rest: null, canceled: null};
    if (n.type == 'cultev') n.attrs = {...n.attrs, event: null, from: null, passage: null, day: null};
    (n.content || []).forEach(walk);
  };
  walk(doc); return doc;
}

async function duplicateEntry() {
  if (!cur) return;
  await flush();
  const nid = await call('duplicateEntry', {id: cur});
  const e = await call('load', {id: nid});
  await refreshList(nid);
  editor.commands.setContent(resetBookings(parseJSON(e.draft_json, {type: 'doc', content: []})), {emitUpdate: false});
  changed(); await flush();
  status('Kopie angelegt – Verbrauch und Passagen sind darin noch nicht verbucht');
  return nid;
}

/// Revision mit dem aktuellen Stand vergleichen: eingefügt grün, gelöscht rot (rechts daneben)
async function showDiff(no) {
  const [r, e] = await Promise.all([call('revision', {id: cur, no}), call('load', {id: cur})]);
  const H = aiHelperEditor(), txt = json => { H.commands.setContent(parseJSON(json, {type: 'doc', content: []}), {emitUpdate: false}); return H.getText({blockSeparator: '\n'}); };
  const parts = Manage.diffWords(`${r.title}\n${txt(r.content_json)}`, `${e.title}\n${txt(e.draft_json)}`);
  const ins = parts.filter(p => p.op == '+').reduce((a, p) => a + p.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const del = parts.filter(p => p.op == '-').reduce((a, p) => a + p.text.trim().split(/\s+/).filter(Boolean).length, 0);
  SIDE = -no;
  $('#history').hidden = true;
  $('#sidepane').hidden = false;
  $('#sidepane').innerHTML = `<div class="sidehead"><b>Revision ${no} → aktueller Stand</b><span class="sub">+${ins} / −${del} Wörter</span><span class="grow"></span><button class="x" data-sideclose title="Schließen">×</button></div>
    <div class="sidebody diffbody">${parts.map(p => p.op == '=' ? esc(p.text) : p.op == '+' ? `<ins>${esc(p.text)}</ins>` : `<del>${esc(p.text)}</del>`).join('').replace(/\n/g, '<br>')}</div>`;
  return {ins, del};
}

/// Vor dem Abschließen: Hinweise zeigen; true = trotzdem abschließen
function preflightConfirm() {
  const notes = Manage.preflight(editor.getJSON(), $('#title').value);
  if (!notes.length) return Promise.resolve(true);
  if (window.TESTING) { window.PREFLIGHT_SEEN = notes; return Promise.resolve(window.PREFLIGHT_GO ?? true); }
  return new Promise(res => {
    const dlg = $('#locdlg');
    dlg.innerHTML = `<form method="dialog"><h3>Vor dem Abschließen</h3><ul class="preflight">${notes.map(n => `<li class="${n.level}">${n.level == 'warn' ? '⚠' : 'ℹ'} ${esc(n.text)}</li>`).join('')}</ul>
      <p class="sub">Nach dem Abschließen lässt sich der Eintrag nicht mehr ändern.</p>
      <div class="dlgbtns"><button value="cancel" class="btn on">Zurück zum Eintrag</button><button value="ok" class="btn">Trotzdem abschließen</button></div></form>`;
    dlg.onclose = () => res(dlg.returnValue == 'ok');
    dlg.showModal();
  });
}

function initManage() {
  $('#listbar').addEventListener('change', e => { if (e.target.id == 'lfSort') { LISTF.sort = e.target.value; refreshList(); } });
  $('#listbar').addEventListener('click', e => {
    if (e.target.id == 'lfBtn') filterDialog();
    if (e.target.id == 'lfSave') saveCurrentSearch();
    if (e.target.id == 'lfSel') { LIST_SELECT = LIST_SELECT ? null : new Set(); refreshList(); }
  });
  $('#listsel').addEventListener('click', e => { const b = e.target.dataset.bulk; if (b) bulkAction(b); });
  $('#savedlist').addEventListener('click', async e => {
    if (e.target.dataset.ssdel) { await call('deleteSavedSearch', {id: +e.target.dataset.ssdel}); return renderSavedSearches(); }
    const li = e.target.closest('[data-ss]'); if (li) applySavedSearch(li.dataset.q);
  });
  $('#metaStatus').addEventListener('change', async e => { await call('setEntryFlags', {id: cur, status: e.target.value}); renderEntryFlags(); refreshList(); });
  $('#pinBtn').onclick = async () => { const on = !$('#pinBtn').classList.contains('on'); await call('setEntryFlags', {id: cur, pinned: on}); renderEntryFlags(); refreshList(); };
  $('#dupBtn').onclick = () => duplicateEntry();
  $('#preview').addEventListener('click', e => { if (e.target.dataset.diff) showDiff(+e.target.dataset.diff); });
  renderSavedSearches();
}
