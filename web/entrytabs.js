// Reiter am Eintrag: Notizen | Metadaten | Verknüpft | angehängte Protokolle (öffnen sich rechts daneben) | + Protokoll.
'use strict';

let ETAB = 'notes', SIDE = null;  // SIDE: Eintrags-ID des Protokolls im rechten Fenster

async function renderEntryTabs() {
  if (!cur) return;
  const [atts, e] = await Promise.all([call('attachments', {id: cur}), call('load', {id: cur})]);
  const meta = parseJSON(e.meta_json, []), ro = !!e.signed_no || !!e.deleted;
  $('#etabs').innerHTML = `<button class="etab ${ETAB == 'notes' ? 'on' : ''}" data-etab="notes">Notizen</button>
    <button class="etab ${ETAB == 'meta' ? 'on' : ''}" data-etab="meta">Metadaten${meta.length ? ` <span class="ecount">${meta.length}</span>` : ''}</button>
    <button class="etab ${ETAB == 'rel' ? 'on' : ''}" data-etab="rel">Verknüpft</button>
    ${atts.map(p => `<span class="etab proto ${SIDE == p.id ? 'on' : ''}" data-eside="${p.id}" title="${p.explicit ? 'angehängt' : 'im Text verlinkt'} – Klick öffnet es daneben">📋 ${esc(p.title || 'Ohne Titel')}${p.explicit && !ro ? `<button class="x" data-edetach="${p.id}" title="Abhängen">×</button>` : ''}</span>`).join('')}
    ${ro ? '' : '<button class="etab add" data-eadd>+ Protokoll</button>'}`;
  return {atts, meta, ro};
}

function showEntryTab(tab) {
  ETAB = tab;
  $('#metapanel').hidden = tab != 'meta';
  $('#relpanel').hidden = tab != 'rel';
  for (const id of ['#toolbar', '#editor']) $(id).hidden = tab != 'notes';
  if (tab == 'meta') renderMetaPanel();
  if (tab == 'rel') renderRelPanel();
  renderEntryTabs();
}

async function renderMetaPanel() {
  const [e, keys] = await Promise.all([call('load', {id: cur}), call('metaKeys')]);
  const meta = parseJSON(e.meta_json, []), ro = !!e.signed_no || !!e.deleted;
  const row = f => `<div class="mrow"><input data-mk list="metakeys" value="${esc(f.k)}" placeholder="Bezeichnung, z. B. Organismus" ${ro ? 'readonly' : ''}>
    <input data-mv value="${esc(f.v)}" placeholder="Wert" ${ro ? 'readonly' : ''}>${ro ? '' : '<button class="x" data-mdel title="Entfernen">×</button>'}</div>`;
  $('#metapanel').innerHTML = `<p class="sub">Eigene Felder für diesen Eintrag, z. B. Organismus, Stamm, Projektnummer. Sie gehören zum Eintrag und stehen im Export.</p>
    <div id="mrows">${(meta.length ? meta : ro ? [] : [{k: '', v: ''}]).map(row).join('') || '<p class="sub">Keine Felder.</p>'}</div>
    <datalist id="metakeys">${keys.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    ${ro ? '<p class="sub">Abgeschlossen – Felder sind schreibgeschützt.</p>' : `<p><button class="btn" data-madd>+ Feld</button> <button class="btn on" data-msave>Sichern</button> <span id="mmsg" class="sub"></span></p>`}`;
  $('#metapanel')._row = row;
}

async function saveMeta() {
  const fields = [...document.querySelectorAll('#mrows .mrow')].map(r => ({k: r.querySelector('[data-mk]').value, v: r.querySelector('[data-mv]').value}));
  try { await call('setEntryMeta', {id: cur, fields}); $('#mmsg').textContent = 'Gesichert'; renderEntryTabs(); return true; }
  catch (e) { $('#mmsg').textContent = e.message; return false; }
}

async function renderRelPanel() {
  const r = await call('related', {id: cur});
  const sec = (title, items, fn) => items.length ? `<h4>${title} <span class="sub">${items.length}</span></h4><ul class="rellist">${items.map(i => `<li>${fn(i)}</li>`).join('')}</ul>` : '';
  const kinds = s => (s || '').split(',').filter(Boolean).map(k => (typeof CEV != 'undefined' && CEV[k]) || (typeof DLOG != 'undefined' && DLOG[k]) || k).filter((k, i, a) => a.indexOf(k) == i).join(', ');
  const html = sec('Registry-Objekte', r.entities, e => `<a href="#" data-rent="${e.id}">${esc(e.icon)} <code>${esc(e.code)}</code> ${esc(e.name)}</a> <span class="sub">${esc(e.type)}</span>`)
    + sec('Chargen (Verbrauch)', r.lots, l => `<a href="#" data-rlot="${l.id}"><code>${l.code}</code> ${esc(l.name)}</a> <span class="sub">${Calc.fmt(+l.delta)} ${esc(l.unit)} in ${l.moves} Buchung(en)</span>`)
    + sec('Zellkulturen', r.cultures, c => `<a href="#" data-rcult="${c.id}"><code>${c.code}</code> ${esc(c.name)}</a> <span class="sub">${esc(kinds(c.kinds))}</span>`)
    + sec('Geräte', r.devices, d => `<a href="#" data-rdev="${d.id}">${esc(d.name)}</a> <span class="sub">${esc(kinds(d.kinds))}</span>`)
    + sec('Verweist auf', r.links, e => `<a href="#" class="elink" data-entry="${e.id}">${e.kind == 'protocol' ? '📋' : '↗'} ${esc(e.title || 'Ohne Titel')}</a>`)
    + sec('Wird verwiesen von', r.backlinks, e => `<a href="#" class="elink" data-entry="${e.id}">↙ ${esc(e.title || 'Ohne Titel')}</a>`)
    + sec('Literatur', r.references, x => `<a href="#" data-rref="${x.id}">${esc(x.key)}</a> <span class="sub">${esc(x.title)}</span>`)
    + sec('Ergebnistabellen', r.results, x => `${esc(x.name)} <span class="sub">${x.rows} Zeile(n)</span>`)
    + sec('Dateien', r.files, f => `${esc(f.name)} <span class="sub">${esc(f.mime)}</span>`);
  $('#relpanel').innerHTML = html || '<p class="sub">Noch nichts verknüpft. Mit @ auf Registry-Objekte verweisen, mit [[ auf Einträge; Verbrauch, Passagen und Geräte erscheinen hier automatisch.</p>';
}

/// Protokoll rechts neben dem Eintrag zeigen (nur lesen)
async function openSide(id) {
  if (SIDE == id) return closeSide();
  const e = await call('load', {id});
  SIDE = id;
  $('#history').hidden = true;  // rechts nur ein Fenster: Protokoll oder Verlauf
  const H = aiHelperEditor();
  H.commands.setContent(parseJSON(e.draft_json, {type: 'doc', content: []}), {emitUpdate: false});
  $('#sidepane').hidden = false;
  $('#sidepane').innerHTML = `<div class="sidehead"><b>📋 ${esc(e.title || 'Ohne Titel')}</b>${e.signed_no ? ' <span class="wbadge mut">abgeschlossen</span>' : ''}
      <span class="grow"></span><button class="btn" data-sideopen="${id}" title="Als Haupteintrag öffnen">Öffnen</button><button class="x" data-sideclose title="Schließen">×</button></div>
    <div class="sidebody ProseMirror">${H.getHTML()}</div>`;
  renderEntryTabs();
}
function closeSide() { SIDE = null; $('#sidepane').hidden = true; renderEntryTabs(); }

/// Protokoll anhängen: bestehendes Protokoll oder neu aus einer Vorlage; optional im Text verweisen
async function protocolDialog() {
  const [entries, tpls] = await Promise.all([call('list', {}), call('templates')]);
  const protos = entries.filter(e => e.kind == 'protocol' && e.id != cur);
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Protokoll anhängen</h3>
    <input id="pdQ" placeholder="Protokoll suchen" autocomplete="off" style="width:100%">
    <div id="pdList" class="cilist">${protos.map(p => `<div class="cirow" data-pdid="${p.id}">📋 ${esc(p.title || 'Ohne Titel')}</div>`).join('') || '<p class="sub">Noch keine Einträge der Art „Protokoll“.</p>'}</div>
    ${tpls.filter(t => !t.archived).length ? `<p class="sub">Oder neu aus einer Vorlage: <select id="pdTpl"><option value="">—</option>${tpls.filter(t => !t.archived).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></p>` : ''}
    <label class="row"><input type="checkbox" id="pdInline" checked> im Text verweisen („nach …“)</label>
    <p id="pdMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button></div></form>`;
  dlg.showModal();
  $('#pdQ').oninput = e => { const q = e.target.value.toLowerCase(); document.querySelectorAll('#pdList [data-pdid]').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(q)); };
  $('#pdList').onclick = e => { const r = e.target.closest('[data-pdid]'); if (r) { dlg.close(); attachProtocol(+r.dataset.pdid, {inline: $('#pdInline').checked}); } };
  if ($('#pdTpl')) $('#pdTpl').onchange = async e => {
    if (!e.target.value) return;
    try { const id = await call('createFromTemplate', {id: +e.target.value}); await call('setMeta', {id, kind: 'protocol'}); dlg.close(); attachProtocol(id, {inline: $('#pdInline').checked}); }
    catch (err) { $('#pdMsg').textContent = err.message; }
  };
}

async function attachProtocol(pid, {inline = true} = {}) {
  await flush();
  try { await call('attachEntry', {id: cur, other: pid}); } catch (e) { return alert(e.message); }
  if (inline) {
    const p = await call('load', {id: pid});
    const {from} = editor.state.selection, before = from > 1 ? editor.state.doc.textBetween(from - 1, from, '\n', ' ') : '';
    editor.chain().focus().insertContent([{type: 'text', text: (before && !/\s/.test(before) ? ' ' : '') + 'nach '}, {type: 'mention', attrs: {id: String(pid), label: p.title || 'Ohne Titel'}}, {type: 'text', text: ' '}]).run();
    changed(); await flush();
  }
  await renderEntryTabs();
}

function initEntryTabs() {
  $('#etabs').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.edetach) { e.stopPropagation(); await call('detachEntry', {id: cur, other: +d.edetach}).catch(err => alert(err.message)); if (SIDE == +d.edetach) closeSide(); return renderEntryTabs(); }
    const t = e.target.closest('[data-etab]'); if (t) return showEntryTab(t.dataset.etab);
    const s = e.target.closest('[data-eside]'); if (s) return openSide(+s.dataset.eside);
    if (e.target.closest('[data-eadd]')) return protocolDialog();
  });
  $('#metapanel').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.madd !== undefined) $('#mrows').insertAdjacentHTML('beforeend', $('#metapanel')._row({k: '', v: ''}));
    if (d.mdel !== undefined) e.target.closest('.mrow').remove();
    if (d.msave !== undefined) saveMeta();
  });
  $('#relpanel').addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    const d = a.dataset;
    if (d.entry) return open(+d.entry);
    if (d.rent) return showEntity(+d.rent);
    if (d.rlot) return showLot(+d.rlot);
    if (d.rcult) return showCulture(+d.rcult);
    if (d.rdev) return showDevice(+d.rdev);
    if (d.rref) return showLiterature(+d.rref);
  });
  $('#sidepane').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.sideclose !== undefined) closeSide();
    if (d.sideopen) { const id = +d.sideopen; closeSide(); open(id); }
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); open(+a.dataset.entry); }
  });
}
