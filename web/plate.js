// Plattenlayout-Block (96 oder 384 Wells): Proben anlegen, Farbe wählen, Wells per Klick oder Ziehen belegen.
// Die Belegung steht im Knoten (attrs) und damit im Eintrag, in den Revisionen und im PDF.
'use strict';

const PLATE_FORMATS = {96: [8, 12], 384: [16, 24]};
const PLATE_COLORS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#9c755f', '#bab0ac', '#ff9da7', '#2f6f5e', '#555555'];
const wellName = (r, c) => `${String.fromCharCode(65 + r)}${c + 1}`;

/// Wells einer Probe kompakt beschreiben: „A1–A3, B1“
function wellRanges(wells, rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    let start = null;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && wells.has(wellName(r, c));
      if (on && start == null) start = c;
      if (!on && start != null) { out.push(start == c - 1 ? wellName(r, start) : `${wellName(r, start)}–${wellName(r, c - 1)}`); start = null; }
    }
  }
  return out.join(', ');
}

function plateSummary(a) {
  const [rows, cols] = PLATE_FORMATS[a.format] || PLATE_FORMATS[96];
  return (a.samples || []).map((s, i) => {
    const w = new Set(Object.entries(a.wells || {}).filter(([, v]) => v == i).map(([k]) => k));
    return w.size ? `${s.name}: ${wellRanges(w, rows, cols)}` : '';
  }).filter(Boolean).join('; ');
}

/// Messwerte: einfarbige Skala hell → dunkel (sequenziell), Schrift passend zur Helligkeit
function heat(v, min, max) {
  const t = max > min ? (v - min) / (max - min) : 0.5, a = [232, 240, 251], b = [31, 79, 153];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return {bg: `rgb(${c.join(',')})`, fg: t > 0.55 ? '#fff' : '#10233f'};
}
const plateRange = a => { const vs = Object.values(a.values || {}); return vs.length ? [Math.min(...vs), Math.max(...vs)] : null; };

/// Mittelwert ± SD der Messwerte je Probe
function plateStats(a) {
  if (!a.values || !Object.keys(a.values).length) return '';
  return (a.samples || []).map((s, i) => {
    const vs = Object.entries(a.wells || {}).filter(([w, v]) => v == i && a.values[w] != null).map(([w]) => a.values[w]);
    if (!vs.length) return '';
    const st = Calc.stats(vs);
    return `${s.name}: ${Calc.fmt(st.mean)}${st.sd != null ? ' ± ' + Calc.fmt(st.sd) : ''} (n = ${st.n})`;
  }).filter(Boolean).join('; ');
}

const PlateNode = TT.Node.create({
  name: 'plate', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({format: {default: 96}, title: {default: ''}, samples: {default: []}, wells: {default: {}}, values: {default: {}}, vlabel: {default: ''}, view: {default: 'layout'}}),
  parseHTML: () => [{tag: 'div[data-plate]', getAttrs: el => JSON.parse(el.getAttribute('data-plate') || '{}')}],
  renderHTML: ({node}) => {
    // als Tabelle (lesbar im PDF und im Export), Daten im Attribut
    const a = node.attrs, [rows, cols] = PLATE_FORMATS[a.format] || PLATE_FORMATS[96];
    const head = ['tr', {}, ['th', {}, ''], ...[...Array(cols)].map((_, c) => ['th', {}, String(c + 1)])];
    const body = [...Array(rows)].map((_, r) => ['tr', {}, ['th', {}, String.fromCharCode(65 + r)], ...[...Array(cols)].map((_, c) => {
      const w = wellName(r, c), i = a.wells?.[w], s = i != null ? a.samples[i] : null, v = a.values?.[w], rg = plateRange(a);
      if (v != null && rg) { const h = heat(v, ...rg); return ['td', {style: `background:${h.bg};color:${h.fg}`}, Calc.fmt(v)]; }
      return ['td', s ? {style: `background:${s.color};color:#fff`} : {}, s ? s.name.slice(0, 4) : ''];
    })]);
    return ['div', {'data-plate': JSON.stringify(a), class: 'plate-print'}, ['p', {}, `Platte ${a.format}${a.title ? ' – ' + a.title : ''}: ${plateSummary(a)}${plateStats(a) ? ` · Messwerte${a.vlabel ? ' ' + a.vlabel : ''}: ${plateStats(a)}` : ''}`],
      ['table', {class: 'platetab'}, head, ...body]];
  },
  renderText: ({node}) => `Platte ${node.attrs.format}${node.attrs.title ? ' – ' + node.attrs.title : ''}: ${plateSummary(node.attrs)}${plateStats(node.attrs) ? ` · Messwerte: ${plateStats(node.attrs)}` : ''}`,
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node, sel = 0, painting = null;
    const dom = document.createElement('div');
    dom.className = 'plate'; dom.contentEditable = 'false';
    const set = attrs => { const pos = getPos(); if (typeof pos == 'number' && editor.isEditable) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, ...attrs})); };
    function render() {
      const a = cur.attrs, ro = !editor.isEditable, [rows, cols] = PLATE_FORMATS[a.format] || PLATE_FORMATS[96];
      const counts = a.samples.map((_, i) => Object.values(a.wells).filter(v => v == i).length);
      dom.innerHTML = `<div class="phead">🧫 <input data-ptitle value="${esc(a.title)}" placeholder="Platte ${a.format}" ${ro ? 'disabled' : ''}>
          ${ro ? '' : `<select data-pformat>${Object.keys(PLATE_FORMATS).map(f => `<option value="${f}" ${f == a.format ? 'selected' : ''}>${f} Wells</option>`).join('')}</select>
          <button class="btn" data-pclear>Leeren</button><button class="btn" data-pimport>📥 Messwerte</button>`}
          ${Object.keys(a.values || {}).length ? `<span class="pviews"><button class="btn ${a.view != 'values' ? 'on' : ''}" data-pview="layout">Belegung</button><button class="btn ${a.view == 'values' ? 'on' : ''}" data-pview="values">Messwerte</button></span>` : ''}</div>
        <div class="pbody"><table class="pgrid f${a.format}"><tr><th></th>${[...Array(cols)].map((_, c) => `<th>${c + 1}</th>`).join('')}</tr>
          ${[...Array(rows)].map((_, r) => `<tr><th>${String.fromCharCode(65 + r)}</th>${[...Array(cols)].map((_, c) => { const w = wellName(r, c), i = a.wells[w];
            const v = a.values?.[w], h = a.view == 'values' && v != null ? heat(v, ...plateRange(a)) : null;
            return `<td data-well="${w}" title="${w}${i != null ? ': ' + esc(a.samples[i]?.name) : ''}${v != null ? ` · ${Calc.fmt(v)}` : ''}" style="${h ? `background:${h.bg};color:${h.fg}` : i != null ? `background:${a.samples[i]?.color}` : ''}">${h && a.format == 96 ? `<span class="pv">${Calc.fmt(v)}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}</table>
        <div class="plegend">${a.samples.map((s, i) => `<div class="ps ${i == sel && !ro ? 'on' : ''}" data-psel="${i}"><span class="sw" style="background:${s.color}"></span>
            ${ro ? `<span>${esc(s.name)}</span>` : `<input data-pname="${i}" value="${esc(s.name)}">`}<small>${counts[i]}</small>${ro ? '' : `<button class="x" data-pdel="${i}" title="Probe entfernen">×</button>`}</div>`).join('')}
          ${ro ? '' : `<div class="ps ${sel == -1 ? 'on' : ''}" data-psel="-1"><span class="sw erase"></span>Radiergummi</div><button class="btn" data-padd>+ Probe</button>`}
          <p class="sub">${ro ? '' : 'Probe wählen, dann Wells anklicken oder darüber ziehen.'}</p></div></div>
        ${a.view == 'values' && plateRange(a) ? `<div class="pscale"><span>${Calc.fmt(plateRange(a)[0])}</span><i></i><span>${Calc.fmt(plateRange(a)[1])}</span>${a.vlabel ? `<span class="sub">${esc(a.vlabel)}</span>` : ''}</div>` : ''}
        <div class="psum">${esc(plateSummary(a)) || '<span class="sub">noch leer</span>'}${plateStats(a) ? `<br><b>Messwerte${a.vlabel ? ' ' + esc(a.vlabel) : ''}:</b> ${esc(plateStats(a))}` : ''}</div>`;
    }
    const paint = (w, mode) => {
      const wells = {...cur.attrs.wells};
      if (mode == 'erase' || sel == -1) delete wells[w]; else wells[w] = sel;
      cur = cur.type.create({...cur.attrs, wells});  // sofort zeigen, übernommen wird beim Loslassen
      const td = dom.querySelector(`[data-well="${w}"]`), s = cur.attrs.samples[wells[w]];
      if (td) td.style.background = s ? s.color : '';
    };
    dom.addEventListener('mousedown', e => {
      const w = e.target.dataset?.well;
      if (!w || !editor.isEditable || (!cur.attrs.samples.length && sel != -1)) return;
      e.preventDefault();
      painting = sel == -1 || cur.attrs.wells[w] == sel ? 'erase' : 'paint';
      paint(w, painting);
    });
    dom.addEventListener('mouseover', e => { const w = e.target.dataset?.well; if (painting && w) paint(w, painting); });
    const stop = () => { if (painting) { painting = null; set({wells: cur.attrs.wells}); } };
    document.addEventListener('mouseup', stop);
    dom.addEventListener('click', e => {
      const d = e.target.dataset;
      if (!editor.isEditable) return;
      if (d.psel != null && !e.target.closest('input,button')) { sel = +d.psel; render(); }
      if (d.padd !== undefined) {
        const samples = [...cur.attrs.samples, {name: `Probe ${cur.attrs.samples.length + 1}`, color: PLATE_COLORS[cur.attrs.samples.length % PLATE_COLORS.length]}];
        sel = samples.length - 1; set({samples});
      }
      if (d.pdel != null) {
        const i = +d.pdel, samples = cur.attrs.samples.filter((_, k) => k != i), wells = {};
        for (const [w, v] of Object.entries(cur.attrs.wells)) if (v != i) wells[w] = v > i ? v - 1 : v;
        sel = 0; set({samples, wells});
      }
      if (d.pclear !== undefined && confirm('Alle Wells leeren?')) set({wells: {}});
      if (d.pview) set({view: d.pview});
      if (d.pimport !== undefined) pickDeviceFile({apply: (text, name) => {
        const p = DevFiles.parsePlate(text);
        if (p.format != cur.attrs.format && !confirm(`Die Datei hat das Format ${p.format}, die Platte ${cur.attrs.format}. Trotzdem übernehmen?`)) return;
        set({values: p.values, vlabel: p.label || name.replace(/\.[^.]+$/, ''), view: 'values'});
        status(`${Object.keys(p.values).length} Messwerte aus ${name} übernommen`);
      }});
    });
    dom.addEventListener('change', e => {
      const d = e.target.dataset;
      if (d.pformat != null) {
        if (Object.keys(cur.attrs.wells).length && !confirm('Format ändern? Wells außerhalb des neuen Formats gehen verloren.')) return render();
        const [rows, cols] = PLATE_FORMATS[e.target.value], wells = {};
        for (const [w, v] of Object.entries(cur.attrs.wells)) if (w.charCodeAt(0) - 65 < rows && +w.slice(1) <= cols) wells[w] = v;
        set({format: +e.target.value, wells});
      }
      if (d.ptitle != null) set({title: e.target.value});
      if (d.pname != null) { const samples = cur.attrs.samples.map((s, i) => i == +d.pname ? {...s, name: e.target.value.trim() || s.name} : s); set({samples}); }
    });
    render();
    return {dom, update: n => { if (n.type.name != 'plate') return false; const ch = JSON.stringify(n.attrs) != JSON.stringify(cur.attrs); cur = n; if (ch && !painting) render(); return true; },
      stopEvent: e => !!e.target.closest?.('input, select, button, td[data-well], .ps'), ignoreMutation: () => true,
      destroy: () => document.removeEventListener('mouseup', stop)};
  },
});

function insertPlate(format = 96) {
  editor.chain().focus().insertContent([{type: 'plate', attrs: {format, samples: [{name: 'Probe 1', color: PLATE_COLORS[0]}], wells: {}}}, {type: 'paragraph'}]).run();
}
