// Sequenz-Ansicht: Karte (Ring oder linear) mit Features und Motiv-Treffern, Basen mit Übersetzung, ORF-Suche, Import/Export.
// Am Registry-Objekt unter dem Formular und als Block „🧬 Sequenz“ im Eintrag.
'use strict';

const FEAT_COLORS = {CDS: '#2a78d6', gene: '#2a78d6', ORF: '#7fb0e8', promoter: '#3a8f5c', rep_origin: '#d9822b', terminator: '#c0392b',
  primer_bind: '#8e5bd0', protein_bind: '#8e5bd0', RBS: '#3a8f5c', misc_feature: '#8a8a8a'};
const featColor = f => f.color || FEAT_COLORS[f.type] || '#8a8a8a';
const SEQ_PENDING = {};  // Feld → Anmerkung aus einem Import, wird beim Speichern des Objekts übernommen
const bp = n => `${n.toLocaleString('de-DE')} bp`;

function niceStep(len, target = 8) {
  const raw = len / target, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || p * 10;
}

/// Spuren vergeben, damit sich Features nicht überdecken (je Strang getrennt)
function lanes(features, len) {
  const out = features.map(f => ({...f})), taken = {1: [], '-1': []};
  const span = f => f.end >= f.start ? [[f.start, f.end]] : [[f.start, len], [1, f.end]];
  for (const f of out.sort((a, b) => a.start - b.start)) {
    const t = taken[f.strand == -1 ? '-1' : 1];
    let lane = 0;
    while ((t[lane] || []).some(([a, b]) => span(f).some(([c, d]) => c <= b && a <= d))) lane++;
    (t[lane] ||= []).push(...span(f));
    f.lane = lane;
  }
  return out;
}

/// Ringkarte als SVG
function ringMap({seq, name, features = [], hits = [], size = 380}) {
  const n = seq.length, c = size / 2, R = size * 0.3;
  const ang = p => (p - 1) / n * 2 * Math.PI - Math.PI / 2;
  const pt = (a, r) => [c + r * Math.cos(a), c + r * Math.sin(a)].map(v => v.toFixed(1)).join(',');
  const fs = lanes(features, n);
  const arc = f => {
    const r0 = f.strand == -1 ? R - 8 - f.lane * 11 : R + 8 + f.lane * 11, w = 4;
    let a0 = ang(f.start), a1 = ang(f.end + 1);
    if (a1 <= a0) a1 += 2 * Math.PI;
    const tip = Math.min(0.09, (a1 - a0) / 2);
    const large = (a1 - a0 - tip) > Math.PI ? 1 : 0;
    const [ri, ro] = [r0 - w, r0 + w];
    let d;
    if (f.strand == -1) d = `M${pt(a0 + tip, ro)} A${ro},${ro} 0 ${large} 1 ${pt(a1, ro)} L${pt(a1, ri)} A${ri},${ri} 0 ${large} 0 ${pt(a0 + tip, ri)} L${pt(a0, r0)} Z`;
    else d = `M${pt(a0, ro)} A${ro},${ro} 0 ${large} 1 ${pt(a1 - tip, ro)} L${pt(a1, r0)} L${pt(a1 - tip, ri)} A${ri},${ri} 0 ${large} 0 ${pt(a0, ri)} Z`;
    return `<path d="${d}" fill="${featColor(f)}" stroke="var(--bg)" stroke-width="1.5"><title>${esc(`${f.label || f.type} (${f.type}) ${f.start}–${f.end}, ${f.strand == -1 ? '−' : '+'}`)}</title></path>`;
  };
  // Beschriftungen außen, je Seite von oben nach unten ohne Überlappung
  const labels = fs.map(f => { let a0 = ang(f.start), a1 = ang(f.end + 1); if (a1 <= a0) a1 += 2 * Math.PI; const a = (a0 + a1) / 2; return {f, a, x: Math.cos(a), y: c + (R + 60) * Math.sin(a)}; });
  for (const side of [1, -1]) {
    const ls = labels.filter(l => Math.sign(l.x || 1) == side).sort((p, q) => p.y - q.y);
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 13) ls[i].y = ls[i - 1].y + 13;
  }
  const lab = l => {
    const r = R + 8 + (l.f.lane + 1) * 11 + 2, side = Math.cos(l.a) >= 0 ? 1 : -1, lx = c + side * (R + 70);
    return `<path d="M${pt(l.a, r)} L${(c + (R + 58) * Math.cos(l.a)).toFixed(1)},${l.y.toFixed(1)} L${lx.toFixed(1)},${l.y.toFixed(1)}" class="lead"/>
      <text x="${(lx + side * 3).toFixed(1)}" y="${(l.y + 4).toFixed(1)}" text-anchor="${side > 0 ? 'start' : 'end'}" class="flab">${esc(l.f.label || l.f.type)}</text>`;
  };
  const step = niceStep(n);
  const ticks = [];
  for (let p = step; p < n; p += step) ticks.push(p);
  return `<svg class="seqmap ring" viewBox="${-60} 0 ${size + 120} ${size}" role="img" aria-label="${esc(`Karte von ${name}, ${n} bp`)}">
    <circle cx="${c}" cy="${c}" r="${R}" class="bb"/>
    ${ticks.map(p => `<path d="M${pt(ang(p), R - 3)} L${pt(ang(p), R + 3)}" class="tick"/><text x="${pt(ang(p), R - 16).split(',')[0]}" y="${(+pt(ang(p), R - 16).split(',')[1] + 3).toFixed(1)}" text-anchor="middle" class="tl">${p}</text>`).join('')}
    ${fs.map(arc).join('')}
    ${hits.map(h => `<path d="M${pt(ang(h.start), R - 5)} L${pt(ang(h.start), R + 5)}" class="hit"><title>${esc(`${h.label || 'Treffer'} bei ${h.start}`)}</title></path>`).join('')}
    ${labels.map(lab).join('')}
    <text x="${c}" y="${c - 4}" text-anchor="middle" class="cname">${esc(name)}</text><text x="${c}" y="${c + 14}" text-anchor="middle" class="tl">${bp(n)}</text>
  </svg>`;
}

/// Lineare Karte als SVG
function lineMap({seq, name, features = [], hits = [], width = 760}) {
  const n = seq.length, L = 10, W = width - 20;
  const fs = lanes(features, n);
  const up = Math.max(0, ...fs.filter(f => f.strand != -1).map(f => f.lane + 1)), down = Math.max(0, ...fs.filter(f => f.strand == -1).map(f => f.lane + 1));
  const y0 = 22 + up * 26, H = y0 + 30 + down * 26;
  const x = p => L + (p - 1) / Math.max(1, n - 1) * W;
  const arrow = f => {
    const y = f.strand == -1 ? y0 + 16 + f.lane * 26 : y0 - 16 - f.lane * 26, a = x(f.start), b = x(f.end), tip = Math.min(8, (b - a) / 2);
    const d = f.strand == -1 ? `M${a},${y} L${a + tip},${y - 6} L${b},${y - 6} L${b},${y + 6} L${a + tip},${y + 6} Z` : `M${a},${y - 6} L${b - tip},${y - 6} L${b},${y} L${b - tip},${y + 6} L${a},${y + 6} Z`;
    return `<path d="${d}" fill="${featColor(f)}" stroke="var(--bg)" stroke-width="1"><title>${esc(`${f.label || f.type} (${f.type}) ${f.start}–${f.end}`)}</title></path>
      <text x="${((a + b) / 2).toFixed(1)}" y="${f.strand == -1 ? y + 18 : y - 9}" text-anchor="middle" class="flab">${esc(f.label || f.type)}</text>`;
  };
  const step = niceStep(n, 10), ticks = [];
  for (let p = step; p < n; p += step) ticks.push(p);
  return `<svg class="seqmap line" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(`Karte von ${name}, ${n} bp`)}">
    <line x1="${L}" x2="${L + W}" y1="${y0}" y2="${y0}" class="bb"/>
    ${ticks.map(p => `<line x1="${x(p)}" x2="${x(p)}" y1="${y0 - 3}" y2="${y0 + 3}" class="tick"/><text x="${x(p)}" y="${y0 + (down ? -6 : 16)}" text-anchor="middle" class="tl">${p}</text>`).join('')}
    ${fs.filter(f => f.end >= f.start).map(arrow).join('')}
    ${hits.map(h => `<line x1="${x(h.start)}" x2="${x(h.start)}" y1="${y0 - 6}" y2="${y0 + 6}" class="hit"><title>${esc(`${h.label || 'Treffer'} bei ${h.start}`)}</title></line>`).join('')}
  </svg>`;
}

/// Basen in Zeilen zu 60 mit Positionen; Treffer markiert; optional Übersetzung (Rahmen 1–3, oberer Strang)
function seqText(seq, {hits = [], frame = 0} = {}) {
  const n = seq.length, mark = new Uint8Array(n);
  for (const h of hits) for (let i = 0, p = h.start - 1; i < (h.len || 1); i++) mark[(p + i) % n] = 1;
  const lines = [];
  for (let i = 0; i < n; i += 60) {
    const part = seq.slice(i, i + 60);
    let html = '', run = '', on = 0;
    for (let j = 0; j < part.length; j++) {
      const m = mark[i + j];
      if (m != on) { html += on ? `<mark>${run}</mark>` : run; run = ''; on = m; }
      run += part[j];
    }
    html += on ? `<mark>${run}</mark>` : run;
    let tr = '';
    if (frame) {
      const f = frame - 1;
      for (let j = 0; j < part.length; j++) {
        const p = i + j;
        tr += (p - f) % 3 == 0 && p >= f && p + 3 <= n ? Bio.codon(seq.slice(p, p + 3)) : ' ';
      }
      tr = `\n${' '.repeat(7)}<span class="aa">${esc(tr)}</span>`;
    }
    lines.push(`<span class="pos">${String(i + 1).padStart(6)}</span> ${html}${tr}`);
  }
  return lines.join('\n');
}

// ---------- Panel am Registry-Objekt ----------
const SEQ_STATE = new WeakMap();

async function renderSeqPanel(el) {
  const entity = +el.dataset.seqent, field = el.dataset.seqfield;
  const e = await call('entity', {id: entity});
  const seq = parseJSON(e.fields_json, {})[field] || '';
  const ann = await call('seqAnnotation', {entity, field});
  const st = SEQ_STATE.get(el) || {motif: '', frame: 0, orfs: null, rc: false};
  Object.assign(st, {entity, field, seq, ann, name: e.name, code: e.code});
  SEQ_STATE.set(el, st);
  drawSeqPanel(el);
}

function drawSeqPanel(el) {
  const st = SEQ_STATE.get(el), {seq, ann} = st;
  const shown = st.rc ? Bio.revcomp(seq) : seq;
  let hits = [], motifErr = '';
  if (st.motif) { try { hits = Bio.findMotif(shown, st.motif, {circular: ann.circular}).map(h => ({...h, len: Bio.clean(st.motif).length, label: st.motif.toUpperCase()})); } catch (err) { motifErr = err.message; } }
  const feats = st.rc ? [] : [...ann.features, ...(st.orfs || []).map(o => ({...o, type: 'ORF', label: `ORF ${o.aa} aa`, orf: true}))];
  const map = (ann.circular ? ringMap : lineMap)({seq: shown, name: st.name, features: feats, hits});
  el.innerHTML = `<div class="seqbar"><b>🧬 ${esc(st.code)} ${esc(st.name)}</b><span class="sub">${bp(seq.length)} · ${ann.circular ? 'ringförmig' : 'linear'} · GC ${Calc.fmt(Bio.gc(seq))} % · ${ann.features.length} Feature(s)${ann.source ? ` · aus ${esc(ann.source)}` : ''}</span>
      ${ann.stale ? '<span class="wbadge warn" title="Die Sequenz wurde nach dem Import geändert">Features veraltet</span>' : ''}</div>
    <div class="seqtools"><label><input type="checkbox" data-svcirc ${ann.circular ? 'checked' : ''}> ringförmig</label>
      <input data-svmotif value="${esc(st.motif)}" placeholder="Motiv, z. B. GAATTC" autocomplete="off" spellcheck="false">
      <span class="sub" data-svhits>${st.motif ? (motifErr || `${hits.length} Treffer${hits.length && hits.length <= 6 ? ': ' + hits.map(h => `${h.start}${h.strand == -1 ? ' (−)' : ''}`).join(', ') : ''}`) : ''}</span>
      <button class="btn ${st.orfs ? 'on' : ''}" data-svorf>ORFs ≥ 100 aa</button>
      <select data-svframe><option value="0">ohne Übersetzung</option>${[1, 2, 3].map(f => `<option value="${f}" ${st.frame == f ? 'selected' : ''}>Rahmen +${f}</option>`).join('')}</select>
      <button class="btn ${st.rc ? 'on' : ''}" data-svrc>Revers-Komplement</button>
      <button class="btn" data-svexp="fasta">FASTA</button><button class="btn" data-svexp="gb">GenBank</button></div>
    <div class="seqmapbox">${map}</div>
    ${feats.length ? `<table class="feattab"><tr><th></th><th>Name</th><th>Typ</th><th>Bereich</th><th>Strang</th><th>Länge</th><th></th></tr>
      ${feats.map((f, i) => `<tr><td><span class="sw" style="background:${featColor(f)}"></span></td><td>${esc(f.label || '')}</td><td>${esc(f.type)}</td><td class="num">${f.start}–${f.end}</td>
        <td>${f.strand == -1 ? '−' : '+'}</td><td class="num">${bp(f.end >= f.start ? f.end - f.start + 1 : seq.length - f.start + 1 + f.end)}</td>
        <td>${f.orf ? `<button class="btn" data-svkeep="${i - ann.features.length}">übernehmen</button>` : `<button class="x" data-svdel="${i}" title="Feature entfernen">×</button>`}</td></tr>`).join('')}</table>` : ''}
    <pre class="seqtext">${seqText(shown, {hits, frame: st.frame})}</pre>`;
}

async function saveAnn(el, patch) {
  const st = SEQ_STATE.get(el);
  const a = {circular: st.ann.circular, features: st.ann.features, source: st.ann.source || '', ...patch};
  try { st.ann = await call('setSeqAnnotation', {entity: st.entity, field: st.field, ...a}); } catch (err) { return alert(err.message); }
  drawSeqPanel(el);
}

async function exportSeq(el, kind) {
  const st = SEQ_STATE.get(el);
  const text = kind == 'gb' ? Bio.toGenBank({name: st.code, description: st.name, seq: st.seq, circular: st.ann.circular, features: st.ann.features}) : Bio.toFasta(`${st.code} ${st.name}`, st.seq);
  const r = await call('saveText', {name: `${st.code} ${st.name}.${kind == 'gb' ? 'gb' : 'fasta'}`.replace(/[/:]/g, '-'), text});
  if (r) status(`Gespeichert: ${r.path}`);
  return r;
}

/// Datei-Inhalt ins Formular übernehmen (Sequenz, ggf. Name); Ring und Features warten bis zum Speichern
function importSeqText(field, text, filename) {
  const recs = Bio.parseAny(text), r = recs[0];
  const ta = document.querySelector(`#entform [data-field="${field}"]`);
  ta.value = r.seq; ta.dispatchEvent(new Event('input', {bubbles: true}));
  const nm = document.querySelector('#entform [data-name]');
  if (!nm.value.trim()) nm.value = r.name;
  const size = document.querySelector('#entform [data-field="size"]');
  if (size && !size.value.trim()) size.value = r.seq.length;
  SEQ_PENDING[field] = {circular: r.circular, features: r.features, source: filename};
  const note = ta.parentElement.querySelector('.seqnote') || ta.parentElement.appendChild(Object.assign(document.createElement('div'), {className: 'sub seqnote'}));
  note.textContent = `Aus ${filename}: ${bp(r.seq.length)}, ${r.circular ? 'ringförmig' : 'linear'}, ${r.features.length} Feature(s)${recs.length > 1 ? ` (erster von ${recs.length} Einträgen)` : ''} – wird beim Speichern übernommen.`;
  return r;
}

async function savePendingSeq(entityId) {
  for (const [field, a] of Object.entries(SEQ_PENDING)) {
    await call('setSeqAnnotation', {entity: entityId, field, ...a});
    delete SEQ_PENDING[field];
  }
}

// ---------- Block im Eintrag ----------
const SequenceNode = TT.Node.create({
  name: 'seqref', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({entity: {default: null}, field: {default: 'sequence'}, label: {default: ''}, length: {default: null}}),
  parseHTML: () => [{tag: 'div[data-seqref]', getAttrs: el => JSON.parse(el.getAttribute('data-seqref') || '{}')}],
  renderHTML: ({node}) => ['div', {'data-seqref': JSON.stringify(node.attrs)}, seqRefText(node.attrs)],
  renderText: ({node}) => seqRefText(node.attrs),
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node;
    const dom = document.createElement('div');
    dom.className = 'seqblock'; dom.contentEditable = 'false';
    const set = attrs => { const pos = getPos(); if (typeof pos == 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, ...attrs})); };
    async function render() {
      const a = cur.attrs;
      if (!a.entity) {
        if (!editor.isEditable) { dom.textContent = seqRefText(a); return; }
        const objs = await call('sequenceObjects');
        dom.innerHTML = `<span class="ui">🧬 Sequenz</span> <select data-sqpick><option value="">${objs.length ? 'Objekt mit Sequenz wählen …' : 'Noch keine Sequenz in der Registry'}</option>
          ${objs.map((o, i) => `<option value="${i}">${esc(`${o.code} ${o.name}${o.field != 'sequence' ? ' · ' + o.field_label : ''} (${bp(o.length)})`)}</option>`).join('')}</select>`;
        dom.querySelector('[data-sqpick]').onchange = ev => { const o = objs[+ev.target.value]; if (o) set({entity: o.entity, field: o.field, label: `${o.code} ${o.name}`, length: o.length}); };
        return;
      }
      try {
        const e = await call('entity', {id: a.entity}), seq = parseJSON(e.fields_json, {})[a.field] || '';
        const ann = await call('seqAnnotation', {entity: a.entity, field: a.field});
        dom.innerHTML = `<div class="seqbar"><b>🧬 <a href="#" data-sqopen>${esc(e.code)} ${esc(e.name)}</a></b><span class="sub">${bp(seq.length)} · ${ann.circular ? 'ringförmig' : 'linear'} · GC ${Calc.fmt(Bio.gc(seq))} %</span></div>
          <div class="seqmapbox small">${(ann.circular ? ringMap : lineMap)({seq, name: e.name, features: ann.features, size: 300, width: 640})}</div>`;
        dom.querySelector('[data-sqopen]').onclick = ev => { ev.preventDefault(); showEntity(a.entity); };
      } catch { dom.textContent = `${seqRefText(a)} – Objekt nicht mehr vorhanden`; }
    }
    render();
    return {dom, update: n => { if (n.type.name != 'seqref') return false; const changed = JSON.stringify(n.attrs) != JSON.stringify(cur.attrs); cur = n; if (changed) render(); return true; },
      stopEvent: e => !!e.target.closest?.('select, a'), ignoreMutation: () => true};
  },
});
const seqRefText = a => a.entity ? `Sequenz ${a.label}${a.length ? ` (${bp(a.length)})` : ''}` : 'Sequenz (noch nicht gewählt)';
function insertSequenceBlock() { editor.chain().focus().insertContent([{type: 'seqref'}, {type: 'paragraph'}]).run(); }

function initSeqView() {
  const picker = Object.assign(document.createElement('input'), {type: 'file', accept: '.gb,.gbk,.genbank,.gbff,.fasta,.fa,.fna,.fas,.seq,.txt', hidden: true});
  document.body.appendChild(picker);
  picker.onchange = async () => {
    const f = picker.files[0]; if (!f) return;
    try { importSeqText(picker.dataset.field, await f.text(), f.name); } catch (err) { alert(`${f.name}: ${err.message}`); }
    picker.value = '';
  };
  $('#reg').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.seqimport) { picker.dataset.field = d.seqimport; return picker.click(); }
    const el = e.target.closest('.seqpanel'); if (!el) return;
    const st = SEQ_STATE.get(el); if (!st) return;
    if (d.svorf !== undefined) { st.orfs = st.orfs ? null : Bio.orfs(st.seq, {minAa: 100, circular: st.ann.circular}).slice(0, 20); return drawSeqPanel(el); }
    if (d.svrc !== undefined) { st.rc = !st.rc; return drawSeqPanel(el); }
    if (d.svexp) return exportSeq(el, d.svexp);
    if (d.svdel) return saveAnn(el, {features: st.ann.features.filter((_, i) => i != +d.svdel)});
    if (d.svkeep) { const o = st.orfs[+d.svkeep]; st.orfs = st.orfs.filter(x => x != o); return saveAnn(el, {features: [...st.ann.features, {type: 'CDS', label: `ORF ${o.aa} aa`, start: o.start, end: o.end, strand: o.strand}]}); }
  });
  $('#reg').addEventListener('change', e => {
    const el = e.target.closest('.seqpanel'); if (!el) return;
    const st = SEQ_STATE.get(el);
    if (e.target.dataset.svcirc !== undefined) return saveAnn(el, {circular: e.target.checked});
    if (e.target.dataset.svframe !== undefined) { st.frame = +e.target.value; drawSeqPanel(el); }
  });
  $('#reg').addEventListener('input', e => {
    if (e.target.dataset.svmotif === undefined) return;
    const el = e.target.closest('.seqpanel'), st = SEQ_STATE.get(el);
    clearTimeout(st.t);
    st.t = setTimeout(() => { st.motif = e.target.value.trim(); drawSeqPanel(el); const i = el.querySelector('[data-svmotif]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
  });
}
