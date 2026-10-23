// Bestand: Chargen, Standorte mit Boxen-Raster, Bewegungen, Warnungen; Verbrauch-Block im Eintrag.
'use strict';

let stockTab = 'lots', stockFilter = 'all', stockLot = null, stockLoc = null;  // stockLot: offene Charge (ID) oder 'new'; stockLoc: gewählte Box
let stockLocs = [];
const GHS = {GHS01: 'Explosiv', GHS02: 'Entzündbar', GHS03: 'Brandfördernd', GHS04: 'Gas unter Druck', GHS05: 'Ätzend',
  GHS06: 'Giftig', GHS07: 'Reizend', GHS08: 'Gesundheitsgefahr', GHS09: 'Umweltgefahr'};
const WARN = {expired: ['abgelaufen', 'bad'], soon: ['läuft bald ab', 'warn'], low: ['knapp', 'warn'], empty: ['leer', 'mut']};
const LOT_UNITS = ['µl', 'ml', 'l', 'ng', 'µg', 'mg', 'g', 'kg', 'U', 'Stück', 'Packung', 'Röhrchen', 'Aliquots'];
const LOC_KINDS = {raum: 'Raum', geraet: 'Gerät (Kühlschrank, Gefrierschrank)', regal: 'Regal / Fach', box: 'Box mit Raster', ort: 'Sonstiger Ort'};
const amt = l => `${Calc.fmt(+l.amount)} ${l.unit}`;
const badges = w => (w || []).map(k => `<span class="wbadge ${WARN[k][1]}">${WARN[k][0]}</span>`).join(' ');
const ghsBadges = g => (g ? g.split(',') : []).map(c => `<span class="ghs" title="${esc(GHS[c] || c)}">◆ ${esc(c.slice(3))} ${esc(GHS[c] || '')}</span>`).join(' ');

async function refreshStockBadge() {
  const n = await call('stockWarnings');
  const b = $('#stockBadge');
  b.hidden = !n; b.textContent = n; b.title = `${n} Charge(n) abgelaufen, bald ablaufend oder knapp`;
  return n;
}

async function showStock(tab = stockTab) {
  await flush();
  stockTab = tab; stockLot = null;
  showView('stock');
  document.querySelectorAll('#stockNav li').forEach(li => li.classList.toggle('cur', li.dataset.stock == 'lots'));
  stockLocs = await call('locations');
  if (tab == 'locations') return renderLocations();
  return renderLots();
}

const stockTabs = () => `<div class="stabs"><button class="btn ${stockTab == 'lots' ? 'on' : ''}" data-stab="lots">Chargen</button>
  <button class="btn ${stockTab == 'locations' ? 'on' : ''}" data-stab="locations">Standorte</button></div>`;

async function renderLots(q = $('#lotq')?.value || '') {
  const rows = await call('lots', {filter: stockFilter, q});
  $('#stock').innerHTML = `<div class="reghead"><h2>📦 Bestand</h2>${stockTabs()}
      <input id="lotq" type="search" placeholder="Chargen suchen" value="${esc(q)}" autocomplete="off">
      <button class="btn ${stockFilter == 'warnings' ? 'on' : ''}" data-sfilter="${stockFilter == 'warnings' ? 'all' : 'warnings'}">⚠ Nur Warnungen</button>
      <button class="btn on" data-lotnew>+ Charge</button></div>
    ${rows.length ? `<table class="regtable"><tr><th>Nr.</th><th>Bezeichnung</th><th>Objekt</th><th>Menge</th><th>Standort</th><th>Ablauf</th><th></th></tr>
      ${rows.map(l => `<tr data-lot="${l.id}"><td><code>${l.code}</code></td><td><b>${esc(l.name)}</b>${l.lot_no ? ` <span class="sub">Ch. ${esc(l.lot_no)}</span>` : ''}</td>
        <td>${l.entity_code ? `<code>${esc(l.entity_code)}</code> ${esc(l.entity_name)}` : ''}</td><td class="num">${esc(amt(l))}</td>
        <td>${esc(l.location_path || '')}${l.position ? ` · <b>${esc(l.position)}</b>` : ''}</td><td>${esc(l.expiry || '')}</td><td>${badges(l.warnings)}</td></tr>`).join('')}</table>`
      : `<div class="empty">${q || stockFilter == 'warnings' ? 'Nichts gefunden.' : 'Noch keine Chargen. Mit <b>+ Charge</b> anlegen.'}</div>`}`;
  const inp = $('#lotq');
  inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => renderLots(inp.value).then(() => { const i = $('#lotq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 150); };
  refreshStockBadge();
}

/// Charge: Formular (neu oder Stammdaten) mit Bewegungen
async function showLot(id, preset = {}) {
  await flush();
  stockLot = id;
  showView('stock');
  stockLocs = await call('locations');
  const l = id == 'new' ? null : await call('lot', {id});
  const v = l || preset;
  const ents = await call('entities', {});
  const entLabel = e => `${e.code} ${e.name}`;
  const curEnt = ents.find(e => e.id == (v.entity_id ?? v.entity));
  const units = LOT_UNITS.includes(v.unit) || !v.unit ? LOT_UNITS : [v.unit, ...LOT_UNITS];
  const ghs = (v.ghs || '').split(',');
  $('#stock').innerHTML = `<div class="reghead"><button class="btn" data-stab="lots">← Bestand</button>
      <h2>📦 ${l ? `<code>${l.code}</code> ${esc(l.name)}` : 'Neue Charge'}</h2>
      ${l ? `<span class="amtbig">${esc(amt(l))}</span> ${badges(l.warnings)}<button class="btn" data-label="lot:${l.id}">🏷 Etikett</button><button class="btn" data-orderlot="${l.id}">🛒 Nachbestellen</button>` : ''}</div>
    <div class="regdetail"><form id="lotform" class="regform">
      <label class="rf"><span>Bezeichnung</span><input name="name" value="${esc(v.name || '')}" required autocomplete="off"></label>
      <label class="rf"><span>Registry-Objekt</span><div><input name="entity" list="entlist" value="${esc(curEnt ? entLabel(curEnt) : '')}" placeholder="optional, z. B. CH-0003" autocomplete="off">
        <datalist id="entlist">${ents.map(e => `<option value="${esc(entLabel(e))}">`).join('')}</datalist></div></label>
      <label class="rf"><span>Chargennummer</span><input name="lot_no" value="${esc(v.lot_no || '')}" autocomplete="off"></label>
      ${l ? '' : `<label class="rf"><span>Anfangsmenge</span><input name="amount" value="${esc(v.amount ?? '')}" inputmode="decimal" required></label>`}
      <label class="rf"><span>Einheit</span><select name="unit">${units.map(u => `<option ${u == v.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
      <label class="rf"><span>Mindestbestand</span><input name="min" value="${esc(v.min_amount ?? v.min ?? '')}" inputmode="decimal" placeholder="Warnung, wenn weniger"></label>
      <label class="rf"><span>Ablaufdatum</span><input name="expiry" type="date" value="${esc(v.expiry || '')}"></label>
      <label class="rf"><span>Standort</span><select name="location"><option value="">—</option>${stockLocs.map(x => `<option value="${x.id}" ${x.id == (v.location_id ?? v.location) ? 'selected' : ''}>${esc(x.path)}</option>`).join('')}</select></label>
      <label class="rf"><span>Position in der Box</span><input name="position" value="${esc(v.position || '')}" placeholder="z. B. A3" maxlength="3" autocomplete="off"></label>
      <div class="rf"><span>Gefahren (GHS)</span><div class="ghsgrid">${Object.entries(GHS).map(([c, t]) => `<label><input type="checkbox" name="ghs" value="${c}" ${ghs.includes(c) ? 'checked' : ''}> ◆ ${c.slice(3)} ${t}</label>`).join('')}</div></div>
      <label class="rf"><span>Sicherheitsdatenblatt</span><div><input name="sds" value="${esc(v.sds_url || '')}" placeholder="https://…">${v.sds_url ? ` <a href="${esc(v.sds_url)}" class="sub">öffnen</a>` : ''}</div></label>
      <label class="rf"><span>Hersteller</span><input name="supplier" value="${esc(v.supplier || '')}"></label>
      <label class="rf"><span>Katalognr.</span><input name="catalog" value="${esc(v.catalog || '')}"></label>
      <label class="rf"><span>Notiz</span><textarea name="note" rows="2">${esc(v.note || '')}</textarea></label>
      <div class="rfbtns"><span id="lotmsg" class="sub"></span><button class="btn on" type="submit">${l ? 'Speichern' : 'Anlegen'}</button></div></form>
      ${l ? `<aside class="regside">
        ${l.status != 'disposed' ? `<h4>Buchen</h4><div class="lotbtns"><button class="btn" data-lotmove="verbrauch">− Verbrauch</button><button class="btn" data-lotmove="zugang">+ Zugang</button>
          <button class="btn" data-lotmove="korrektur">± Korrektur</button><button class="btn danger" data-lotmove="entsorgen">Entsorgen</button></div>` : '<p class="sub">Entsorgt.</p>'}
        ${l.ghs ? `<h4>Gefahren</h4>${ghsBadges(l.ghs)}` : ''}
        <h4>Bewegungen</h4><ol class="reghist">${l.moves.map(m => `<li>${when(m.at)} · <b>${m.delta > 0 ? '+' : ''}${Calc.fmt(m.delta)} ${esc(l.unit)}</b> (${esc(m.kind)}) → ${Calc.fmt(m.amount_after)}
          ${m.entry_id ? `<br><a href="#" class="elink" data-entry="${m.entry_id}">↗ ${esc(m.entry_title || 'Eintrag')}</a>` : ''}${m.note ? `<br><span class="sub">${esc(m.note)}</span>` : ''}</li>`).join('')}</ol></aside>` : ''}
    </div>`;
  if (!l) $('#lotform [name=name]').focus();
}

async function saveLotForm() {
  const f = $('#lotform'), g = n => f.querySelector(`[name=${n}]`)?.value ?? '';
  const ents = await call('entities', {});
  const entText = g('entity').trim();
  const ent = entText ? ents.find(e => `${e.code} ${e.name}` == entText || e.code == entText.split(' ')[0].toUpperCase()) : null;
  if (entText && !ent) { $('#lotmsg').textContent = 'Registry-Objekt nicht gefunden'; return; }
  const values = {name: g('name'), lot_no: g('lot_no'), unit: g('unit'), min: g('min'), expiry: g('expiry'), position: g('position'),
    sds: g('sds'), supplier: g('supplier'), catalog: g('catalog'), note: g('note'), ghs: [...f.querySelectorAll('[name=ghs]:checked')].map(c => c.value),
    ...(ent ? {entity: ent.id} : {}), ...(g('location') ? {location: +g('location')} : {}), ...(stockLot == 'new' ? {amount: g('amount')} : {})};
  try {
    const l = await call('saveLot', {...(stockLot == 'new' ? {} : {id: stockLot}), values});
    await showLot(l.id);
    $('#lotmsg').textContent = 'Gespeichert';
    refreshStockBadge();
    return l;
  } catch (e) { $('#lotmsg').textContent = e.message; $('#lotmsg').classList.add('bad'); }
}

async function bookLot(kind) {
  const l = await call('lot', {id: stockLot});
  let delta = 0;
  if (kind == 'entsorgen') { if (!confirm(`${l.code} ${l.name} entsorgen? Restmenge ${amt(l)} wird ausgebucht.`)) return; }
  else {
    const v = Calc.num(prompt(kind == 'verbrauch' ? `Verbrauch in ${l.unit}` : kind == 'zugang' ? `Zugang in ${l.unit}` : `Korrektur in ${l.unit} (z. B. −5 oder 5)`));
    if (v == null || Number.isNaN(v) || v == 0) return;
    delta = kind == 'verbrauch' ? -Math.abs(v) : kind == 'zugang' ? Math.abs(v) : v;
  }
  const note = kind == 'korrektur' ? (prompt('Grund der Korrektur') || '') : '';
  try { await call('moveLot', {id: l.id, delta, kind, note}); } catch (e) { return alert(e.message); }
  await showLot(l.id);
  refreshStockBadge();
}

// ---------- Standorte ----------
function locTree(parent = null, depth = 0) {
  return stockLocs.filter(l => (l.parent_id ?? null) == parent).map(l => `<li style="--d:${depth}" data-loc="${l.id}" class="${l.id == stockLoc ? 'cur' : ''}">
    <span class="n">${l.kind == 'box' ? '🗃' : l.kind == 'geraet' ? '🧊' : l.kind == 'raum' ? '🚪' : '📍'} ${esc(l.name)}${l.temp ? ` <span class="sub">${esc(l.temp)}</span>` : ''}</span>
    <span class="c">${l.lots || ''}</span><button class="x" data-locedit="${l.id}" title="Bearbeiten">✎</button></li>${locTree(l.id, depth + 1)}`).join('');
}

async function renderLocations() {
  stockLocs = await call('locations');
  const box = stockLocs.find(l => l.id == stockLoc);
  let grid = '';
  if (box?.kind == 'box') {
    const lots = await call('lots', {filter: `location:${box.id}`});
    const at = Object.fromEntries(lots.filter(l => l.position).map(l => [l.position, l]));
    const rows = [...Array(box.rows)].map((_, r) => String.fromCharCode(65 + r));
    grid = `<h3>${esc(box.path)} <button class="btn" data-labelbox="${box.id}">🏷 Etiketten (Box und Inhalt)</button></h3><table class="boxgrid"><tr><th></th>${[...Array(box.cols)].map((_, c) => `<th>${c + 1}</th>`).join('')}</tr>
      ${rows.map(r => `<tr><th>${r}</th>${[...Array(box.cols)].map((_, c) => { const p = `${r}${c + 1}`, l = at[p];
        return l ? `<td class="full ${l.warnings.length ? 'w' : ''}" data-lot="${l.id}" title="${esc(`${l.code} ${l.name} · ${amt(l)}`)}">${esc(l.name.slice(0, 10))}</td>`
          : `<td class="free" data-newat="${p}" title="${p}: frei – hier einlagern"></td>`; }).join('')}</tr>`).join('')}</table>
      <p class="sub">Belegt: ${lots.filter(l => l.position).length} von ${box.rows * box.cols}. Klick auf ein freies Feld legt dort eine Charge an.</p>`;
  } else if (box) {
    const lots = await call('lots', {filter: `location:${box.id}`});
    grid = `<h3>${esc(box.path)} <button class="btn" data-label="location:${box.id}">🏷 Etikett</button></h3>${lots.length ? lots.map(l => `<div class="locrow" data-lot="${l.id}"><code>${l.code}</code> ${esc(l.name)} · ${esc(amt(l))} ${badges(l.warnings)}</div>`).join('') : '<p class="sub">Hier liegt nichts.</p>'}`;
  }
  $('#stock').innerHTML = `<div class="reghead"><h2>📦 Bestand</h2>${stockTabs()}<button class="btn on" data-locnew>+ Standort</button></div>
    <div class="locwrap"><ul class="loctree">${locTree() || '<li class="sub">Noch keine Standorte. Zum Beispiel: Raum › Gefrierschrank › Box.</li>'}</ul>
    <div class="locview">${grid || '<p class="sub">Standort wählen, um Inhalt oder Raster zu sehen.</p>'}</div></div>`;
}

function locDialog(loc) {
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>${loc ? 'Standort bearbeiten' : 'Neuer Standort'}</h3>
    <label class="rf"><span>Name</span><input id="lName" value="${esc(loc?.name || '')}" placeholder="z. B. Gefrierschrank −80"></label>
    <label class="rf"><span>Art</span><select id="lKind">${Object.entries(LOC_KINDS).map(([k, t]) => `<option value="${k}" ${k == (loc?.kind || 'geraet') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="rf"><span>Liegt in</span><select id="lParent"><option value="">— oberste Ebene —</option>${stockLocs.filter(x => x.id != loc?.id).map(x => `<option value="${x.id}" ${x.id == (loc?.parent_id ?? stockLoc) ? 'selected' : ''}>${esc(x.path)}</option>`).join('')}</select></label>
    <label class="rf lgrid"><span>Raster</span><div><input id="lRows" type="number" min="1" max="26" value="${loc?.rows || 9}" style="width:60px"> Reihen ×
      <input id="lCols" type="number" min="1" max="48" value="${loc?.cols || 9}" style="width:60px"> Spalten</div></label>
    <label class="rf"><span>Temperatur</span><input id="lTemp" value="${esc(loc?.temp || '')}" placeholder="z. B. −80 °C"></label>
    <p id="lMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="lSave">Sichern</button></div></form>`;
  const grid = () => { dlg.querySelector('.lgrid').hidden = $('#lKind').value != 'box'; };
  $('#lKind').onchange = grid; grid();
  dlg.showModal();
  $('#lSave').onclick = async () => {
    const kind = $('#lKind').value;
    try {
      const id = await call('saveLocation', {...(loc ? {id: loc.id} : {}), name: $('#lName').value, kind, temp: $('#lTemp').value,
        ...($('#lParent').value ? {parent: +$('#lParent').value} : {}), ...(kind == 'box' ? {rows: +$('#lRows').value, cols: +$('#lCols').value} : {})});
      dlg.close();
      stockLoc = id;
      await renderLocations();
    } catch (e) { $('#lMsg').textContent = e.message; }
  };
}

/// Im Registry-Objekt: seine Chargen
async function renderEntityLots(entityId) {
  const box = document.querySelector('#entLots'); if (!box) return;
  const lots = await call('lots', {filter: `entity:${entityId}`});
  box.innerHTML = (lots.length ? lots.map(l => `<div class="locrow" data-lot="${l.id}"><code>${l.code}</code> ${esc(amt(l))}${l.location_path ? ` · ${esc(l.location_path)}${l.position ? ' ' + esc(l.position) : ''}` : ''} ${badges(l.warnings)}</div>`).join('')
    : '<span class="sub">keine Chargen</span>') + `<button class="btn" data-lotfor="${entityId}" style="margin-top:6px">+ Charge</button>`;
}

// ---------- Verbrauch-Block im Eintrag ----------
/// Verbrauch einer Charge: erst ausfüllen, dann „Verbuchen“ (Bestand sinkt, Bewegung verweist auf den Eintrag); stornierbar
const UsageNode = TT.Node.create({
  name: 'usage', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({
    lot: {default: null}, amount: {default: ''}, unit: {default: ''}, label: {default: ''},
    move: {default: null}, at: {default: null}, rest: {default: null}, canceled: {default: null},
  }),
  parseHTML: () => [{tag: 'div[data-usage]', getAttrs: el => JSON.parse(el.getAttribute('data-usage') || '{}')}],
  renderHTML: ({node}) => ['div', {'data-usage': JSON.stringify(node.attrs)}, usageText(node.attrs)],
  renderText: ({node}) => usageText(node.attrs),
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node;
    const dom = document.createElement('div');
    dom.className = 'usage'; dom.contentEditable = 'false';
    const set = attrs => { const pos = getPos(); if (typeof pos == 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, ...attrs})); };
    async function render() {
      const a = cur.attrs, ro = !editor.isEditable;
      if (a.move) {
        dom.innerHTML = `<span class="ui">📦</span><span class="grow">${esc(usageText(a))}</span>${!ro && !a.canceled ? '<button class="btn" data-ustorno>Stornieren</button>' : ''}`;
        return;
      }
      if (ro) { dom.innerHTML = `<span class="ui">📦</span><span class="grow">${esc(usageText(a))}</span>`; return; }
      const lots = (await call('lots', {})).filter(l => l.status == 'active');
      const lot = lots.find(l => l.id == a.lot);
      const dim = lot && Calc.dimOf(lot.unit);
      const units = lot ? (dim ? Object.keys(Calc.UNITS[dim]) : [lot.unit]) : [];
      dom.innerHTML = `<span class="ui">📦 Verbrauch</span>
        <select data-ulot><option value="">Charge wählen …</option>${lots.map(l => `<option value="${l.id}" ${l.id == a.lot ? 'selected' : ''}>${esc(`${l.code} ${l.name}${l.lot_no ? ' · Ch. ' + l.lot_no : ''} – ${amt(l)}`)}</option>`).join('')}</select>
        <input data-uamt value="${esc(a.amount)}" placeholder="Menge" inputmode="decimal" style="width:80px">
        <select data-uunit>${units.map(u => `<option ${u == (a.unit || lot?.unit) ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <button class="btn on" data-ubook ${lot ? '' : 'disabled'}>Verbuchen</button><span class="umsg bad"></span>`;
    }
    dom.addEventListener('change', e => {
      if (e.target.dataset.ulot !== undefined) set({lot: +e.target.value || null, unit: ''});
      else if (e.target.dataset.uunit !== undefined) set({unit: e.target.value});
    });
    dom.addEventListener('click', async e => {
      if (e.target.dataset.ubook !== undefined) {
        const amount = Calc.num(dom.querySelector('[data-uamt]').value), unit = dom.querySelector('[data-uunit]').value;
        const lot = await call('lot', {id: cur.attrs.lot});
        const msg = dom.querySelector('.umsg');
        if (!(amount > 0)) { msg.textContent = 'Menge fehlt'; return; }
        let inLotUnit = amount;
        try { if (unit != lot.unit) inLotUnit = Calc.convert(amount, unit, lot.unit); } catch (err) { msg.textContent = err.message; return; }
        try {
          await flush();
          const r = await call('moveLot', {id: lot.id, delta: -inLotUnit, kind: 'verbrauch', entry: cur_entry(), note: $('#title').value});
          set({amount: String(amount), unit, label: `${lot.code} ${lot.name}${lot.lot_no ? ' (Ch. ' + lot.lot_no + ')' : ''}`, move: r.move, at: r.at, rest: `${Calc.fmt(r.amount)} ${lot.unit}`});
          await flush();
          refreshStockBadge();
        } catch (err) { msg.textContent = err.message; }
      }
      if (e.target.dataset.ustorno !== undefined) {
        if (!confirm('Verbrauch stornieren? Die Menge wird zurückgebucht.')) return;
        const lot = await call('lot', {id: cur.attrs.lot});
        let back = Calc.num(cur.attrs.amount);
        if (cur.attrs.unit != lot.unit) back = Calc.convert(back, cur.attrs.unit, lot.unit);
        try { await call('moveLot', {id: lot.id, delta: back, kind: 'storno', entry: cur_entry(), note: 'Storno'}); } catch (err) { return alert(err.message); }
        set({canceled: new Date().toISOString()});
        refreshStockBadge();
      }
    });
    render();
    return {dom, update: n => { if (n.type.name != 'usage') return false; const changed = JSON.stringify(n.attrs) != JSON.stringify(cur.attrs); cur = n; if (changed) render(); return true; },
      stopEvent: e => !!e.target.closest?.('input, select, button'), ignoreMutation: () => true};
  },
});
const cur_entry = () => cur;

function usageText(a) {
  if (!a.move) return `Verbrauch (noch nicht gebucht)${a.amount ? `: ${a.amount} ${a.unit}` : ''}`;
  return `${a.canceled ? 'Storniert: ' : '✓ '}${a.amount} ${a.unit} von ${a.label} verbucht ${a.at ? when(a.at) : ''}${a.rest && !a.canceled ? ` · Rest ${a.rest}` : ''}`;
}

function insertUsage() { editor.chain().focus().insertContent([{type: 'usage'}, {type: 'paragraph'}]).run(); }

// ---------- Ereignisse ----------
function initStock() {
  $('#stockNav').addEventListener('click', e => {
    const k = e.target.closest('li')?.dataset.stock;
    if (k == 'analysis') showAnalysis(); else if (k == 'orders') showOrders(); else if (k == 'cult') showCultures('list'); else if (k == 'dev') showDevices(); else showStock('lots');
  });
  $('#stock').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.stab) return showStock(d.stab);
    if (d.sfilter) { stockFilter = d.sfilter; return renderLots(); }
    if (d.lotnew !== undefined) return showLot('new');
    if (d.lotmove) return bookLot(d.lotmove);
    if (d.orderlot) return orderDialog({lot: +d.orderlot});
    if (d.locnew !== undefined) return locDialog(null);
    if (d.locedit) { e.stopPropagation(); return locDialog(stockLocs.find(l => l.id == d.locedit)); }
    if (d.newat) return showLot('new', {location: stockLoc, position: d.newat, unit: 'µl'});
    const lot = e.target.closest('[data-lot]'); if (lot) return showLot(+lot.dataset.lot);
    const loc = e.target.closest('li[data-loc]'); if (loc) { stockLoc = +loc.dataset.loc; return renderLocations(); }
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; return open(+a.dataset.entry); }
  });
  $('#stock').addEventListener('submit', e => { e.preventDefault(); saveLotForm(); });
  $('#reg').addEventListener('click', e => {
    const lot = e.target.closest('[data-lot]'); if (lot) return showLot(+lot.dataset.lot);
    if (e.target.dataset.lotfor) return showLot('new', {entity: +e.target.dataset.lotfor, unit: 'µl'});
  });
}
