// Rechner als Block im Editor: Verdünnung, Molarität, Mastermix, Umrechnen. Rechnet mit Calc (calc.js).
// Die Eingaben stecken im Knoten (attrs.data) und landen so im Arbeitsstand und in den Revisionen.
'use strict';

const CALC_KINDS = {
  dilution: {title: 'Verdünnung (C1·V1 = C2·V2)', data: () => ({c1: {v: '', u: 'mM'}, v1: {v: '', u: 'µl'}, c2: {v: '', u: 'µM'}, v2: {v: '', u: 'ml'}})},
  molarity: {title: 'Einwaage (Masse = c · V · M)', data: () => ({mass: {v: '', u: 'g'}, conc: {v: '', u: 'M'}, vol: {v: '', u: 'ml'}, mw: {v: '', u: 'g/mol'}})},
  mastermix: {title: 'Mastermix', data: () => ({n: '8', excess: '10', final: '', rows: [{name: '', vol: ''}, {name: '', vol: ''}, {name: '', vol: ''}]})},
  convert: {title: 'Einheiten umrechnen', data: () => ({v: '', from: 'ml', to: 'µl'})},
};

const CALC_FIELDS = {
  dilution: [['c1', 'Ausgangskonz. C1', 'conc'], ['v1', 'Volumen V1', 'volume'], ['c2', 'Endkonz. C2', 'conc'], ['v2', 'Endvolumen V2', 'volume']],
  molarity: [['mass', 'Masse', 'mass'], ['conc', 'Konzentration', 'molar'], ['vol', 'Volumen', 'volume'], ['mw', 'Molmasse', null]],
};
const CALC_PENDING = new Set();  // noch nicht übernommene Eingaben; flush() ruft sie vor dem Speichern auf
const unitOpts = dim => dim == 'conc' ? Calc.CONC_UNITS : dim ? Object.keys(Calc.UNITS[dim]) : ['g/mol'];
const ALL_UNITS = ['volume', 'mass', 'molar', 'massconc'].flatMap(d => Object.keys(Calc.UNITS[d]));

/// Ergebnis als Text (für Suche, Export und den Kopf des Blocks)
function calcSummary(kind, d) {
  try {
    if (kind == 'dilution') {
      const r = Calc.dilution(d), all = {...d, [r.key]: {v: Calc.fmt(r.v), u: r.u}};
      return {ok: true, key: r.key, value: r.v, text: `${all.c1.v} ${all.c1.u} → ${all.c2.v} ${all.c2.u} in ${all.v2.v} ${all.v2.u}: `
        + `${all.v1.v} ${all.v1.u} Ausgangslösung + ${Calc.fmt(r.diluent.v)} ${r.diluent.u} Verdünnungsmittel`};
    }
    if (kind == 'molarity') {
      const r = Calc.molarity(d), all = {...d, [r.key]: {v: Calc.fmt(r.v), u: r.u}};
      return {ok: true, key: r.key, value: r.v, text: `${all.mass.v} ${all.mass.u} für ${all.conc.v} ${all.conc.u} in ${all.vol.v} ${all.vol.u} (M = ${all.mw.v} g/mol)`};
    }
    if (kind == 'mastermix') {
      const r = Calc.mastermix(d);
      return {ok: true, mm: r, text: `Mastermix für ${d.n} Reaktionen (+${d.excess || 0} %): ` + r.rows.map(x => `${x.name || '?'} ${Calc.fmt(x.total)} µl`).join(', ') + `; gesamt ${Calc.fmt(r.total)} µl`};
    }
    if (kind == 'convert') {
      const v = Calc.convert(d.v, d.from, d.to);
      return {ok: true, value: v, text: `${d.v} ${d.from} = ${Calc.fmt(v)} ${d.to}`};
    }
  } catch (e) {
    if (e instanceof Calc.CalcError) return {ok: false, text: e.message};
    throw e;
  }
  return {ok: false, text: ''};
}

const CalcNode = TT.Node.create({
  name: 'calc', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({
    kind: {default: 'dilution', parseHTML: el => el.getAttribute('data-calc'), renderHTML: a => ({'data-calc': a.kind})},
    data: {default: null, parseHTML: el => JSON.parse(el.getAttribute('data-json') || 'null'), renderHTML: a => ({'data-json': JSON.stringify(a.data)})},
  }),
  parseHTML: () => [{tag: 'div[data-calc]'}],
  renderHTML: ({node, HTMLAttributes}) => ['div', HTMLAttributes, calcSummary(node.attrs.kind, node.attrs.data).text],
  renderText: ({node}) => `${CALC_KINDS[node.attrs.kind]?.title}: ${calcSummary(node.attrs.kind, node.attrs.data).text}`,
  addNodeView: () => ({node, getPos, editor}) => {
    const dom = document.createElement('div');
    dom.className = 'calc'; dom.contentEditable = 'false';
    let cur = node;
    const data = () => structuredClone(cur.attrs.data || CALC_KINDS[cur.attrs.kind].data());

    // Änderung in den Knoten schreiben (nur wenn bearbeitbar, sonst würde eine angezeigte alte Revision verändert)
    const commit = d => {
      if (!editor.isEditable) return render();
      const pos = getPos();
      if (typeof pos != 'number') return;
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, data: d}));
    };

    const field = (key, label, dim, f, computed) => `<label class="cf ${computed ? 'res' : ''}"><span>${label}</span>
      <input data-k="${key}" value="${esc(f.v)}" placeholder="${computed != null ? '= ' + esc(Calc.fmt(computed)) : 'leer = berechnen'}" inputmode="decimal">
      ${dim === null ? '<em>g/mol</em>' : `<select data-u="${key}">${unitOpts(dim).map(u => `<option ${u == f.u ? 'selected' : ''}>${u}</option>`).join('')}</select>`}</label>`;

    function render() {
      const {kind} = cur.attrs, d = data(), s = calcSummary(kind, d), ro = !editor.isEditable;
      // Fokus merken, damit Tab von Feld zu Feld nach dem Neuzeichnen weitergeht
      const a = dom.contains(document.activeElement) ? document.activeElement : null;
      const focusSel = a && (a.dataset.k ? `[data-k="${a.dataset.k}"]` : a.dataset.row ? `[data-row="${a.dataset.row}"][data-col="${a.dataset.col}"]` : a.dataset.u ? `[data-u="${a.dataset.u}"]` : null);
      const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
      let body = '';
      if (CALC_FIELDS[kind]) body = `<div class="cgrid">${CALC_FIELDS[kind].map(([k, l, dim]) => field(k, l, dim, d[k], s.ok && s.key == k ? s.value : null)).join('')}</div>`;
      else if (kind == 'convert') body = `<div class="cgrid conv"><label class="cf"><span>Wert</span><input data-k="v" value="${esc(d.v)}" inputmode="decimal">
        <select data-u="from">${ALL_UNITS.map(u => `<option ${u == d.from ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="cf res"><span>in</span><input value="${s.ok ? esc(Calc.fmt(s.value)) : ''}" readonly><select data-u="to">${ALL_UNITS.map(u => `<option ${u == d.to ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>`;
      else if (kind == 'mastermix') {
        const tot = s.ok ? s.mm.rows : [];
        body = `<div class="cmm-head"><label>Reaktionen <input data-k="n" value="${esc(d.n)}" inputmode="numeric"></label>
          <label>Überschuss <input data-k="excess" value="${esc(d.excess)}" inputmode="decimal"> %</label>
          <label>Endvolumen <input data-k="final" value="${esc(d.final)}" placeholder="optional" inputmode="decimal"> µl</label></div>
          <table class="cmm"><tr><th>Komponente</th><th>je Reaktion (µl)</th><th>gesamt (µl)</th><th></th></tr>
          ${d.rows.map((r, i) => `<tr><td><input data-row="${i}" data-col="name" value="${esc(r.name)}" placeholder="z. B. Puffer 10x"></td>
            <td><input data-row="${i}" data-col="vol" value="${esc(r.vol)}" inputmode="decimal"></td>
            <td class="num">${s.ok && Calc.num(r.vol) > 0 ? Calc.fmt(Calc.num(r.vol) * s.mm.factor) : ''}</td>
            <td>${ro ? '' : `<button class="x" data-del="${i}" title="Zeile löschen">×</button>`}</td></tr>`).join('')}
          ${s.ok && d.final ? `<tr class="water"><td>Wasser</td><td class="num">${Calc.fmt(s.mm.rows.at(-1).vol)}</td><td class="num">${Calc.fmt(s.mm.rows.at(-1).total)}</td><td></td></tr>` : ''}
          ${s.ok ? `<tr class="sum"><td>Summe</td><td class="num">${Calc.fmt(s.mm.perRxn)}</td><td class="num">${Calc.fmt(s.mm.total)}</td><td></td></tr>` : ''}</table>
          ${ro ? '' : '<button class="btn" data-add>+ Komponente</button>'}`;
      }
      dom.innerHTML = `<div class="chead">🧮 ${CALC_KINDS[kind].title}${ro ? '' : '<button class="x" data-remove title="Rechner entfernen">×</button>'}</div>${body}
        <div class="cres ${s.ok ? 'ok' : 'err'}">${esc(s.text || 'Werte eintragen, ein Feld leer lassen.')}</div>`;
      dom.querySelectorAll('input:not([readonly]), select').forEach(el => { el.disabled = ro; });
      const f = focusSel && dom.querySelector(focusSel);
      if (f) { f.focus(); if (sel && f.setSelectionRange) try { f.setSelectionRange(...sel); } catch {} }
    }

    // Während man im Block tippt, nur Ergebnisse aktualisieren; die Eingabefelder bleiben unangetastet.
    function refresh(d) {
      const {kind} = cur.attrs, s = calcSummary(kind, d);
      const r = dom.querySelector('.cres');
      r.textContent = s.text || 'Werte eintragen, ein Feld leer lassen.'; r.className = `cres ${s.ok ? 'ok' : 'err'}`;
      if (CALC_FIELDS[kind]) for (const [k] of CALC_FIELDS[kind]) {
        const inp = dom.querySelector(`[data-k="${k}"]`), hit = s.ok && s.key == k;
        inp.placeholder = hit ? '= ' + Calc.fmt(s.value) : 'leer = berechnen';
        inp.closest('.cf').classList.toggle('res', hit);
      }
      if (kind == 'convert') dom.querySelector('.cf.res input').value = s.ok ? Calc.fmt(s.value) : '';
      if (kind == 'mastermix') {
        d.rows.forEach((row, i) => {
          const cell = dom.querySelector(`[data-row="${i}"][data-col="vol"]`)?.closest('tr').querySelector('td.num');
          if (cell) cell.textContent = s.ok && Calc.num(row.vol) > 0 ? Calc.fmt(Calc.num(row.vol) * s.mm.factor) : '';
        });
        const w = dom.querySelector('tr.water'), sum = dom.querySelector('tr.sum');
        if (w && s.ok && d.final) { w.cells[1].textContent = Calc.fmt(s.mm.rows.at(-1).vol); w.cells[2].textContent = Calc.fmt(s.mm.rows.at(-1).total); }
        if (sum && s.ok) { sum.cells[1].textContent = Calc.fmt(s.mm.perRxn); sum.cells[2].textContent = Calc.fmt(s.mm.total); }
      }
    }

    const read = () => {
      const d = data();
      dom.querySelectorAll('[data-k]').forEach(el => {
        const k = el.dataset.k;
        if (d[k] && typeof d[k] == 'object') d[k].v = el.value; else d[k] = el.value;
      });
      dom.querySelectorAll('[data-u]').forEach(el => { const k = el.dataset.u; if (d[k] && typeof d[k] == 'object') d[k].u = el.value; else d[k] = el.value; });
      dom.querySelectorAll('[data-row]').forEach(el => { d.rows[+el.dataset.row][el.dataset.col] = el.value; });
      return d;
    };
    // Übernommen wird erst, wenn der Fokus den Block verlässt (oder mit Enter, oder vor dem Speichern).
    // Würde jede Eingabe sofort den Knoten ändern, zeichnete der Editor neu und Tastendrücke landeten im falschen Feld.
    let dirty = false;
    const pending = () => { if (dirty) { dirty = false; commit(read()); } };
    CALC_PENDING.add(pending);
    dom.addEventListener('input', () => { dirty = true; refresh(read()); });
    dom.addEventListener('change', () => { dirty = true; refresh(read()); });
    dom.addEventListener('focusout', e => { if (!dom.contains(e.relatedTarget)) pending(); });
    dom.addEventListener('keydown', e => { if (e.key == 'Enter' && e.target.tagName == 'INPUT') { e.preventDefault(); dirty = true; pending(); } });
    dom.addEventListener('click', e => {
      if (!editor.isEditable) return;
      if (e.target.dataset.add !== undefined) { const d = read(); d.rows.push({name: '', vol: ''}); dirty = false; commit(d); }
      if (e.target.dataset.del !== undefined) { const d = read(); d.rows.splice(+e.target.dataset.del, 1); dirty = false; commit(d); }
      if (e.target.dataset.remove !== undefined) { const pos = getPos(); editor.chain().focus().deleteRange({from: pos, to: pos + cur.nodeSize}).run(); }
    });
    render();
    return {
      dom,
      update: n => {
        if (n.type.name != 'calc') return false;
        const same = JSON.stringify(n.attrs) == JSON.stringify(cur.attrs);
        cur = n;
        if (!same) { dirty = false; render(); }  // eigene Übernahme oder Rückgängig/Wiederholen
        return true;
      },
      destroy: () => CALC_PENDING.delete(pending),
      stopEvent: e => !!e.target.closest?.('input, select, button'),  // Eingaben gehören dem Rechner, nicht dem Editor
      ignoreMutation: () => true,
    };
  },
});

function insertCalc(kind) {
  // mit leerem Absatz dahinter: der Cursor landet dort, und ein zweiter Rechner ersetzt nicht den ersten
  editor.chain().focus().insertContent([{type: 'calc', attrs: {kind, data: CALC_KINDS[kind].data()}}, {type: 'paragraph'}]).run();
}

/// Kleines Auswahlmenü unter dem Rechner-Knopf
function calcMenu(btn) {
  document.querySelector('.suggest.calcmenu')?.remove();
  const el = document.createElement('div');
  el.className = 'suggest calcmenu';
  el.innerHTML = Object.entries(CALC_KINDS).map(([k, c]) => `<div class="opt" data-kind="${k}">${c.title}</div>`).join('');
  const r = btn.getBoundingClientRect();
  el.style.left = `${r.left}px`; el.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = e => { if (!el.contains(e.target)) close(); };
  el.addEventListener('mousedown', e => { const o = e.target.closest('[data-kind]'); if (o) { e.preventDefault(); close(); insertCalc(o.dataset.kind); } });
  setTimeout(() => document.addEventListener('mousedown', outside, true));
}
