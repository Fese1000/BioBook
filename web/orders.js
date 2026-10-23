// Bestellungen: Vorschläge aus knappen Chargen, Bestellliste mit Status, Wareneingang legt eine neue Charge an; Liste als CSV.
'use strict';

let orderFilter = 'open';
const PSTAT = {offen: ['offen', 'warn'], bestellt: ['bestellt', 'mut'], geliefert: ['geliefert', 'ok'], storniert: ['storniert', 'mut']};
const pbadge = s => `<span class="wbadge ${PSTAT[s][1]}">${PSTAT[s][0]}</span>`;
const pamount = p => p.amount ? `${p.qty > 1 ? `${p.qty} × ` : ''}${Calc.fmt(+p.amount)} ${p.unit}` : `${p.qty} ${p.unit || 'Stück'}`;

async function refreshOrderBadge() {
  const n = await call('purchaseCounts');
  const b = $('#orderBadge');
  b.hidden = !n.suggestions; b.textContent = n.suggestions; b.title = `${n.suggestions} knappe Chargen ohne Bestellung · ${n.open} offene Bestellung(en)`;
  return n;
}

async function showOrders() {
  await flush();
  showView('orders'); navCur('orders');
  return renderOrders();
}

async function renderOrders() {
  const [sugg, list] = await Promise.all([call('purchaseSuggestions'), call('purchases', {filter: orderFilter})]);
  $('#orders').innerHTML = `<div class="reghead"><h2>🛒 Bestellungen</h2>
      <button class="btn ${orderFilter == 'all' ? 'on' : ''}" data-ofilter="${orderFilter == 'all' ? 'open' : 'all'}">Erledigte zeigen</button>
      <button class="btn" data-ocsv>CSV der offenen</button><button class="btn on" data-onew>+ Artikel</button></div>
    ${sugg.length ? `<h3 class="osec">Knapp und nicht bestellt</h3><table class="regtable">
      <tr><th>Charge</th><th>Artikel</th><th>Vorhanden</th><th>Mindestens</th><th>Lieferant · Kat.-Nr.</th><th></th></tr>
      ${sugg.map(x => `<tr><td><code data-lot="${x.lot_id}" class="lnk">${x.code}</code></td><td><b>${esc(x.name)}</b></td>
        <td class="num">${Calc.fmt(x.total)} ${esc(x.unit)}</td><td class="num">${Calc.fmt(x.min)} ${esc(x.unit)}</td>
        <td>${esc([x.supplier, x.catalog].filter(Boolean).join(' · '))}</td><td><button class="btn on" data-osugg="${x.lot_id}">+ Auf die Liste</button></td></tr>`).join('')}</table>` : ''}
    <h3 class="osec">Bestellliste</h3>
    ${list.length ? `<table class="regtable"><tr><th>Nr.</th><th>Artikel</th><th>Menge</th><th>Lieferant · Kat.-Nr.</th><th>Preis</th><th>Status</th><th></th></tr>
      ${list.map(p => `<tr data-order="${p.id}"><td>${p.id}</td><td><b>${esc(p.name)}</b>${p.note ? `<br><span class="sub">${esc(p.note)}</span>` : ''}</td>
        <td class="num">${esc(pamount(p))}</td><td>${esc([p.supplier, p.catalog].filter(Boolean).join(' · '))}</td><td>${esc(p.price)}</td>
        <td>${pbadge(p.status)} <span class="sub">${p.status_at ? when(p.status_at) : ''}</span>${p.new_lot_code ? ` → <code data-lot="${p.new_lot}" class="lnk">${p.new_lot_code}</code>` : ''}</td>
        <td class="obtns">${p.status == 'offen' ? `<button class="btn" data-ostat="bestellt">Bestellt</button>` : ''}
          ${['offen', 'bestellt'].includes(p.status) ? `<button class="btn on" data-orecv>Eingang</button><button class="x" data-ostat="storniert" title="Stornieren">×</button>` : ''}</td></tr>`).join('')}</table>`
      : `<div class="empty">${orderFilter == 'all' ? 'Noch keine Bestellungen.' : 'Nichts offen.'} Knappe Chargen erscheinen oben als Vorschlag; mit <b>+ Artikel</b> lässt sich alles andere eintragen.</div>`}`;
  refreshOrderBadge();
}

/// Neue Bestellung: aus einer Charge (Vorschlag, „Nachbestellen“) oder frei
async function orderDialog({lot} = {}) {
  const l = lot ? await call('lot', {id: lot}) : null;
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>${l ? `Nachbestellen: ${esc(l.name)}` : 'Artikel auf die Bestellliste'}</h3>
    ${l ? '' : `<label class="rf"><span>Artikel</span><input id="oName" autocomplete="off" placeholder="z. B. Pipettenspitzen 200 µl"></label>`}
    <label class="rf"><span>Anzahl</span><input id="oQty" value="1" inputmode="numeric" style="width:70px"></label>
    <label class="rf"><span>Menge je Stück</span><div><input id="oAmt" inputmode="decimal" style="width:90px" placeholder="optional">
      <select id="oUnit">${[...new Set([l?.unit, ...LOT_UNITS].filter(Boolean))].map(u => `<option ${u == (l?.unit || 'Stück') ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div></label>
    <label class="rf"><span>Lieferant</span><input id="oSup" value="${esc(l?.supplier || '')}"></label>
    <label class="rf"><span>Katalognr.</span><input id="oCat" value="${esc(l?.catalog || '')}"></label>
    <label class="rf"><span>Preis</span><input id="oPrice" placeholder="optional"></label>
    <label class="rf"><span>Notiz</span><input id="oNote"></label>
    <p id="oMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="oSave">Auf die Liste</button></div></form>`;
  dlg.showModal();
  $('#oSave').onclick = async () => {
    try {
      await call('createPurchase', {values: {...(l ? {lot: l.id} : {name: $('#oName').value}), qty: $('#oQty').value, amount: $('#oAmt').value, unit: $('#oUnit').value,
        supplier: $('#oSup').value, catalog: $('#oCat').value, price: $('#oPrice').value, note: $('#oNote').value}});
      dlg.close();
      await showOrders();
    } catch (e) { $('#oMsg').textContent = e.message; }
  };
}

/// Wareneingang: gelieferte Menge, Chargennummer, Ablauf, Standort → neue Charge
async function receiveDialog(id) {
  const p = await call('purchase', {id});
  const locs = await call('locations');
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Wareneingang: ${esc(p.name)}</h3>
    <label class="rf"><span>Gelieferte Menge</span><div><input id="rAmt" value="${p.amount ? Calc.fmt(p.amount * p.qty) : p.qty}" inputmode="decimal" style="width:90px"> ${esc(p.unit || 'Stück')}</div></label>
    <label class="rf"><span>Chargennummer</span><input id="rLotNo" autocomplete="off"></label>
    <label class="rf"><span>Ablaufdatum</span><input id="rExp" type="date"></label>
    <label class="rf"><span>Standort</span><select id="rLoc"><option value="">—</option>${locs.map(x => `<option value="${x.id}">${esc(x.path)}</option>`).join('')}</select></label>
    <label class="rf"><span>Position</span><input id="rPos" placeholder="z. B. A3 (nur in Boxen)" maxlength="3"></label>
    <p id="rMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="rSave">Einbuchen</button></div></form>`;
  dlg.showModal();
  $('#rSave').onclick = async () => {
    try {
      const r = await call('receivePurchase', {id, values: {amount: $('#rAmt').value, unit: p.unit || 'Stück', lot_no: $('#rLotNo').value, expiry: $('#rExp').value,
        position: $('#rPos').value, ...($('#rLoc').value ? {location: +$('#rLoc').value} : {})}});
      dlg.close();
      await showLot(r.lot.id);
      status(`Eingang verbucht: neue Charge ${r.lot.code}, ${amt(r.lot)}`);
      refreshStockBadge(); refreshOrderBadge();
      return r;
    } catch (e) { $('#rMsg').textContent = e.message; }
  };
}

async function ordersCSV() {
  const list = await call('purchases', {filter: 'open'});
  const q = v => /[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = [['Nr.', 'Artikel', 'Anzahl', 'Menge je Stück', 'Einheit', 'Lieferant', 'Katalognr.', 'Preis', 'Status', 'Notiz'],
    ...list.map(p => [p.id, p.name, p.qty, p.amount ? Calc.fmt(+p.amount) : '', p.unit, p.supplier, p.catalog, p.price, p.status, p.note])];
  const r = await call('saveText', {name: `Bestellliste ${today()}.csv`, text: '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n')});
  if (r) status(`Bestellliste gespeichert: ${r.path}`);
  return r;
}

function initOrders() {
  $('#orders').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.ofilter) { orderFilter = d.ofilter; return renderOrders(); }
    if (d.onew !== undefined) return orderDialog();
    if (d.ocsv !== undefined) return ordersCSV();
    if (d.osugg) return orderDialog({lot: +d.osugg});
    const row = e.target.closest('[data-order]');
    if (d.orecv !== undefined) return receiveDialog(+row.dataset.order);
    if (d.ostat) {
      if (d.ostat == 'storniert' && !confirm('Bestellung stornieren?')) return;
      try { await call('setPurchaseStatus', {id: +row.dataset.order, status: d.ostat}); } catch (err) { return alert(err.message); }
      return renderOrders();
    }
    const lot = e.target.closest('[data-lot]'); if (lot) return showLot(+lot.dataset.lot);
  });
}
