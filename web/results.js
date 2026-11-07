// Strukturierte Ergebnisse: Ergebnis-Block im Eintrag (Tabelle nach Vorlage, mit Formeln und Kennzahlen)
// und die Auswertung über alle Einträge (Tabelle, Diagramm, Kennzahlen, CSV).
'use strict';

let RESULT_SCHEMAS = [];
const NUMERIC = f => f.type == 'number' || f.type == 'formula';
async function loadResultSchemas() { RESULT_SCHEMAS = await call('resultSchemas'); return RESULT_SCHEMAS; }
const schemaFields = id => { const s = RESULT_SCHEMAS.find(x => x.id == id); return s ? JSON.parse(s.fields_json) : []; };

/// Zeile mit berechneten Formelfeldern (in Feldreihenfolge, damit Formeln auf frühere Formeln zugreifen können)
function computeRow(fields, row) {
  const out = {...row};
  for (const f of fields) if (f.type == 'formula') {
    try { const v = Calc.formula(f.expr, out); out[f.key] = v == null ? '' : +v.toPrecision(6); } catch { out[f.key] = ''; }
  }
  return out;
}

// ---------- Ergebnis-Block ----------
const ResultsNode = TT.Node.create({
  name: 'results', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({schema: {default: null}, rows: {default: [{}]}}),
  parseHTML: () => [{tag: 'div[data-results]', getAttrs: el => JSON.parse(el.getAttribute('data-results') || '{}')}],
  renderHTML: ({node}) => {
    const f = schemaFields(node.attrs.schema), rows = node.attrs.rows.map(r => computeRow(f, r));
    const name = RESULT_SCHEMAS.find(x => x.id == node.attrs.schema)?.name || 'Ergebnisse';
    return ['div', {'data-results': JSON.stringify(node.attrs)}, ['p', {}, `📊 ${name}`],
      ['table', {}, ['tr', {}, ...f.map(x => ['th', {}, x.label + (x.unit ? ` (${x.unit})` : '')])],
        ...rows.map(r => ['tr', {}, ...f.map(x => ['td', {}, r[x.key] == null ? '' : String(r[x.key]).replace('.', ',')])])]];
  },
  renderText: ({node}) => {
    const f = schemaFields(node.attrs.schema);
    return node.attrs.rows.map(r => computeRow(f, r)).map(r => f.map(x => `${x.label}: ${r[x.key] ?? ''}`).join(', ')).join('\n');
  },
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node, dirty = false;
    const dom = document.createElement('div');
    dom.className = 'results'; dom.contentEditable = 'false';
    const commit = rows => { const pos = getPos(); if (typeof pos == 'number' && editor.isEditable) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, rows})); };
    const read = () => [...dom.querySelectorAll('tbody tr[data-r]')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value])));
    function render() {
      const f = schemaFields(cur.attrs.schema), ro = !editor.isEditable, name = RESULT_SCHEMAS.find(x => x.id == cur.attrs.schema)?.name || 'Vorlage fehlt';
      const rows = cur.attrs.rows.length ? cur.attrs.rows : [{}];
      const dev = f.some(x => x.key == 'ct') ? 'qpcr' : f.some(x => x.key == 'konz') && f.some(x => x.key == 'a260_280') ? 'nanodrop' : null;
      dom.innerHTML = `<div class="rshead">📊 ${esc(name)}${dev && !ro ? ` <button class="btn" data-rdev="${dev}">📥 ${dev == 'qpcr' ? 'qPCR-Export' : 'NanoDrop-Export'}</button>` : ''}</div><table class="rstab"><thead><tr>${f.map(x => `<th class="${NUMERIC(x) ? 'num' : ''}">${esc(x.label)}${x.unit ? `<small> ${esc(x.unit)}</small>` : ''}</th>`).join('')}${ro ? '' : '<th></th>'}</tr></thead>
        <tbody>${rows.map((r, i) => { const c = computeRow(f, r); return `<tr data-r="${i}">${f.map(x => x.type == 'formula'
          ? `<td class="num calcd" data-fk="${x.key}">${esc(Calc.fmt(Calc.num(c[x.key])))}</td>`
          : `<td>${x.type == 'select' ? `<select data-k="${x.key}" ${ro ? 'disabled' : ''}><option></option>${x.options.map(o => `<option ${o == r[x.key] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
            : `<input data-k="${x.key}" value="${esc(r[x.key] ?? '')}" ${x.type == 'number' ? 'inputmode="decimal" class="num"' : x.type == 'date' ? 'type="date"' : ''} ${ro ? 'disabled' : ''}>`}</td>`).join('')}
          ${ro ? '' : `<td><button class="x" data-rdel="${i}" title="Zeile löschen">×</button></td>`}</tr>`; }).join('')}</tbody>
        <tfoot>${statsRow(f, rows)}</tfoot></table>${ro ? '' : '<button class="btn" data-radd>+ Zeile</button>'}`;
    }
    function statsRow(f, rows) {
      const comp = rows.map(r => computeRow(f, r));
      if (comp.length < 2) return '';
      return `<tr>${f.map(x => { if (!NUMERIC(x)) return '<td class="sub">Mittel ± SD</td>'; const s = Calc.stats(comp.map(r => r[x.key]));
        return `<td class="num sub">${s.n ? Calc.fmt(s.mean) + (s.sd != null ? ' ± ' + Calc.fmt(s.sd) : '') : ''}</td>`; }).join('')}<td></td></tr>`;
    }
    const refresh = () => {  // Formeln und Kennzahlen live, ohne die Eingabefelder neu zu zeichnen
      const f = schemaFields(cur.attrs.schema), rows = read();
      dom.querySelectorAll('tbody tr[data-r]').forEach((tr, i) => { const c = computeRow(f, rows[i]);
        tr.querySelectorAll('[data-fk]').forEach(td => { td.textContent = Calc.fmt(Calc.num(c[td.dataset.fk])); }); });
      dom.querySelector('tfoot').innerHTML = statsRow(f, rows);
    };
    const pending = () => { if (dirty) { dirty = false; commit(read()); } };
    CALC_PENDING.add(pending);
    dom.addEventListener('input', () => { dirty = true; refresh(); });
    dom.addEventListener('change', () => { dirty = true; refresh(); });
    dom.addEventListener('focusout', e => { if (!dom.contains(e.relatedTarget)) pending(); });
    dom.addEventListener('keydown', e => {
      if (e.key == 'Enter' && e.target.tagName == 'INPUT') { e.preventDefault(); const rows = read(); const r = +e.target.closest('tr').dataset.r;
        if (r == rows.length - 1) { rows.push({}); dirty = false; commit(rows); setTimeout(() => dom.querySelector(`tr[data-r="${r + 1}"] input`)?.focus()); } else dom.querySelector(`tr[data-r="${r + 1}"] [data-k="${e.target.dataset.k}"]`)?.focus(); }
    });
    dom.addEventListener('click', e => {
      if (!editor.isEditable) return;
      if (e.target.dataset.radd !== undefined) { const rows = read(); rows.push({}); dirty = false; commit(rows); }
      if (e.target.dataset.rdev) pickDeviceFile({apply: (text, name) => {
        const de = s => s == null ? '' : String(s).replace('.', ','), keep = read().filter(r => Object.values(r).some(v => String(v ?? '').trim()));
        let add;
        if (e.target.dataset.rdev == 'nanodrop') add = DevFiles.parseNanoDrop(text).map(x => ({probe: x.sample, konz: de(x.conc), a260_280: de(x.a260_280), a260_230: de(x.a260_230)}));
        else {
          const ct = DevFiles.parseCt(text);
          let res = DevFiles.ctToRows(ct);
          if (!res.ref) { const ref = prompt(`Referenzgen? (${[...new Set(ct.map(r => r.target))].join(', ')})`); if (ref) res = DevFiles.ctToRows(ct, ref.trim()); }
          add = res.rows.map(r => ({probe: r.probe, gen: r.gen, ct: de(r.ct), ct_ref: de(r.ct_ref)}));
        }
        dirty = false; commit([...keep, ...add]);
        status(`${add.length} Zeile(n) aus ${name} übernommen`);
      }});
      if (e.target.dataset.rdel != null) { const rows = read(); rows.splice(+e.target.dataset.rdel, 1); dirty = false; commit(rows.length ? rows : [{}]); }
    });
    render();
    return {dom, update: n => { if (n.type.name != 'results') return false; const ch = JSON.stringify(n.attrs) != JSON.stringify(cur.attrs); cur = n; if (ch) { dirty = false; render(); } return true; },
      stopEvent: e => !!e.target.closest?.('input, select, button'), ignoreMutation: () => true, destroy: () => CALC_PENDING.delete(pending)};
  },
});

async function insertResults() {
  await loadResultSchemas();
  const list = RESULT_SCHEMAS.filter(s => !s.archived);
  const pick = prompt(`Ergebnisvorlage wählen:\n${list.map((s, i) => `${i + 1}: ${s.name}`).join('\n')}`, '1');
  const s = list[(+pick || 0) - 1];
  if (!s) return;
  editor.chain().focus().insertContent([{type: 'results', attrs: {schema: s.id, rows: [{}]}}, {type: 'paragraph'}]).run();
}

/// Für das Speichern: Zeilen samt berechneten Formeln
function collectResults(doc) {
  const out = [];
  const walk = n => { if (n.type == 'results' && n.attrs?.schema) out.push({schema: n.attrs.schema, rows: n.attrs.rows.map(r => computeRow(schemaFields(n.attrs.schema), r))}); (n.content || []).forEach(walk); };
  walk(doc);
  return out;
}

// ---------- Auswertung ----------
let AN = {schema: null, project: '', from: '', to: '', y: null, x: 'date'};

async function showAnalysis() {
  await flush();
  await loadResultSchemas();
  showView('analysis');
  document.querySelectorAll('#stockNav li').forEach(li => li.classList.toggle('cur', li.dataset.stock == 'analysis'));
  if (!AN.schema || !RESULT_SCHEMAS.some(s => s.id == AN.schema)) AN.schema = (RESULT_SCHEMAS.find(s => s.rows) || RESULT_SCHEMAS[0])?.id;
  return renderAnalysis();
}

async function renderAnalysis() {
  const f = schemaFields(AN.schema), nums = f.filter(NUMERIC);
  if (!nums.some(x => x.key == AN.y)) AN.y = (nums.find(x => x.type == 'formula') || nums[0])?.key;
  if (AN.x != 'date' && !nums.some(x => x.key == AN.x)) AN.x = 'date';
  const raw = AN.schema ? await call('resultRows', {schema: AN.schema, ...(AN.project !== '' ? {project: +AN.project} : {}), from: AN.from, to: AN.to}) : [];
  const rows = raw.map(r => ({...computeRow(f, JSON.parse(r.values_json)), _entry: r.entry_id, _title: r.title, _date: r.created}));
  const yF = f.find(x => x.key == AN.y), xF = f.find(x => x.key == AN.x);
  const st = yF ? Calc.stats(rows.map(r => r[yF.key])) : {n: 0};
  const unit = yF?.unit ? ` ${yF.unit}` : '';
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) == String(cur) ? 'selected' : ''}>${esc(l)}</option>`;
  $('#analysis').innerHTML = `<div class="reghead"><h2>📊 Auswertung</h2><button class="btn" data-schemanew>+ Vorlage</button>${AN.schema ? '<button class="btn" data-schemaedit>Vorlage bearbeiten</button>' : ''}</div>
    <div class="anfilters">
      <label>Vorlage <select data-an="schema">${RESULT_SCHEMAS.map(s => opt(s.id, `${s.name} (${s.rows})`, AN.schema)).join('')}</select></label>
      <label>Projekt <select data-an="project">${opt('', 'alle', AN.project)}${opt(0, 'ohne Projekt', AN.project)}${projects.map(p => opt(p.id, p.name, AN.project)).join('')}</select></label>
      <label>von <input type="date" data-an="from" value="${esc(AN.from)}"></label><label>bis <input type="date" data-an="to" value="${esc(AN.to)}"></label>
      <label>Wert <select data-an="y">${nums.map(x => opt(x.key, x.label, AN.y)).join('')}</select></label>
      <label>gegen <select data-an="x">${opt('date', 'Datum des Eintrags', AN.x)}${nums.filter(x => x.key != AN.y).map(x => opt(x.key, x.label, AN.x)).join('')}</select></label>
      <button class="btn" data-ancsv ${rows.length ? '' : 'disabled'}>CSV</button></div>
    ${yF ? `<div class="tiles">${[['n', st.n], ['Mittelwert', st.n ? Calc.fmt(st.mean) + unit : '–'], ['SD', st.sd != null ? Calc.fmt(st.sd) + unit : '–'],
      ['Median', st.n ? Calc.fmt(st.median) + unit : '–'], ['Bereich', st.n ? `${Calc.fmt(st.min)}–${Calc.fmt(st.max)}${unit}` : '–'], ['VK', st.cv != null ? Calc.fmt(st.cv) + ' %' : '–']]
      .map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="chartbox"><div class="charttitle">${esc(yF.label)}${esc(unit)} ${xF ? `gegen ${esc(xF.label)}` : 'über die Zeit'}</div>${chartSVG(rows, yF, xF)}<div class="ctip" hidden></div></div>` : ''}
    ${rows.length ? `<table class="regtable antable"><tr><th>Eintrag</th><th>Datum</th>${f.map(x => `<th class="${NUMERIC(x) ? 'num' : ''}">${esc(x.label)}${x.unit ? ` <small>${esc(x.unit)}</small>` : ''}</th>`).join('')}</tr>
      ${rows.map(r => `<tr><td><a href="#" class="elink" data-entry="${r._entry}">↗ ${esc(r._title || 'Ohne Titel')}</a></td><td>${esc(r._date.slice(0, 10))}</td>
        ${f.map(x => `<td class="${NUMERIC(x) ? 'num' : ''}">${esc(NUMERIC(x) ? Calc.fmt(Calc.num(r[x.key])) : r[x.key] ?? '')}</td>`).join('')}</tr>`).join('')}</table>`
      : `<div class="empty">Noch keine Ergebnisse mit dieser Vorlage. Im Eintrag „📊 Ergebnisse“ einfügen.</div>`}`;
  AN._rows = rows;
}

/// Punkte (und bei Zeitachse eine Linie) als SVG; eine Reihe, eine Achse, leise Gitterlinien
function chartSVG(rows, yF, xF) {
  const pts = rows.map((r, i) => ({x: xF ? Calc.num(r[xF.key]) : Date.parse(r._date), y: Calc.num(r[yF.key]), i})).filter(p => p.x != null && !Number.isNaN(p.x) && p.y != null && !Number.isNaN(p.y));
  if (!pts.length) return '<p class="sub">Keine Werte zum Zeichnen.</p>';
  const W = 720, H = 280, L = 56, R = 16, T = 14, B = 34;
  const ext = (a, b) => a == b ? [a - (Math.abs(a) || 1) * 0.5, b + (Math.abs(b) || 1) * 0.5] : [a, b];
  const [xa, xb] = ext(Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x)));
  const x0 = xa - (xb - xa) * 0.04, x1 = xb + (xb - xa) * 0.04;  // Luft, damit Punkte nicht am Rand kleben
  const [y0r, y1r] = ext(Math.min(0, ...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)));
  const ticks = niceTicks(y0r, y1r, 5), y0 = ticks[0], y1 = ticks.at(-1);
  const sx = x => L + (x - x0) / (x1 - x0) * (W - L - R), sy = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const xt = xF ? niceTicks(x0, x1, 6) : [...new Set(pts.map(p => p.x))].length <= 6 ? [...new Set(pts.map(p => p.x))] : niceTicks(x0, x1, 5);
  const xl = v => xF ? Calc.fmt(v) : new Date(v).toLocaleDateString(I18N.locale, {day: '2-digit', month: '2-digit', year: '2-digit'});
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yF.label)}">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${L - 8}" y="${sy(t) + 4}" text-anchor="end">${Calc.fmt(t)}</text>`).join('')}
    ${xt.filter(t => t >= x0 && t <= x1).map(t => { const x = sx(t), a = x > W - R - 34 ? 'end' : x < L + 34 ? 'start' : 'middle';
      return `<text class="tick" x="${x}" y="${H - 12}" text-anchor="${a}">${xl(t)}</text>`; }).join('')}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${sy(y0)}" y2="${sy(y0)}"/>
    ${!xF && sorted.length > 1 ? `<polyline class="line" points="${sorted.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')}"/>` : ''}
    ${pts.map(p => `<circle class="pt" cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" data-pi="${p.i}"/><circle class="hit" cx="${sx(p.x)}" cy="${sy(p.y)}" r="12" data-pi="${p.i}"/>`).join('')}
  </svg>`;
}

function niceTicks(a, b, n) {
  const span = b - a, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.floor(a / step) * step; v <= b + step * 0.5; v += step) out.push(+v.toPrecision(12));
  return out;
}

function analysisCSV() {
  const f = schemaFields(AN.schema), q = v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [['Eintrag', 'Datum', ...f.map(x => x.label + (x.unit ? ` (${x.unit})` : ''))].map(q).join(';'),
    ...AN._rows.map(r => [r._title, r._date.slice(0, 10), ...f.map(x => NUMERIC(x) ? String(r[x.key] ?? '').replace('.', ',') : r[x.key] ?? '')].map(q).join(';'))];
  const name = `${RESULT_SCHEMAS.find(s => s.id == AN.schema)?.name || 'Ergebnisse'}.csv`;
  return call('saveText', {name, text: '﻿' + lines.join('\n')});  // BOM, damit Excel Umlaute richtig liest
}

// ---------- Vorlagen-Editor ----------
function schemaDialog(sch) {
  const fields = sch ? JSON.parse(sch.fields_json) : [{label: 'Probe', type: 'text'}, {label: 'Wert', type: 'number', unit: ''}];
  const types = {number: 'Zahl', text: 'Text', date: 'Datum', select: 'Auswahl', formula: 'Formel'};
  const row = f => `<div class="tfield"><input data-tl value="${esc(f.label || '')}" placeholder="Feldname"><select data-tt>${Object.entries(types).map(([k, l]) => `<option value="${k}" ${k == f.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-tu value="${esc(f.unit || '')}" placeholder="Einheit" style="width:70px"><input data-tx value="${esc(f.type == 'select' ? (f.options || []).join(', ') : f.expr || '')}" placeholder="${f.type == 'select' ? 'Optionen' : 'Formel, z. B. konz * volumen'}" ${['select', 'formula'].includes(f.type) ? '' : 'hidden'}>
    <input type="hidden" data-tk value="${esc(f.key || '')}"><button type="button" class="x" data-tdel>×</button></div>`;
  const dlg = $('#typedlg');
  dlg.innerHTML = `<form method="dialog"><h3>${sch ? 'Ergebnisvorlage bearbeiten' : 'Neue Ergebnisvorlage'}</h3>
    <div class="row"><label>Name <input id="sName" value="${esc(sch?.name || '')}" placeholder="z. B. Zellzählung"></label></div>
    <p class="sub">Formeln rechnen mit den Feldschlüsseln (in Klammern), z. B. <code>konz * volumen / 1000</code>.</p>
    <div id="tFields">${fields.map(row).join('')}</div><button type="button" class="btn" id="tAdd">+ Feld</button>
    <p class="sub" id="sKeys"></p><p id="tMsg" class="bad"></p>
    <div class="dlgbtns"><span class="grow"></span><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="tSave">Sichern</button></div></form>`;
  const keysOf = () => { const used = new Set(); return [...$('#tFields').children].map(r => { let k = r.querySelector('[data-tk]').value;
    if (!k) { k = slug(r.querySelector('[data-tl]').value).replace(/-/g, '_').replace(/^[^a-z]+/, '') || 'feld'; let i = 2, b = k; while (used.has(k)) k = `${b}_${i++}`; }
    used.add(k); return k; }); };
  const showKeys = () => { $('#sKeys').textContent = 'Feldschlüssel: ' + keysOf().join(', '); };
  dlg.showModal(); showKeys();
  $('#tFields').oninput = showKeys;
  $('#tAdd').onclick = () => { $('#tFields').insertAdjacentHTML('beforeend', row({label: '', type: 'number'})); showKeys(); };
  $('#tFields').onchange = e => { if (e.target.dataset.tt !== undefined) { const x = e.target.parentElement.querySelector('[data-tx]'); x.hidden = !['select', 'formula'].includes(e.target.value); x.placeholder = e.target.value == 'select' ? 'Optionen, durch Komma' : 'Formel'; } };
  $('#tFields').onclick = e => { if (e.target.dataset.tdel !== undefined) { e.target.closest('.tfield').remove(); showKeys(); } };
  $('#tSave').onclick = async () => {
    const keys = keysOf();
    const fs = [...$('#tFields').children].map((r, i) => { const type = r.querySelector('[data-tt]').value, x = r.querySelector('[data-tx]').value;
      return {key: keys[i], label: r.querySelector('[data-tl]').value.trim() || keys[i], type, unit: r.querySelector('[data-tu]').value,
        ...(type == 'select' ? {options: x.split(',').map(s => s.trim()).filter(Boolean)} : {}), ...(type == 'formula' ? {expr: x} : {})}; });
    try { AN.schema = await call('saveResultSchema', {...(sch ? {id: sch.id} : {}), name: $('#sName').value, fields: fs}); dlg.close(); await showAnalysis(); }
    catch (err) { $('#tMsg').textContent = err.message; }
  };
}

function initResults() {
  $('#analysis').addEventListener('change', e => { const k = e.target.dataset.an; if (!k) return; AN[k] = k == 'schema' ? +e.target.value : e.target.value; renderAnalysis(); });
  $('#analysis').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.ancsv !== undefined) analysisCSV().then(r => r && status(`CSV gespeichert: ${r.path}`));
    if (d.schemanew !== undefined) schemaDialog(null);
    if (d.schemaedit !== undefined) schemaDialog(RESULT_SCHEMAS.find(s => s.id == AN.schema));
    if (d.pi != null) { const r = AN._rows[+d.pi]; showView('doc'); cur = null; open(r._entry); }
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; open(+a.dataset.entry); }
  });
  $('#analysis').addEventListener('mouseover', e => {
    const tip = $('#analysis .ctip'); if (!tip) return;
    const pi = e.target.dataset?.pi;
    if (pi == null) { tip.hidden = true; return; }
    const r = AN._rows[+pi], yF = schemaFields(AN.schema).find(x => x.key == AN.y), box = $('#analysis .chartbox').getBoundingClientRect(), c = e.target.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(Calc.fmt(Calc.num(r[AN.y])))}${yF?.unit ? ' ' + esc(yF.unit) : ''}</b><br>${esc(r._title || 'Ohne Titel')}<br><span class="sub">${esc(r._date.slice(0, 10))}${r.probe ? ' · ' + esc(r.probe) : ''}</span>`;
    tip.hidden = false; tip.style.left = `${c.left - box.left + 14}px`; tip.style.top = `${c.top - box.top - 8}px`;
  });
}
