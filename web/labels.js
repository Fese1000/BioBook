// Etiketten mit QR-Code (PDF für Etikettenbögen) und Öffnen per Code: Kamera, Handscanner (tippt wie eine Tastatur), laborbuch://-Link.
'use strict';

const LABEL_LAYOUTS = {
  a4_3x8: {name: 'A4, 3 × 8 (70 × 37 mm)', cols: 3, rows: 8, w: 70, h: 37, left: 0, top: 0.5, gapX: 0, gapY: 0, qr: 26},
  a4_4x11: {name: 'A4, 4 × 11 klein (48,5 × 25,4 mm)', cols: 4, rows: 11, w: 48.5, h: 25.4, left: 8, top: 8.8, gapX: 0, gapY: 0, qr: 19},
};

/// Inhalt eines Etiketts: Link (für jede Scan-App) und gut lesbare ID
async function labelFor(t, id) {
  const book = await call('bookID');
  const url = `laborbuch://open?book=${encodeURIComponent(book)}&t=${t}&id=${id}`;
  if (t == 'lot') { const l = await call('lot', {id});
    return {url, code: l.code, title: l.name, lines: [l.lot_no && `Ch. ${l.lot_no}`, l.expiry && `bis ${l.expiry}`, l.location_path && `${l.location_path}${l.position ? ' ' + l.position : ''}`].filter(Boolean)}; }
  if (t == 'entity') { const e = await call('entity', {id}); return {url, code: e.code, title: e.name, lines: [e.type_name]}; }
  if (t == 'culture') { const c = await call('culture', {id});
    return {url, code: c.code, title: c.name, lines: [c.entity_code && `${c.entity_code} ${c.entity_name}`, `P${c.passage}${c.medium ? ' · ' + c.medium : ''}`].filter(Boolean)}; }
  if (t == 'device') { const d = await call('device', {id}); return {url, code: d.code, title: d.name, lines: [[d.model, d.serial && `SN ${d.serial}`].filter(Boolean).join(' · '), d.location_path].filter(Boolean)}; }
  if (t == 'location') { const l = (await call('locations')).find(x => x.id == id); return {url, code: `ORT-${id}`, title: l.name, lines: [l.path, l.temp].filter(Boolean)}; }
  return {url, code: `E-${id}`, title: (await call('load', {id})).title, lines: []};
}

async function printLabels(items, layoutKey = 'a4_3x8', name = 'Etiketten') {
  const L = LABEL_LAYOUTS[layoutKey];
  const qrs = await Promise.all(items.map(it => call('qr', {text: it.url})));
  const per = L.cols * L.rows, pages = [];
  for (let p = 0; p < items.length; p += per) pages.push(items.slice(p, p + per).map((it, i) => ({...it, qr: qrs[p + i]})));
  const cell = (it, i) => {
    const c = i % L.cols, r = Math.floor(i / L.cols);
    return `<div class="lab" style="left:${L.left + c * (L.w + L.gapX)}mm;top:${L.top + r * (L.h + L.gapY)}mm;width:${L.w}mm;height:${L.h}mm">
      <img src="data:image/png;base64,${it.qr}" style="width:${L.qr}mm;height:${L.qr}mm">
      <div class="lt"><b>${esc(it.code)}</b><div class="ln">${esc(it.title)}</div>${it.lines.map(x => `<div class="lx">${esc(x)}</div>`).join('')}</div></div>`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0} body{margin:0;font-family:-apple-system,Helvetica,sans-serif}
    .sheet{position:relative;width:210mm;height:296mm;page-break-after:always;overflow:hidden}
    .lab{position:absolute;box-sizing:border-box;padding:1.5mm 2mm;display:flex;gap:2mm;align-items:center;overflow:hidden}
    .lab img{flex:none;image-rendering:pixelated}.lt{min-width:0;font-size:${L.h < 30 ? 6.5 : 8}pt;line-height:1.2}
    .lt b{font:700 ${L.h < 30 ? 8 : 10}pt Menlo,monospace}.ln{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lx{color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style></head><body>${pages.map(pg => `<div class="sheet">${pg.map(cell).join('')}</div>`).join('')}</body></html>`;
  try {
    const r = await call('labelsPDF', {html, name: `${name}.pdf`});
    if (r) status(`${items.length} Etikett(en) gespeichert: ${r.path}`);
    return r;
  } catch (e) { alert('Etiketten fehlgeschlagen: ' + e.message); }
}

/// Fragt nach dem Bogen und druckt
async function labelDialog(targets, name) {
  const keys = Object.keys(LABEL_LAYOUTS);
  const pick = prompt(`Etikettenbogen wählen:\n${keys.map((k, i) => `${i + 1}: ${LABEL_LAYOUTS[k].name}`).join('\n')}`, '1');
  if (pick == null) return;
  const key = keys[(+pick || 1) - 1] || keys[0];
  status('Etiketten werden erstellt …');
  const items = [];
  for (const [t, id] of targets) items.push(await labelFor(t, id));
  return printLabels(items, key, name);
}

/// Gescannten oder getippten Code öffnen
async function openCode(code) {
  const t = await call('resolveCode', {code});
  if (!t) { status(`Unbekannter Code: ${code}`); return false; }
  if (t.otherBook) { status('Dieses Etikett gehört zu einem anderen Laborbuch'); return false; }
  if (t.t == 'lot') await showLot(t.id);
  else if (t.t == 'entity') await showEntity(t.id);
  else if (t.t == 'location') { stockLoc = t.id; await showStock('locations'); }
  else if (t.t == 'culture') await showCulture(t.id);
  else if (t.t == 'device') await showDevice(t.id);
  else if (t.t == 'entry') { showView('doc'); cur = null; await open(t.id); }
  return true;
}

function initLabels() {
  // Handscanner tippen den Code ins Suchfeld und drücken Enter
  $('#search').addEventListener('keydown', async e => {
    if (e.key != 'Enter') return;
    const v = e.target.value.trim();
    if (/^(laborbuch:\/\/|(BS|KU|GE)-\d{5}$|[A-Z]{1,4}-\d{4}$)/.test(v) && await openCode(v)) { e.target.value = ''; refreshList(); }
  });
  document.addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.label) { const [t, id] = d.label.split(':'); labelDialog([[t, +id]], `Etikett ${t}-${id}`); }
    if (d.labelbox) labelBox(+d.labelbox);
  });
}

async function labelBox(id) {
  const lots = await call('lots', {filter: `location:${id}`});
  return labelDialog([['location', id], ...lots.map(l => ['lot', l.id])], 'Etiketten Box');
}
