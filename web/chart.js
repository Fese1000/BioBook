// Block „📈 Diagramm“ im Eintrag: Standardkurve (Regression, unbekannte Proben), Gruppenvergleich (Mittelwert ± SD, t-Test)
// oder x/y-Punkte. Daten werden eingefügt (aus Excel mit Tabulator) oder aus der Tabelle darüber übernommen.
// Gerechnet wird mit web/stats.js; im Export steht das Diagramm als SVG mit Ergebnistabelle.
'use strict';

const CHART_MODES = {curve: 'Standardkurve', groups: 'Gruppen vergleichen', xy: 'x/y-Punkte'};
const fmtN = v => v == null || !Number.isFinite(v) ? '–' : Calc.fmt(v);

/// Alles, was der Block anzeigt, aus den Attributen berechnen (auch für Text und Export)
function chartModel(a) {
  try {
    if (a.mode == 'curve') {
      const std = Stats.parseTable(a.std).map(r => [Stats.num(r[0]), Stats.num(r[1])]).filter(([x, y]) => x != null && y != null);
      const fit = Stats.linreg(std);
      const samples = Stats.parseTable(a.samples).map(r => {
        const name = Stats.num(r[0]) == null ? r[0] : '', vals = name ? r.slice(1) : r, y = Stats.num(vals[0]), dil = Stats.num(vals[1]) ?? 1;
        const inv = Stats.inverse(fit, y);
        return {name: name || `Probe`, y, dil, x: inv ? inv.x * dil : null, raw: inv?.x ?? null, extrapolated: inv?.extrapolated};
      }).filter(s => s.y != null);
      return {mode: 'curve', std, fit, samples};
    }
    if (a.mode == 'groups') {
      const gs = Stats.groups(Stats.parseTable(a.data)).filter(g => g.n);
      let test = null;
      if (gs.length >= 2 && gs[0].n >= 2 && gs[1].n >= 2) test = Stats.tTest(gs[0].values, gs[1].values, a.test || 'welch');
      return {mode: 'groups', groups: gs, test};
    }
    const pts = Stats.parseTable(a.data).map(r => [Stats.num(r[0]), Stats.num(r[1])]).filter(([x, y]) => x != null && y != null);
    return {mode: 'xy', pts, fit: a.fitline && pts.length >= 2 ? Stats.linreg(pts) : null};
  } catch (e) { return {mode: a.mode, error: e.message}; }
}

function chartSummary(a) {
  const m = chartModel(a), unit = a.unit ? ` ${a.unit}` : '';
  if (m.error) return `${a.title || CHART_MODES[a.mode]}: ${m.error}`;
  if (m.mode == 'curve') return `${a.title || 'Standardkurve'}: y = ${fmtN(m.fit.slope)}·x ${m.fit.intercept < 0 ? '−' : '+'} ${fmtN(Math.abs(m.fit.intercept))}, R² = ${m.fit.r2.toFixed(4).replace('.', ',')}`
    + (m.samples.length ? '; ' + m.samples.map(s => `${s.name}: ${fmtN(s.x)}${unit}${s.extrapolated ? ' (außerhalb der Standards)' : ''}`).join('; ') : '');
  if (m.mode == 'groups') return `${a.title || 'Gruppenvergleich'}: ` + m.groups.map(g => `${g.name} ${fmtN(g.mean)} ± ${fmtN(g.sd)}${unit} (n = ${g.n})`).join('; ')
    + (m.test ? `; t-Test (${m.test.type == 'welch' ? 'Welch' : m.test.type == 'paired' ? 'gepaart' : 'Student'}): ${Stats.pText(m.test.p)}` : '');
  return `${a.title || 'Diagramm'}: ${m.pts.length} Punkte` + (m.fit ? `, y = ${fmtN(m.fit.slope)}·x + ${fmtN(m.fit.intercept)}, R² = ${m.fit.r2.toFixed(4).replace('.', ',')}` : '');
}

/// Achsenrahmen; liefert Skalen und SVG-Teile (Raster zurückhaltend, eine y-Achse)
function chartFrame({xmin, xmax, ymin, ymax, W = 560, H = 280, xlabel = '', ylabel = '', cats = null}) {
  const L = 56, R = 16, T = 12, B = 42;
  const yt = niceTicks(ymin, ymax, 5), y0 = yt[0], y1 = yt[yt.length - 1];
  const xt = cats ? null : niceTicks(xmin, xmax, 6), x0 = cats ? 0 : xt[0], x1 = cats ? cats.length : xt[xt.length - 1];
  const sx = v => L + (v - x0) / (x1 - x0 || 1) * (W - L - R), sy = v => H - B - (v - y0) / (y1 - y0 || 1) * (H - T - B);
  const parts = `${yt.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 6}" y="${sy(v) + 4}" text-anchor="end">${fmtN(v)}</text>`).join('')}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
    ${cats ? cats.map((c, i) => `<text class="tick" x="${sx(i + 0.5)}" y="${H - B + 16}" text-anchor="middle">${esc(c.length > 16 ? c.slice(0, 15) + '…' : c)}</text>`).join('')
      : xt.map(v => `<text class="tick" x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${fmtN(v)}</text>`).join('')}
    ${xlabel ? `<text class="tick" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(xlabel)}</text>` : ''}
    ${ylabel ? `<text class="tick" transform="translate(13 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(ylabel)}</text>` : ''}`;
  return {sx, sy, parts, W, H, L, R, T, B, y0};
}

function blockChartSVG(a, m = chartModel(a)) {
  if (m.error) return '';
  const svg = (f, body, label) => `<svg class="chart" viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(label)}">${f.parts}${body}</svg>`;
  if (m.mode == 'curve') {
    const xs = [...m.std.map(p => p[0]), ...m.samples.filter(s => s.raw != null).map(s => s.raw)], ys = [...m.std.map(p => p[1]), ...m.samples.map(s => s.y)];
    const f = chartFrame({xmin: Math.min(0, ...xs), xmax: Math.max(...xs), ymin: Math.min(0, ...ys), ymax: Math.max(...ys), xlabel: a.xlabel || 'Konzentration', ylabel: a.ylabel || 'Messwert'});
    const xa = Math.min(0, ...xs), xb = Math.max(...xs);
    const line = `<line class="line" x1="${f.sx(xa)}" y1="${f.sy(m.fit.slope * xa + m.fit.intercept)}" x2="${f.sx(xb)}" y2="${f.sy(m.fit.slope * xb + m.fit.intercept)}"/>`;
    const std = m.std.map(([x, y]) => `<circle class="pt" r="4.5" cx="${f.sx(x)}" cy="${f.sy(y)}"><title>Standard ${fmtN(x)} → ${fmtN(y)}</title></circle>`).join('');
    const smp = m.samples.filter(s => s.raw != null).map(s => { const cx = f.sx(s.raw), cy = f.sy(s.y);
      return `<line class="drop" x1="${cx}" x2="${cx}" y1="${cy}" y2="${f.H - f.B}"/><path class="smp" d="M${cx},${cy - 6} L${cx + 6},${cy} L${cx},${cy + 6} L${cx - 6},${cy} Z"><title>${esc(s.name)}: ${fmtN(s.y)} → ${fmtN(s.raw)}${s.dil != 1 ? ` × ${fmtN(s.dil)} = ${fmtN(s.x)}` : ''}</title></path>`; }).join('');
    return svg(f, line + std + smp, `Standardkurve mit ${m.std.length} Standards und ${m.samples.length} Proben`);
  }
  if (m.mode == 'groups') {
    const tops = m.groups.map(g => Math.max(g.mean + (g.sd || 0), ...g.values)), ymax = Math.max(...tops) * (m.test ? 1.18 : 1.05);
    const f = chartFrame({ymin: Math.min(0, ...m.groups.flatMap(g => g.values)), ymax, cats: m.groups.map(g => g.name), ylabel: a.ylabel || (a.unit ? a.unit : '')});
    const bw = Math.min(56, (f.W - f.L - f.R) / m.groups.length * 0.5);
    const body = m.groups.map((g, i) => {
      const cx = f.sx(i + 0.5), top = f.sy(g.mean), base = f.sy(Math.max(0, f.y0)), h = Math.max(0, base - top);
      const bar = `<path class="bar" d="M${cx - bw / 2},${base} L${cx - bw / 2},${top + Math.min(4, h)} Q${cx - bw / 2},${top} ${cx - bw / 2 + Math.min(4, h)},${top} L${cx + bw / 2 - Math.min(4, h)},${top} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + Math.min(4, h)} L${cx + bw / 2},${base} Z"><title>${esc(g.name)}: ${fmtN(g.mean)} ± ${fmtN(g.sd)} (n = ${g.n})</title></path>`;
      const err = g.sd ? `<path class="err" d="M${cx},${f.sy(g.mean - g.sd)} V${f.sy(g.mean + g.sd)} M${cx - 7},${f.sy(g.mean + g.sd)} H${cx + 7} M${cx - 7},${f.sy(g.mean - g.sd)} H${cx + 7}"/>` : '';
      const dots = g.values.map((v, j) => `<circle class="dot" r="3" cx="${cx + ((j % 5) - 2) * 5}" cy="${f.sy(v)}"><title>${fmtN(v)}</title></circle>`).join('');
      return bar + err + dots;
    }).join('');
    let brk = '';
    if (m.test) {
      const y = f.sy(Math.max(tops[0], tops[1]) * 1.07), x1 = f.sx(0.5), x2 = f.sx(1.5);
      brk = `<path class="err" d="M${x1},${y + 6} V${y} H${x2} V${y + 6}"/><text class="tick sig" x="${(x1 + x2) / 2}" y="${y - 5}" text-anchor="middle">${Stats.stars(m.test.p)} (${Stats.pText(m.test.p)})</text>`;
    }
    return svg(f, body + brk, `Mittelwerte von ${m.groups.length} Gruppen mit Standardabweichung`);
  }
  if (!m.pts.length) return '';
  const xs = m.pts.map(p => p[0]), ys = m.pts.map(p => p[1]);
  const f = chartFrame({xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(0, ...ys), ymax: Math.max(...ys), xlabel: a.xlabel, ylabel: a.ylabel});
  const sorted = [...m.pts].sort((p, q) => p[0] - q[0]);
  const conn = a.connect ? `<polyline class="line" points="${sorted.map(([x, y]) => `${f.sx(x)},${f.sy(y)}`).join(' ')}"/>` : '';
  const fit = m.fit ? `<line class="line fit" x1="${f.sx(sorted[0][0])}" y1="${f.sy(m.fit.slope * sorted[0][0] + m.fit.intercept)}" x2="${f.sx(sorted.at(-1)[0])}" y2="${f.sy(m.fit.slope * sorted.at(-1)[0] + m.fit.intercept)}"/>` : '';
  return svg(f, conn + fit + m.pts.map(([x, y]) => `<circle class="pt" r="4" cx="${f.sx(x)}" cy="${f.sy(y)}"><title>${fmtN(x)} / ${fmtN(y)}</title></circle>`).join(''), `${m.pts.length} Punkte`);
}

/// Ergebnistabelle (auch die Tabellenansicht des Diagramms)
function chartTable(a, m = chartModel(a)) {
  const u = a.unit ? ` (${esc(a.unit)})` : '';
  if (m.error) return `<p class="bad">${esc(m.error)}</p>`;
  if (m.mode == 'curve') return `<p class="sub">y = ${fmtN(m.fit.slope)}·x ${m.fit.intercept < 0 ? '−' : '+'} ${fmtN(Math.abs(m.fit.intercept))} · R² = ${m.fit.r2.toFixed(4).replace('.', ',')} · ${m.fit.n} Standards</p>
    ${m.samples.length ? `<table class="ctab"><tr><th>Probe</th><th>Messwert</th><th>aus Kurve</th><th>Verdünnung</th><th>Ergebnis${u}</th></tr>${m.samples.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${fmtN(s.y)}</td>
      <td class="num">${fmtN(s.raw)}</td><td class="num">${s.dil != 1 ? '× ' + fmtN(s.dil) : ''}</td><td class="num"><b>${fmtN(s.x)}</b>${s.extrapolated ? ' <span class="wbadge warn">außerhalb</span>' : ''}</td></tr>`).join('')}</table>` : ''}`;
  if (m.mode == 'groups') return `<table class="ctab"><tr><th>Gruppe</th><th>n</th><th>Mittelwert${u}</th><th>SD</th></tr>${m.groups.map(g => `<tr><td>${esc(g.name)}</td><td class="num">${g.n}</td><td class="num">${fmtN(g.mean)}</td><td class="num">${fmtN(g.sd)}</td></tr>`).join('')}</table>
    ${m.test ? `<p class="sub">${esc(m.groups[0].name)} gegen ${esc(m.groups[1].name)}: t = ${fmtN(m.test.t)}, df = ${fmtN(m.test.df)}, <b>${Stats.pText(m.test.p)}</b> ${Stats.stars(m.test.p)}</p>` : ''}`;
  return m.fit ? `<p class="sub">y = ${fmtN(m.fit.slope)}·x + ${fmtN(m.fit.intercept)} · R² = ${m.fit.r2.toFixed(4).replace('.', ',')}</p>` : '';
}

/// Zellen der nächsten Tabelle oberhalb des Blocks als Text (Tabulator-getrennt)
function tableAbove(editor, pos) {
  let found = null;
  editor.state.doc.nodesBetween(0, pos, (node, p) => { if (node.type.name == 'table' && p < pos) found = node; });
  if (!found) return null;
  const rows = [];
  found.forEach(row => { const cells = []; row.forEach(cell => cells.push(cell.textContent.trim())); rows.push(cells.join('\t')); });
  return rows.join('\n');
}

const ChartNode = TT.Node.create({
  name: 'chart', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({mode: {default: 'curve'}, title: {default: ''}, xlabel: {default: ''}, ylabel: {default: ''}, unit: {default: ''},
    std: {default: ''}, samples: {default: ''}, data: {default: ''}, test: {default: 'welch'}, connect: {default: false}, fitline: {default: false}}),
  parseHTML: () => [{tag: 'div[data-chart]', getAttrs: el => JSON.parse(el.getAttribute('data-chart') || '{}')}],
  renderHTML: ({node}) => {
    const el = document.createElement('div');
    el.setAttribute('data-chart', JSON.stringify(node.attrs)); el.className = 'chartexport chartbox';
    el.innerHTML = `<div class="charttitle">${esc(node.attrs.title || CHART_MODES[node.attrs.mode])}</div>${blockChartSVG(node.attrs)}${chartTable(node.attrs)}`;
    return el;
  },
  renderText: ({node}) => chartSummary(node.attrs),
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node, draft = {...node.attrs};
    const dom = document.createElement('div');
    dom.className = 'chartblock'; dom.contentEditable = 'false';
    const commit = () => { const pos = getPos(); if (typeof pos == 'number' && JSON.stringify(draft) != JSON.stringify(cur.attrs)) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...draft})); };
    const out = () => { const m = chartModel(draft); dom.querySelector('.chartout').innerHTML = `<div class="chartbox">${blockChartSVG(draft, m) || '<p class="sub">Noch keine Daten.</p>'}</div>${chartTable(draft, m)}`; };
    const ta = (k, ph, rows = 5) => `<label class="cdata"><span>${{std: 'Standards (Konzentration, Messwert)', samples: 'Proben (Name, Messwert, Verdünnung)', data: draft.mode == 'groups' ? 'Werte (erste Zeile: Gruppennamen, je Spalte eine Gruppe)' : 'Punkte (x, y)'}[k]}</span>
      <textarea data-ck="${k}" rows="${rows}" spellcheck="false" placeholder="${esc(ph)}" ${editor.isEditable ? '' : 'readonly'}>${esc(draft[k])}</textarea></label>`;
    function render() {
      const ro = !editor.isEditable, mode = draft.mode;
      dom.innerHTML = `<div class="chead"><span class="ui">📈</span>
          <select data-ck="mode" ${ro ? 'disabled' : ''}>${Object.entries(CHART_MODES).map(([k, t]) => `<option value="${k}" ${k == mode ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <input data-ck="title" value="${esc(draft.title)}" placeholder="Titel, z. B. Bradford 23.10." ${ro ? 'readonly' : ''}>
          <input data-ck="unit" value="${esc(draft.unit)}" placeholder="Einheit" style="width:80px" ${ro ? 'readonly' : ''}>
          ${ro ? '' : '<button class="btn" data-cfrom>aus Tabelle darüber</button>'}</div>
        <div class="cinputs">${mode == 'curve' ? ta('std', '0\t0\n125\t0,095\n250\t0,185', 6) + ta('samples', 'Probe A\t0,400\nProbe B\t0,512\t2', 6)
          : mode == 'groups' ? ta('data', 'Kontrolle\tBehandelt\n5,1\t6,2\n4,9\t6,8', 6) + `<label class="cdata"><span>Test (erste zwei Gruppen)</span><select data-ck="test" ${ro ? 'disabled' : ''}>
              ${[['welch', 't-Test nach Welch'], ['student', 't-Test (gleiche Varianzen)'], ['paired', 't-Test gepaart']].map(([k, t]) => `<option value="${k}" ${k == draft.test ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`
          : ta('data', '0\t1,2\n1\t2,3', 6) + `<label class="cdata"><span>Darstellung</span><span><label><input type="checkbox" data-ck="connect" ${draft.connect ? 'checked' : ''} ${ro ? 'disabled' : ''}> verbinden</label>
              <label><input type="checkbox" data-ck="fitline" ${draft.fitline ? 'checked' : ''} ${ro ? 'disabled' : ''}> Ausgleichsgerade</label></span></label>`}
          ${mode != 'groups' ? `<div class="cdata axes"><input data-ck="xlabel" value="${esc(draft.xlabel)}" placeholder="x-Achse" ${ro ? 'readonly' : ''}><input data-ck="ylabel" value="${esc(draft.ylabel)}" placeholder="y-Achse" ${ro ? 'readonly' : ''}></div>` : ''}</div>
        <div class="chartout"></div>`;
      out();
    }
    dom.addEventListener('input', e => { const k = e.target.dataset.ck; if (!k || e.target.type == 'checkbox') return; draft[k] = e.target.value; out(); });
    dom.addEventListener('change', e => {
      const k = e.target.dataset.ck; if (!k) return;
      draft[k] = e.target.type == 'checkbox' ? e.target.checked : e.target.value;
      if (k == 'mode') render(); else out();
      commit();
    });
    dom.addEventListener('focusout', e => { if (!dom.contains(e.relatedTarget)) commit(); });
    dom.addEventListener('click', e => {
      if (e.target.dataset.cfrom === undefined) return;
      const t = tableAbove(editor, getPos());
      if (!t) return alert('Oberhalb des Diagramms steht keine Tabelle.');
      if (draft.mode == 'curve') draft.std = t; else draft.data = t;
      render(); commit();
    });
    render();
    return {dom, update: n => {
      if (n.type.name != 'chart') return false;
      cur = n;
      if (JSON.stringify(n.attrs) != JSON.stringify(draft) && !dom.contains(document.activeElement)) { draft = {...n.attrs}; render(); }
      return true;
    }, stopEvent: e => !!e.target.closest?.('input, select, textarea, button'), ignoreMutation: () => true};
  },
});

function insertChart(mode = 'curve') { editor.chain().focus().insertContent([{type: 'chart', attrs: {mode}}, {type: 'paragraph'}]).run(); }
