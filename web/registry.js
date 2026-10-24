// Registry-Oberfläche: Typen in der Seitenleiste, Tabelle der Objekte, Detail mit Feldern, Verlauf und „Verwendet in“, Typ-Editor.
'use strict';

let regTypes = [], regType = null, regEntity = null;  // regType: gewählter Typ (ID), regEntity: geöffnetes Objekt (ID) oder 'new'
const FIELD_TYPES = {text: 'Text', longtext: 'Langer Text', number: 'Zahl', date: 'Datum', select: 'Auswahl', sequence: 'Sequenz (DNA/RNA)', bool: 'Ja/Nein', url: 'Link'};
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/// Sequenz-Kennzahlen: Länge, GC-Anteil, Tm (Wallace bis 13 nt, sonst Basis-Formel)
function seqStats(seq) {
  const s = (seq || '').toUpperCase().replace(/[^ACGTUNRYSWKMBDHV]/g, '');
  if (!s) return '';
  const gc = (s.match(/[GCS]/g) || []).length, at = (s.match(/[ATUW]/g) || []).length, n = s.length;
  let tm = n < 14 ? 2 * at + 4 * gc : 64.9 + 41 * (gc - 16.4) / n;
  if (n <= 60 && /^[ACGTU]+$/.test(s)) try { tm = Bio.tm(s); } catch {}  // Nearest-Neighbor wie Primer3
  return `${n} nt · GC ${Math.round(gc / n * 100)} %${n <= 60 ? ` · Tm ≈ ${tm.toFixed(1).replace('.', ',')} °C` : ''}`;  // Tm nur für Primer-Längen sinnvoll
}

async function loadTypes() {
  regTypes = await call('types');
  $('#types').innerHTML = regTypes.filter(t => !t.archived || t.id == regType).map(t => `<li data-type="${t.id}" class="${t.id == regType && !$('#reg').hidden ? 'cur' : ''} ${t.archived ? 'arch' : ''}">
    <span class="n">${esc(t.icon)} ${esc(t.name)}</span><span class="c">${t.count}</span>${t.archived ? '' : `<button class="tabx" data-archivetype="${t.id}" title="Typ ausblenden (archivieren) – über ⋯ wieder holen">✕</button>`}</li>`).join('');
}

function showView(v) {
  if (v != 'doc' && v != 'reg') reportTarget(`view:${v}`);
  $('#reg').hidden = v != 'reg';
  $('#stock').hidden = v != 'stock';
  $('#analysis').hidden = v != 'analysis';
  $('#cult').hidden = v != 'cult';
  $('#dev').hidden = v != 'dev';
  $('#orders').hidden = v != 'orders';
  $('#lit').hidden = v != 'lit';
  $('#agenda').hidden = v != 'agenda';
  $('#calendar').hidden = v != 'calendar';
  $('#ask').hidden = v != 'ask';
  if (!['stock', 'analysis', 'cult', 'dev', 'orders', 'lit', 'agenda', 'calendar', 'ask'].includes(v)) document.querySelectorAll('#stockNav li').forEach(li => li.classList.remove('cur'));
  $('#doc').hidden = v != 'doc' || !cur;
  $('#empty').hidden = v != 'doc' || !!cur;
  $('#status').hidden = v != 'doc';
  if (v != 'reg') { const had = regType != null || regEntity != null; regType = null; regEntity = null; if (v == 'doc' || had) loadTypes(); }  // Markierung in der Registry aufheben
}

async function showType(id) {
  await flush();
  regType = id; regEntity = null;
  showView('reg'); reportTarget(`type:${id}`);
  await loadTypes();
  await renderTypeTable();
}

async function renderTypeTable(q = $('#regq')?.value || '') {
  const t = regTypes.find(x => x.id == regType);
  if (!t) return;
  const fields = parseJSON(t.fields_json, []).slice(0, 4);
  const rows = await call('entities', {type: t.id, q});
  $('#reg').innerHTML = `<div class="reghead"><h2>${esc(t.icon)} ${esc(t.name)} <span class="sub">${esc(t.prefix)}-…</span></h2>
      <input id="regq" type="search" placeholder="In ${esc(t.name)} suchen" value="${esc(q)}" autocomplete="off">
      <button class="btn" data-regedittype>Typ bearbeiten</button><button class="btn on" data-regnew>+ Neu</button></div>
    ${rows.length ? `<table class="regtable"><tr><th>ID</th><th>Name</th>${fields.map(f => `<th>${esc(f.label)}</th>`).join('')}<th>Verwendet</th><th>Geändert</th></tr>
      ${rows.map(r => { const v = parseJSON(r.fields_json, {});
        return `<tr data-ent="${r.id}"><td><code>${r.code}</code></td><td><b>${esc(r.name)}</b></td>${fields.map(f => `<td>${esc(f.type == 'sequence' ? (v[f.key] || '').slice(0, 24) + ((v[f.key] || '').length > 24 ? '…' : '') : v[f.key] || '')}</td>`).join('')}
        <td>${r.uses || ''}</td><td>${when(r.updated)}</td></tr>`; }).join('')}</table>`
      : `<div class="empty">${q ? 'Nichts gefunden.' : `Noch keine ${esc(t.name)}-Einträge. Mit <b>+ Neu</b> anlegen.`}</div>`}`;
  const inp = $('#regq');
  inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => renderTypeTable(inp.value).then(() => { const i = $('#regq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 150); };
}

/// Detail eines Objekts (oder Formular für ein neues)
async function showEntity(id) {
  await flush();
  const e = id == 'new' ? null : await call('entity', {id});
  for (const k in SEQ_PENDING) delete SEQ_PENDING[k];  // nicht gespeicherter Import gehört zum vorigen Formular
  if (e) regType = e.type_id;
  regEntity = id;
  showView('reg');
  await loadTypes();
  const t = regTypes.find(x => x.id == regType);
  const fields = parseJSON(e ? e.type_fields : t.fields_json, []), v = e ? parseJSON(e.fields_json, {}) : {};
  const input = f => {
    const val = v[f.key] ?? '', k = `data-field="${f.key}"`;
    if (f.type == 'longtext') return `<textarea ${k} rows="3">${esc(val)}</textarea>`;
    if (f.type == 'sequence') return `<textarea ${k} rows="3" class="seq" spellcheck="false">${esc(val)}</textarea><div class="sub seqstat">${seqStats(val)}</div>
      <button type="button" class="btn" data-seqimport="${f.key}">📥 GenBank/FASTA importieren</button>`;
    if (f.type == 'select') return `<select ${k}><option value="">—</option>${(f.options || []).map(o => `<option ${o == val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (f.type == 'bool') return `<input type="checkbox" ${k} ${val == 'ja' ? 'checked' : ''}>`;
    if (f.type == 'date') return `<input type="date" ${k} value="${esc(val)}">`;
    if (f.type == 'url') return `<input ${k} value="${esc(val)}" placeholder="https://…">${val ? ` <a href="${esc(val)}" class="sub">öffnen</a>` : ''}`;
    return `<input ${k} value="${esc(val)}" ${f.type == 'number' ? 'inputmode="decimal"' : ''} autocomplete="off">`;
  };
  const hist = e?.history || [];
  const diff = (a, b) => { const x = parseJSON(a.fields_json, {}), y = b ? parseJSON(b.fields_json, {}) : {};
    const ch = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => x[k] != y[k]).map(k => fields.find(f => f.key == k)?.label || k);
    if (b && a.name != b.name) ch.unshift('Name');
    return b ? (ch.length ? 'geändert: ' + ch.join(', ') : '') : 'angelegt'; };
  $('#reg').innerHTML = `<div class="reghead"><button class="btn" data-regback>← ${esc(t.name)}</button>
      <h2>${esc(t.icon)} ${e ? `<code>${e.code}</code> ${esc(e.name)}` : `Neu: ${esc(t.name)}`}</h2>
      ${e ? `<button class="btn" data-label="entity:${e.id}">🏷 Etikett</button><button class="btn" data-regcopy="${e.code}" title="ID kopieren">ID kopieren</button><button class="btn" data-regarchive>${e.archived ? 'Wiederherstellen' : 'Archivieren'}</button>` : ''}</div>
    <div class="regdetail"><form id="entform" class="regform">
      <label class="rf"><span>Name</span><input data-name value="${esc(e?.name || '')}" required autocomplete="off"></label>
      ${fields.map(f => `<label class="rf"><span>${esc(f.label)}</span><div>${input(f)}</div></label>`).join('')}
      <div class="rfbtns"><span id="entmsg" class="sub"></span><button class="btn on" type="submit">${e ? 'Speichern' : 'Anlegen'}</button></div></form>
      ${e ? `<aside class="regside"><h4>Verwendet in</h4>${e.used_in.length ? e.used_in.map(u => `<a href="#" class="elink" data-entry="${u.id}">↗ ${esc(u.title || 'Ohne Titel')}</a>`).join('<br>') : '<span class="sub">noch in keinem Eintrag (mit @ verweisen)</span>'}
        <h4>Bestand</h4><div id="entLots" data-entity="${e.id}"><span class="sub">…</span></div>
        <div id="entCults"></div>
        <h4>Verlauf</h4><ol class="reghist">${hist.map((h, i) => `<li>${when(h.changed)}${h.author ? ` · ${esc(h.author)}` : ''}<br><span class="sub">${esc(diff(h, hist[i + 1]))}</span></li>`).join('')}</ol></aside>` : ''}
    </div>`;
  if (!e) $('#entform [data-name]').focus();
  else {
    renderEntityLots(e.id); renderEntityCultures(e.id);
    if (v.smiles) {  // Chemikalie: Struktur, Summenformel, Molmasse
      let f = null; try { f = Chem.formula(v.smiles); } catch (err) { f = {error: err.message}; }
      $('#reg').insertAdjacentHTML('beforeend', `<div class="seqpanel chempanel"><div class="seqbar"><b>⚗️ Struktur</b>${f.error ? `<span class="bad">${esc(f.error)}</span>`
        : `<span>${Chem.hillHTML(f.hill)} · <b>${Chem.mw(f.mass)}</b> g/mol</span>${fields.some(x => x.key == 'mw') && Calc.num(v.mw) != +Chem.mw(f.mass).replace(',', '.') ? `<button class="btn" data-chemmw="${Chem.mw(f.mass)}">Molmasse ins Feld übernehmen</button>` : ''}`}</div><div class="chempic"></div></div>`);
      drawStructure(v.smiles, {width: 320, height: 220}).then(svg => { const p = document.querySelector('#reg .chempanel .chempic'); if (p) p.innerHTML = svg || ''; });
    }
    const sf = fields.filter(f => f.type == 'sequence' && v[f.key]);
    $('#reg').insertAdjacentHTML('beforeend', sf.map(f => `<div class="seqpanel" data-seqent="${e.id}" data-seqfield="${f.key}"></div>`).join(''));
    await Promise.all([...document.querySelectorAll('#reg .seqpanel[data-seqent]')].map(renderSeqPanel));
  }
}

async function saveEntityForm() {
  const form = $('#entform'), values = {};
  form.querySelectorAll('[data-field]').forEach(el => { values[el.dataset.field] = el.type == 'checkbox' ? (el.checked ? 'ja' : '') : el.value; });
  const name = form.querySelector('[data-name]').value;
  try {
    const e = regEntity == 'new' ? await call('createEntity', {type: regType, name, values}) : await call('updateEntity', {id: regEntity, name, values});
    await savePendingSeq(e.id);
    await showEntity(e.id);
    $('#entmsg').textContent = 'Gespeichert';
    return e;
  } catch (err) { $('#entmsg').textContent = err.message; $('#entmsg').classList.add('bad'); }
}

// ---------- Typ-Editor ----------
function typeDialog(t) {
  const fields = t ? parseJSON(t.fields_json, []) : [{label: 'Notiz', type: 'longtext'}];  // ohne Schlüssel: entsteht aus dem Namen
  const dlg = $('#typedlg');
  const row = f => `<div class="tfield"><input data-tl value="${esc(f.label)}" placeholder="Feldname"><select data-tt>${Object.entries(FIELD_TYPES).map(([k, l]) => `<option value="${k}" ${k == f.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-to value="${esc((f.options || []).join(', '))}" placeholder="Optionen, durch Komma" ${f.type == 'select' ? '' : 'hidden'}><input type="hidden" data-tk value="${esc(f.key || '')}">
    <button type="button" class="x" data-tup title="nach oben">↑</button><button type="button" class="x" data-tdel title="entfernen">×</button></div>`;
  dlg.innerHTML = `<form method="dialog"><h3>${t ? 'Typ bearbeiten' : 'Neuer Typ'}</h3>
    <div class="row"><label>Name <input id="tName" value="${esc(t?.name || '')}" placeholder="z. B. Gewebeprobe"></label>
      <label>Kürzel <input id="tPrefix" value="${esc(t?.prefix || '')}" maxlength="4" style="width:60px" placeholder="GP"></label>
      <label>Symbol <input id="tIcon" value="${esc(t?.icon || '📦')}" style="width:44px"></label></div>
    <p class="sub">IDs sehen so aus: <code id="tPreview">${esc(t?.prefix || 'XX')}-0001</code>. Das Kürzel lässt sich ändern, solange es keine Objekte gibt.</p>
    <div id="tFields">${fields.map(row).join('')}</div><button type="button" class="btn" id="tAdd">+ Feld</button>
    <p id="tMsg" class="bad"></p>
    <div class="dlgbtns">${t ? `<button type="button" class="btn" id="tArchive">${t.archived ? 'Wiederherstellen' : 'Archivieren'}</button>` : ''}<span class="grow"></span>
      <button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="tSave">Sichern</button></div></form>`;
  dlg.showModal();
  $('#tPrefix').oninput = e => { $('#tPreview').textContent = (e.target.value.toUpperCase() || 'XX') + '-0001'; };
  $('#tAdd').onclick = () => { $('#tFields').insertAdjacentHTML('beforeend', row({label: '', type: 'text'})); $('#tFields .tfield:last-child [data-tl]').focus(); };
  $('#tFields').onchange = e => { if (e.target.dataset.tt !== undefined) e.target.parentElement.querySelector('[data-to]').hidden = e.target.value != 'select'; };
  $('#tFields').onclick = e => {
    const r = e.target.closest('.tfield');
    if (e.target.dataset.tdel !== undefined) r.remove();
    if (e.target.dataset.tup !== undefined && r.previousElementSibling) r.parentElement.insertBefore(r, r.previousElementSibling);
  };
  if (t) $('#tArchive').onclick = async () => { await call('archiveType', {id: t.id, archived: !t.archived}); dlg.close(); await loadTypes(); };
  $('#tSave').onclick = async () => {
    const used = new Set();
    const keyOf = (label, old) => { if (old) { used.add(old); return old; }
      let k = slug(label).replace(/-/g, '_').replace(/^[^a-z]+/, '') || 'feld'; k = k.slice(0, 28); let i = 2, base = k; while (used.has(k)) k = `${base}_${i++}`; used.add(k); return k; };
    const fs = [...$('#tFields').children].map(r => ({label: r.querySelector('[data-tl]').value.trim(), type: r.querySelector('[data-tt]').value,
      options: r.querySelector('[data-to]').value.split(',').map(x => x.trim()).filter(Boolean), old: r.querySelector('[data-tk]').value})).filter(f => f.label);
    fs.filter(f => f.old).forEach(f => used.add(f.old));
    const fields = fs.map(f => ({key: f.old || keyOf(f.label), label: f.label, type: f.type, ...(f.type == 'select' ? {options: f.options} : {})}));
    try {
      const id = await call('saveType', {...(t ? {id: t.id} : {}), name: $('#tName').value, prefix: $('#tPrefix').value, icon: $('#tIcon').value, fields});
      dlg.close();
      await showType(id);
    } catch (err) { $('#tMsg').textContent = err.message; }
  };
}

// ---------- Ereignisse (beim Start gebunden; app.js definiert $ erst danach) ----------
function initRegistry() {
  $('#types').addEventListener('click', async e => {
    if (e.target.dataset.archivetype) { e.stopPropagation(); await call('archiveType', {id: +e.target.dataset.archivetype, archived: true}); status('Typ ausgeblendet – über ⋯ an der Registry wieder holen'); return loadTypes(); }
    const li = e.target.closest('li[data-type]'); if (li) openFromSidebar(`type:${li.dataset.type}`, () => showType(+li.dataset.type));
  });
  $('#newType').onclick = () => typeDialog(null);
  $('#regTabs').onclick = e => tabsMenu(e.currentTarget);
  $('#reg').addEventListener('click', async e => {
    const d = e.target.dataset, tr = e.target.closest('tr[data-ent]');
    if (tr) return showEntity(+tr.dataset.ent);
    if (d.regnew !== undefined) return showEntity('new');
    if (d.regback !== undefined) return showType(regType);
    if (d.regedittype !== undefined) return typeDialog(regTypes.find(t => t.id == regType));
    if (d.regcopy) { navigator.clipboard?.writeText(d.regcopy); e.target.textContent = 'Kopiert'; return; }
    if (d.regarchive !== undefined) { const ent = await call('entity', {id: regEntity}); await call('archiveEntity', {id: regEntity, archived: !ent.archived}); return showType(regType); }
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; return open(+a.dataset.entry); }
  });
  $('#reg').addEventListener('submit', e => { e.preventDefault(); saveEntityForm(); });
  $('#reg').addEventListener('click', e => {
    const b = e.target.closest('[data-chemmw]'); if (!b) return;
    const mw = document.querySelector('#entform [data-field="mw"]'); mw.value = b.dataset.chemmw; saveEntityForm();
  });
  $('#reg').addEventListener('input', e => { if (e.target.classList.contains('seq')) e.target.parentElement.querySelector('.seqstat').textContent = seqStats(e.target.value); });
}
