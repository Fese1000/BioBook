// Bilder beschriften: Pfeile, Rahmen, Text und Spurenbelegung (Gele). Das Originalbild bleibt unverändert;
// die Beschriftung liegt als Vektorgrafik in den Bild-Attributen (notes) und damit im Eintrag und in den Revisionen.
'use strict';

const ANNOT_COLORS = ['#e53935', '#fdd835', '#ffffff', '#111111', '#1e88e5'];
const ANNOT_W = 1000;  // Koordinaten: Breite 0–1000, Höhe 0–1000/Seitenverhältnis

/// SVG als Text (für Knotenansicht und Editor)
function annotSVG(notes, extra = '') {
  if (!notes) return '';
  const H = ANNOT_W / notes.aspect, sw = 4, fs = 30;
  const halo = c => c == '#111111' ? '#ffffff' : '#000000';
  const txt = (x, y, s, c, anchor = 'start') => `<text x="${x}" y="${y}" fill="${c}" stroke="${halo(c)}" stroke-width="5" paint-order="stroke"
    font-size="${fs}" font-weight="700" font-family="-apple-system,Helvetica,sans-serif" text-anchor="${anchor}">${esc(s)}</text>`;
  const marks = ANNOT_COLORS.map((c, i) => `<marker id="ah${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('');
  const body = notes.shapes.map(s => {
    if (s.t == 'arrow') return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.c}" stroke-width="${sw}" marker-end="url(#ah${Math.max(0, ANNOT_COLORS.indexOf(s.c))})"/>`;
    if (s.t == 'rect') return `<rect x="${Math.min(s.x1, s.x2)}" y="${Math.min(s.y1, s.y2)}" width="${Math.abs(s.x2 - s.x1)}" height="${Math.abs(s.y2 - s.y1)}" fill="none" stroke="${s.c}" stroke-width="${sw}"/>`;
    if (s.t == 'text') return txt(s.x, s.y, s.s, s.c);
    if (s.t == 'lanes') return s.xs.map((x, i) => `<line x1="${x}" y1="${s.y - 8}" x2="${x}" y2="${s.y + 8}" stroke="${s.c}" stroke-width="${sw}"/>`
      + txt(x, s.y - 16, (s.labels[i] ?? '').trim() || String(i + 1), s.c, 'middle')).join('');
    return '';
  }).join('');
  return `<svg class="annot-svg" viewBox="0 0 ${ANNOT_W} ${H}" xmlns="http://www.w3.org/2000/svg"${extra}><defs>${marks}</defs>${body}</svg>`;
}

/// Bild-Knoten mit Beschriftung: im Editor als Bild mit Overlay, im HTML (PDF) als <figure> mit eingebettetem SVG
const AnnotImage = TT.Image.extend({
  addAttributes() {
    return {...this.parent?.(), notes: {default: null, parseHTML: el => JSON.parse(el.getAttribute('data-notes') || 'null'),
      renderHTML: a => a.notes ? {'data-notes': JSON.stringify(a.notes)} : {}}};
  },
  parseHTML() {
    return [{tag: 'figure.annot', getAttrs: el => { const i = el.querySelector('img'); return i ? {src: i.getAttribute('src'), alt: i.getAttribute('alt'), notes: JSON.parse(i.getAttribute('data-notes') || 'null')} : false; }},
      {tag: 'img[src]'}];
  },
  renderHTML({node, HTMLAttributes}) {
    if (!node.attrs.notes?.shapes?.length) return ['img', HTMLAttributes];
    // SVG als DOM-Struktur: aus dem Text bauen, damit Editor und PDF genau gleich aussehen
    const dom = document.createElement('figure');
    dom.className = 'annot';
    const img = document.createElement('img');
    for (const [k, v] of Object.entries(HTMLAttributes)) if (v != null) img.setAttribute(k, v);
    dom.appendChild(img);
    dom.insertAdjacentHTML('beforeend', annotSVG(node.attrs.notes));
    return dom;
  },
  addNodeView() {
    return ({node, getPos, editor}) => {
      let cur = node;
      const dom = document.createElement('figure');
      dom.className = 'annot annotview';
      const draw = () => {
        dom.innerHTML = `<img src="${esc(cur.attrs.src)}" alt="${esc(cur.attrs.alt || '')}">${annotSVG(cur.attrs.notes)}`;
        dom.title = editor.isEditable ? 'Doppelklick: beschriften (Pfeile, Text, Spuren)' : '';
      };
      draw();
      dom.addEventListener('dblclick', e => { if (editor.isEditable) { e.preventDefault(); openAnnotator(getPos(), cur); } });
      return {dom, update: n => { if (n.type.name != 'image') return false; cur = n; draw(); return true; }};
    };
  },
});

// ---------- Beschriftungs-Fenster ----------
let ANN = null;  // {pos, node, notes, tool, color, drag}

function openAnnotator(pos, node) {
  const img = new Image();
  img.onload = () => {
    const aspect = img.naturalWidth / img.naturalHeight || 1.5;
    ANN = {pos, node, notes: structuredClone(node.attrs.notes) || {aspect, shapes: []}, tool: 'arrow', color: ANNOT_COLORS[0], drag: null};
    ANN.notes.aspect = aspect;
    $('#annot').hidden = false;
    renderAnnotator();
  };
  img.onerror = () => alert('Bild lässt sich nicht laden');
  img.src = node.attrs.src;
}

function renderAnnotator() {
  const lanes = ANN.notes.shapes.find(s => s.t == 'lanes');
  const tools = [['arrow', '↗ Pfeil'], ['rect', '▭ Rahmen'], ['text', 'T Text'], ['lanes', '⫼ Spuren']];
  $('#annot').innerHTML = `<div class="ahead"><b>Bild beschriften</b>
      ${tools.map(([t, l]) => `<button class="btn ${ANN.tool == t ? 'on' : ''}" data-atool="${t}">${l}</button>`).join('')}
      <span class="sw">${ANNOT_COLORS.map(c => `<button class="swatch ${ANN.color == c ? 'on' : ''}" data-acolor="${c}" style="background:${c}" title="Farbe"></button>`).join('')}</span>
      <span class="grow"></span><button class="btn" data-aundo>Rückgängig</button><button class="btn" data-aclear>Alles löschen</button>
      <button class="btn" data-acancel>Abbrechen</button><button class="btn on" data-asave>Fertig</button></div>
    ${ANN.tool == 'lanes' ? `<div class="alanes">Spuren: in Höhe der Taschen nacheinander auf jede Spur klicken.
      <label>Belegung <input id="laneLabels" value="${esc((lanes?.labels || []).join(', '))}" placeholder="z. B. M, 1, 2, NK, PK" autocomplete="off"></label></div>` : ''}
    <div class="astage"><figure class="annot"><img src="${esc(ANN.node.attrs.src)}">${annotSVG(ANN.notes, ' id="asvg"')}</figure></div>`;
  const svg = $('#asvg');
  svg.addEventListener('mousedown', annotDown);
  $('#laneLabels')?.addEventListener('input', e => {
    const l = ANN.notes.shapes.find(s => s.t == 'lanes');
    if (l) { l.labels = e.target.value.split(','); redrawAnnot(); }
  });
}

function redrawAnnot() {
  const old = $('#asvg');
  old.outerHTML = annotSVG(ANN.notes, ' id="asvg"');
  $('#asvg').addEventListener('mousedown', annotDown);
}

function annotPoint(e) {
  const r = $('#asvg').getBoundingClientRect();
  return [Math.round((e.clientX - r.left) / r.width * ANNOT_W), Math.round((e.clientY - r.top) / r.height * ANNOT_W / ANN.notes.aspect)];
}

function annotDown(e) {
  e.preventDefault();
  const [x, y] = annotPoint(e), c = ANN.color, shapes = ANN.notes.shapes;
  if (ANN.tool == 'text') {
    const s = prompt('Text');
    if (s?.trim()) { shapes.push({t: 'text', x, y, s: s.trim(), c}); redrawAnnot(); }
    return;
  }
  if (ANN.tool == 'lanes') {
    let l = shapes.find(s => s.t == 'lanes');
    if (!l) { l = {t: 'lanes', y, xs: [], labels: ($('#laneLabels')?.value || '').split(',').filter(x => x.trim()), c}; shapes.push(l); }
    l.xs.push(x);
    redrawAnnot();
    return;
  }
  const shape = {t: ANN.tool, x1: x, y1: y, x2: x, y2: y, c};
  shapes.push(shape);
  const move = ev => { [shape.x2, shape.y2] = annotPoint(ev); redrawAnnot(); };
  const up = () => {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    if (Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 8) shapes.splice(shapes.indexOf(shape), 1);  // nur geklickt
    redrawAnnot();
  };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

function saveAnnotations() {
  const notes = ANN.notes.shapes.length ? ANN.notes : null;
  const {pos, node} = ANN;
  if (editor.isEditable && editor.state.doc.nodeAt(pos)?.type.name == 'image') {
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...node.attrs, notes}));
  }
  closeAnnotator();
}

function closeAnnotator() { ANN = null; $('#annot').hidden = true; $('#annot').innerHTML = ''; }

document.addEventListener('click', e => {
  if (!ANN) return;
  const d = e.target.dataset;
  if (d.atool) { ANN.tool = d.atool; renderAnnotator(); }
  else if (d.acolor) { ANN.color = d.acolor; renderAnnotator(); }
  else if (d.aundo !== undefined) {
    const sh = ANN.notes.shapes, last = sh.at(-1);
    if (last?.t == 'lanes' && last.xs.length > 1) last.xs.pop(); else sh.pop();
    redrawAnnot();
  }
  else if (d.aclear !== undefined) { if (confirm('Alle Beschriftungen entfernen?')) { ANN.notes.shapes = []; redrawAnnot(); } }
  else if (d.acancel !== undefined) closeAnnotator();
  else if (d.asave !== undefined) saveAnnotations();
});
document.addEventListener('keydown', e => { if (ANN && e.key == 'Escape') { e.preventDefault(); closeAnnotator(); } });

/// Werkzeugleiste: ausgewähltes Bild beschriften
function annotateSelected() {
  const sel = editor.state.selection;
  if (sel.node?.type.name == 'image') openAnnotator(sel.from, sel.node);
}
