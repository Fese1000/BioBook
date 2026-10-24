// Erweiterungen: eigene Rechner-Blöcke als JavaScript-Datei. Jede Erweiterung läuft in einem abgeschotteten Rahmen
// (sandbox="allow-scripts", eigener Ursprung, CSP default-src 'none'): kein Netz, keine Dateien, kein Zugriff auf das Laborbuch –
// die App-Brücke nimmt aus Rahmen ohnehin nichts an. Sie bekommt nur die Feldwerte und liefert Ergebniszeilen zurück.
'use strict';

const EXT = new Map();        // id → {id, name, version, file, blocks, frame}
const EXT_ERRORS = [];        // {file, message}
const EXT_PENDING = new Map(); // reqId → {resolve, reject, timer}
let EXT_REQ = 0;

/// Laufzeit im Worker: laborbuch.register(def) meldet die Blöcke; compute läuft nur hier. Netz-Funktionen sind zusätzlich abgeschaltet.
const EXT_WORKER_RT = `
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches']) { try { self[k] = undefined; } catch {} }
  const defs = {};
  self.laborbuch = {register(def) {
    if (!def || typeof def.id != 'string') throw new Error('register: id fehlt');
    defs[def.id] = def;
    postMessage({type: 'register', def: JSON.parse(JSON.stringify({id: def.id, name: def.name, version: def.version,
      blocks: (def.blocks || []).map(b => ({id: b.id, title: b.title, icon: b.icon, fields: b.fields}))}))});
  }};
  onmessage = e => {
    const m = e.data || {};
    if (m.type != 'compute') return;
    try {
      const b = (defs[m.ext]?.blocks || []).find(x => x.id == m.block);
      if (!b || typeof b.compute != 'function') throw new Error('Block unbekannt');
      postMessage({type: 'result', reqId: m.reqId, result: JSON.parse(JSON.stringify(b.compute(m.values || {}) ?? []))});
    } catch (err) { postMessage({type: 'result', reqId: m.reqId, error: String(err && err.message || err)}); }
  };
`;

/// Vermittler im abgeschotteten Rahmen: startet die Erweiterung als Worker (eigener Faden – eine Endlosschleife
/// blockiert die App nicht), bricht zu lange Rechnungen ab und startet neu
function extBrokerHTML(code) {
  const js = s => JSON.stringify(s).replace(/</g, '\\u003c');  // kein „</script>“ im Rahmen
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:">`
    + `<script>
      const src = ${js(EXT_WORKER_RT)} + '\\n' + ${js(code)};
      let w; const pend = new Map();
      function start() {
        w = new Worker(URL.createObjectURL(new Blob([src], {type: 'text/javascript'})));
        w.onmessage = e => { const m = e.data || {}; if (m.type == 'result') { clearTimeout(pend.get(m.reqId)); pend.delete(m.reqId); } parent.postMessage(m, '*'); };
        w.onerror = e => { e.preventDefault(); parent.postMessage({type: 'error', message: e.message || 'Fehler beim Laden'}, '*'); };
      }
      start();
      addEventListener('message', e => {
        if (e.source !== parent) return;
        const m = e.data || {};
        if (m.type != 'compute') return;
        pend.set(m.reqId, setTimeout(() => { pend.delete(m.reqId); w.terminate(); start(); parent.postMessage({type: 'result', reqId: m.reqId, error: 'Erweiterung rechnet zu lange – abgebrochen'}, '*'); }, 1500));
        w.postMessage(m);
      });
    <\/script>`;
}

/// Ergebnis einer Erweiterung prüfen: höchstens 20 Zeilen {label, value, unit}, nur Text und Zahlen
function cleanExtResult(r) {
  if (!Array.isArray(r)) throw new Error('Ergebnis muss eine Liste sein');
  return r.slice(0, 20).map(x => ({label: String(x?.label ?? '').slice(0, 80), unit: String(x?.unit ?? '').slice(0, 20),
    value: typeof x?.value == 'number' ? (Number.isFinite(x.value) ? x.value : null) : x?.value == null ? null : String(x.value).slice(0, 200)}));
}

window.addEventListener('message', e => {
  const m = e.data || {};
  const frame = [...document.querySelectorAll('iframe.extframe')].find(f => f.contentWindow === e.source);
  if (!frame) return;  // nur aus eigenen Rahmen
  if (m.type == 'register' && m.def?.id) {
    const def = m.def;
    if (EXT.has(def.id) && EXT.get(def.id).frame !== frame) { EXT_ERRORS.push({file: frame.dataset.file, message: `ID „${def.id}“ ist schon vergeben`}); return; }
    EXT.set(def.id, {id: String(def.id), name: String(def.name || def.id), version: String(def.version || ''), file: frame.dataset.file, frame,
      blocks: (def.blocks || []).filter(b => b && b.id).map(b => ({id: String(b.id), title: String(b.title || b.id), icon: String(b.icon || '🧩').slice(0, 4),
        fields: (b.fields || []).slice(0, 30).map(f => ({key: String(f.key), label: String(f.label || f.key), type: f.type == 'text' ? 'text' : 'number', unit: String(f.unit || ''), default: f.default ?? ''}))}))});
    renderToolbar();
  } else if (m.type == 'result') {
    const p = EXT_PENDING.get(m.reqId); if (!p) return;
    EXT_PENDING.delete(m.reqId); clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error)); else { try { p.resolve(cleanExtResult(m.result)); } catch (err) { p.reject(err); } }
  } else if (m.type == 'error') EXT_ERRORS.push({file: frame.dataset.file, message: String(m.message)});
});

/// Rechnen lassen; der Rahmen bricht nach 1,5 s ab, hier zur Sicherheit nach 3 s
function extCompute(extId, blockId, values) {
  const x = EXT.get(extId);
  if (!x) return Promise.reject(new Error('Erweiterung nicht geladen oder ausgeschaltet'));
  return new Promise((resolve, reject) => {
    const reqId = ++EXT_REQ;
    EXT_PENDING.set(reqId, {resolve, reject, timer: setTimeout(() => { EXT_PENDING.delete(reqId); reject(new Error('Erweiterung antwortet nicht')); }, 3000)});
    x.frame.contentWindow.postMessage({type: 'compute', reqId, ext: extId, block: blockId, values}, '*');
  });
}

/// Alle eingeschalteten Erweiterungen (neu) laden
async function loadExtensions() {
  document.querySelectorAll('iframe.extframe').forEach(f => f.remove());
  EXT.clear(); EXT_ERRORS.length = 0;
  const list = await call('extensions').catch(() => []);
  const ready = list.filter(x => x.enabled).map(x => new Promise(res => {
    const f = document.createElement('iframe');
    f.className = 'extframe'; f.hidden = true; f.dataset.file = x.file;
    f.setAttribute('sandbox', 'allow-scripts');  // kein allow-same-origin: eigener, leerer Ursprung
    f.srcdoc = extBrokerHTML(x.code);
    f.onload = () => res();
    document.body.appendChild(f);
  }));
  await Promise.all(ready);
  await new Promise(r => setTimeout(r, 50));
  renderToolbar();
  document.dispatchEvent(new Event('lb-extensions'));
  return list;
}

const extBlocks = () => [...EXT.values()].flatMap(x => x.blocks.map(b => ({...b, ext: x.id, extName: x.name})));

function extMenu(btn) {
  document.querySelector('.suggest.calcmenu')?.remove();
  const el = document.createElement('div');
  el.className = 'suggest calcmenu';
  el.innerHTML = extBlocks().map(b => `<div class="opt" data-eb="${esc(b.ext)}|${esc(b.id)}">${esc(b.icon)} ${esc(b.title)} <span class="sub">${esc(b.extName)}</span></div>`).join('');
  const r = btn.getBoundingClientRect();
  el.style.left = `${r.left}px`; el.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = e => { if (!el.contains(e.target)) close(); };
  el.addEventListener('mousedown', e => { const o = e.target.closest('[data-eb]'); if (o) { e.preventDefault(); close(); const [x, b] = o.dataset.eb.split('|'); insertExtBlock(x, b); } });
  setTimeout(() => document.addEventListener('mousedown', outside, true));
}

function insertExtBlock(ext, block) {
  const b = EXT.get(ext)?.blocks.find(x => x.id == block); if (!b) return;
  const values = Object.fromEntries(b.fields.map(f => [f.key, String(f.default ?? '')]));
  editor.chain().focus().insertContent([{type: 'extblock', attrs: {ext, block, title: `${b.icon} ${b.title}`, fields: b.fields, values, result: []}}, {type: 'paragraph'}]).run();
}

/// Zahlen lesbar, große als „7,50 × 10⁶“ (Zellzahlen)
const SUP = {'-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹'};
function extFmt(v) {
  if (v == null) return '–';
  if (typeof v != 'number') return String(v);
  if (Math.abs(v) < 1e5 || !Number.isFinite(v)) return Calc.fmt(v);
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${(v / 10 ** e).toFixed(2).replace('.', ',')} × 10${String(e).split('').map(c => SUP[c]).join('')}`;
}
const extResultText = a => (a.result || []).map(r => `${r.label}: ${extFmt(r.value)}${r.unit ? ' ' + r.unit : ''}`).join('; ');

/// Block im Eintrag: Felder, Ergebnis (steht im Eintrag, auch wenn die Erweiterung später fehlt)
const ExtNode = TT.Node.create({
  name: 'extblock', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ext: {default: ''}, block: {default: ''}, title: {default: ''}, fields: {default: []}, values: {default: {}}, result: {default: []}}),
  parseHTML: () => [{tag: 'div[data-extblock]', getAttrs: el => JSON.parse(el.getAttribute('data-extblock') || '{}')}],
  renderHTML: ({node}) => {
    const a = node.attrs;
    return ['div', {'data-extblock': JSON.stringify(a), class: 'ext-print'}, ['p', {}, ['b', {}, a.title], ` – ${a.fields.map(f => `${f.label}: ${a.values[f.key] ?? ''}${f.unit ? ' ' + f.unit : ''}`).join(', ')}`],
      ['p', {}, extResultText(a) || 'kein Ergebnis']];
  },
  renderText: ({node}) => `${node.attrs.title}: ${extResultText(node.attrs)}`,
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node, values = {...node.attrs.values}, timer;
    const dom = document.createElement('div');
    dom.className = 'extblock'; dom.contentEditable = 'false';
    const commit = result => { const pos = getPos(); if (typeof pos == 'number' && editor.isEditable) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, values: {...values}, result})); };
    const showResult = (rows, msg = '') => {
      dom.querySelector('.extres').innerHTML = (rows.length ? `<table class="ctab">${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num"><b>${esc(extFmt(r.value))}</b> ${esc(r.unit)}</td></tr>`).join('')}</table>` : '')
        + (msg ? `<p class="bad">${esc(msg)}</p>` : '');
    };
    async function run(save) {
      try { const rows = await extCompute(cur.attrs.ext, cur.attrs.block, values); showResult(rows); if (save) commit(rows); }
      catch (e) { showResult(cur.attrs.result || [], e.message); }
    }
    const ro = !editor.isEditable;
    dom.innerHTML = `<div class="chead"><span class="ui">${esc(cur.attrs.title)}</span><span class="wbadge mut extmissing" ${EXT.has(cur.attrs.ext) ? 'hidden' : ''}>Erweiterung fehlt – gespeichertes Ergebnis</span></div>
      <div class="extfields">${cur.attrs.fields.map(f => `<label><span>${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ''}</span><input data-xk="${esc(f.key)}" value="${esc(values[f.key] ?? '')}" ${f.type == 'number' ? 'inputmode="decimal"' : ''} ${ro ? 'readonly' : ''}></label>`).join('')}</div>
      <div class="extres"></div>`;
    showResult(cur.attrs.result || []);
    dom.addEventListener('input', e => { const k = e.target.dataset.xk; if (k == null) return; values[k] = e.target.value; clearTimeout(timer); timer = setTimeout(() => run(false), 150); });
    dom.addEventListener('focusout', e => { if (!dom.contains(e.relatedTarget) && EXT.has(cur.attrs.ext)) run(true); });
    if (EXT.has(cur.attrs.ext) && !ro && !(cur.attrs.result || []).length) run(true);
    const onExt = () => { dom.querySelector('.extmissing').hidden = EXT.has(cur.attrs.ext); };  // Erweiterung ein- oder ausgeschaltet
    document.addEventListener('lb-extensions', onExt);
    return {dom, update: n => { if (n.type.name != 'extblock') return false; cur = n; return true; },
      stopEvent: e => !!e.target.closest?.('input'), ignoreMutation: () => true, destroy: () => document.removeEventListener('lb-extensions', onExt)};
  },
});

/// Abschnitt in den Einstellungen: Liste, ein/aus, Ordner, Beispiele
async function extSettingsHTML() {
  const list = await call('extensions').catch(() => []);
  return `<h4>Erweiterungen</h4>
    <p class="sub">Eigene Rechner-Blöcke als .js-Datei im Ordner „Erweiterungen“. Sie laufen abgeschottet: kein Netz, keine Dateien, kein Zugriff auf das Laborbuch.</p>
    ${list.map(x => { const loaded = [...EXT.values()].find(e => e.file == x.file), err = EXT_ERRORS.find(e => e.file == x.file);
      return `<label class="row"><input type="checkbox" data-extfile="${esc(x.file)}" ${x.enabled ? 'checked' : ''}> ${esc(loaded ? `${loaded.name} ${loaded.version}` : x.file)}
        ${err ? `<span class="bad">Fehler: ${esc(err.message)}</span>` : x.enabled && !loaded ? '<span class="bad">nicht geladen</span>' : ''}</label>`; }).join('') || '<p class="sub">Noch keine.</p>'}
    <p class="row"><button type="button" class="btn" id="extFolder">Ordner öffnen</button><button type="button" class="btn" id="extExamples">Beispiel (Zellzahl) installieren</button><button type="button" class="btn" id="extReload">Neu laden</button></p>`;
}

function bindExtSettings() {
  document.querySelectorAll('[data-extfile]').forEach(c => c.onchange = async () => { await call('setExtensionEnabled', {file: c.dataset.extfile, enabled: c.checked}); await loadExtensions(); });
  $('#extFolder').onclick = () => call('openExtensionsFolder');
  $('#extExamples').onclick = async () => { const r = await call('installExampleExtensions'); await loadExtensions(); status(r.length ? `Installiert: ${r.join(', ')}` : 'Beispiel ist schon da'); };
  $('#extReload').onclick = async () => { await loadExtensions(); status(`${EXT.size} Erweiterung(en) geladen`); };
}
