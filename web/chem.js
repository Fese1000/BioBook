// Chemie: SMILES lesen → Summenformel (Hill) und Molmasse (reine Funktionen, tests/chem.test.js);
// Block „⚗️ Struktur“ mit Strukturbild (SmilesDrawer, MIT, offline gebündelt) und Übergabe an den Einwaage-Rechner.
(function (root) {
  'use strict';

  // Standard-Atomgewichte (IUPAC, konventionelle Werte)
  const MASS = {H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305,
    Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693,
    Cu: 63.546, Zn: 65.38, Se: 78.971, Br: 79.904, Rb: 85.468, Sr: 87.62, Mo: 95.95, Ag: 107.87, Cd: 112.41, Sn: 118.71, I: 126.90, Cs: 132.91,
    Ba: 137.33, Pt: 195.08, Au: 196.97, Hg: 200.59, Pb: 207.2, Gd: 157.25, Tb: 158.93, Eu: 151.96};
  // Normale Bindigkeiten der „organischen“ Atome ohne Klammer
  const VALENCE = {B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1]};
  const ORGANIC = /^(Cl|Br|B|C|N|O|P|S|F|I|b|c|n|o|p|s)/;
  const BOND = {'-': 1, '=': 2, '#': 3, '$': 4, ':': 1.5, '/': 1, '\\': 1};

  class ChemError extends Error {}
  const fail = m => { throw new ChemError(m); };

  /// SMILES → Atome mit Wasserstoffen; unterstützt Klammeratome, Ladungen, Isotope, Ringe (auch %nn), Verzweigungen, aromatische Atome, Punkt
  function parse(smiles) {
    const s = String(smiles || '').trim();
    if (!s) fail('SMILES fehlt');
    const atoms = [], bonds = [], stack = [], rings = {};
    let prev = null, bond = null, i = 0;
    const add = a => { atoms.push(a); const idx = atoms.length - 1; if (prev != null) bonds.push([prev, idx, bond ?? (a.arom && atoms[prev].arom ? 1.5 : 1)]); prev = idx; bond = null; return idx; };
    while (i < s.length) {
      const ch = s[i];
      if (ch == '(') { if (prev == null) fail('Klammer am Anfang'); stack.push(prev); i++; continue; }
      if (ch == ')') { if (!stack.length) fail('Klammer ohne Gegenstück'); prev = stack.pop(); i++; continue; }
      if (ch == '.') { prev = null; i++; continue; }
      if (ch in BOND) { bond = BOND[ch]; i++; continue; }
      if (/[0-9%]/.test(ch)) {
        const m = ch == '%' ? /^%(\d\d)/.exec(s.slice(i)) : [ch, ch];
        if (!m) fail(`Ringnummer unlesbar bei ${i + 1}`);
        const n = m[1]; i += m[0].length;
        if (prev == null) fail('Ringnummer ohne Atom');
        if (rings[n]) { const r = rings[n]; bonds.push([r.atom, prev, bond ?? r.bond ?? (atoms[prev].arom && atoms[r.atom].arom ? 1.5 : 1)]); delete rings[n]; bond = null; }
        else { rings[n] = {atom: prev, bond}; bond = null; }
        continue;
      }
      if (ch == '[') {
        const end = s.indexOf(']', i); if (end < 0) fail('Eckige Klammer nicht geschlossen');
        const m = /^(\d+)?([A-Z][a-z]?|[cnospb]|se|as)(@{1,2}(?:TH\d|AL\d|SP\d|TB\d+|OH\d+)?)?(H\d?)?([+-]+\d*|[+-]\d+)?(:\d+)?$/.exec(s.slice(i + 1, end));
        if (!m) fail(`Atom unlesbar: [${s.slice(i + 1, end)}]`);
        const arom = /^[a-z]/.test(m[2]), el = arom ? m[2][0].toUpperCase() + m[2].slice(1) : m[2];
        if (!(el in MASS)) fail(`Unbekanntes Element: ${el}`);
        let charge = 0;
        if (m[5]) { const sign = m[5][0] == '+' ? 1 : -1, rest = m[5].slice(1); charge = sign * (/^\d+$/.test(rest) ? +rest : m[5].length); }
        add({el, arom, h: m[4] ? (m[4].length > 1 ? +m[4].slice(1) : 1) : 0, charge, bracket: true});
        i = end + 1; continue;
      }
      const m = ORGANIC.exec(s.slice(i));
      if (!m) fail(`Zeichen nicht erlaubt: „${ch}“ (Stelle ${i + 1})`);
      const arom = /^[a-z]/.test(m[1]);
      add({el: arom ? m[1].toUpperCase() : m[1], arom, h: null, charge: 0, bracket: false});
      i += m[1].length;
    }
    if (stack.length) fail('Klammer nicht geschlossen');
    if (Object.keys(rings).length) fail(`Ring ${Object.keys(rings)[0]} nicht geschlossen`);
    // Implizite Wasserstoffe: kleinste passende Bindigkeit minus Bindungssumme (aromatisch: +1 für das Doppelbindungs-Äquivalent)
    const sum = atoms.map(() => 0);
    for (const [a, b, o] of bonds) { sum[a] += o == 1.5 ? 1 : o; sum[b] += o == 1.5 ? 1 : o; }
    atoms.forEach((a, k) => {
      if (a.h != null) return;
      const used = sum[k] + (a.arom ? 1 : 0), vals = VALENCE[a.el] || [0];
      const v = a.arom ? vals[0] : vals.find(x => x >= used) ?? used;  // aromatisch nur die kleinste Bindigkeit (sonst bekäme n(C) ein H)
      a.h = Math.max(0, v - used);
    });
    return {atoms, bonds};
  }

  /// Summenformel nach Hill (C, H, dann alphabetisch; ohne C alles alphabetisch), Molmasse, Ladung
  function formula(smiles) {
    const {atoms} = parse(smiles), counts = {};
    let charge = 0;
    for (const a of atoms) { counts[a.el] = (counts[a.el] || 0) + 1; if (a.h) counts.H = (counts.H || 0) + a.h; charge += a.charge; }
    const keys = Object.keys(counts).sort();
    const order = counts.C ? ['C', ...(counts.H ? ['H'] : []), ...keys.filter(k => k != 'C' && k != 'H')] : keys;
    const hill = order.map(k => k + (counts[k] > 1 ? counts[k] : '')).join('');
    const mass = order.reduce((m, k) => m + MASS[k] * counts[k], 0);
    return {counts, hill, mass, charge, atoms: atoms.length};
  }

  /// „C4H11NO3“ mit tiefgestellten Zahlen (HTML)
  const hillHTML = h => h.replace(/(\d+)/g, '<sub>$1</sub>');

  /// Molmasse mit zwei Nachkommastellen, deutsches Komma
  const mw = m => m.toFixed(2).replace('.', ',');

  const Chem = {parse, formula, hillHTML, mw, MASS, ChemError};
  if (typeof module != 'undefined' && module.exports) module.exports = Chem; else root.Chem = Chem;
})(this);

// ---------- Strukturbild ----------
/// SVG-Markup einer Struktur (für Block, Registry und Druck); null, wenn SmilesDrawer die Formel nicht zeichnen kann
function drawStructure(smiles, {width = 260, height = 180} = {}) {
  return new Promise(res => {
    if (typeof SmilesDrawer == 'undefined' || !smiles) return res(null);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    try {
      const drawer = new SmilesDrawer.SvgDrawer({width, height, padding: 12, bondThickness: 1.2, fontSizeLarge: 7, fontSizeSmall: 5, compactDrawing: false});
      SmilesDrawer.parse(smiles, tree => {
        try {
          drawer.draw(tree, svg, dark ? 'dark' : 'light');
          // SmilesDrawer legt <style> mit .sub/.element ins SVG – im HTML gälte das für die ganze Seite; daher aufs Bild beschränken
          svg.classList.add('sdw');
          svg.querySelectorAll('style').forEach(st => { st.textContent = st.textContent.replace(/(^|\})\s*\.(sub|element)\s*\{/g, '$1 .sdw .$2 {'); });
          res(svg.outerHTML);
        } catch { res(null); }
      }, () => res(null));
    } catch { res(null); }
  });
}

if (typeof TT != 'undefined') {
  var ChemNode = TT.Node.create({
    name: 'chem', group: 'block', atom: true, draggable: true,
    addAttributes: () => ({smiles: {default: ''}, name: {default: ''}, svg: {default: ''}}),
    parseHTML: () => [{tag: 'div[data-chem]', getAttrs: el => JSON.parse(el.getAttribute('data-chem') || '{}')}],
    renderHTML: ({node}) => {
      const a = node.attrs, el = document.createElement('div');
      el.setAttribute('data-chem', JSON.stringify(a)); el.className = 'chem-print';
      let f = null; try { f = Chem.formula(a.smiles); } catch {}
      el.innerHTML = `${a.svg || ''}<p><b>${esc(a.name || 'Struktur')}</b>${f ? ` · ${Chem.hillHTML(f.hill)} · ${Chem.mw(f.mass)} g/mol` : ''}<br><code>${esc(a.smiles)}</code></p>`;
      return el;
    },
    renderText: ({node}) => { let f = null; try { f = Chem.formula(node.attrs.smiles); } catch {} return `${node.attrs.name || 'Struktur'}: ${node.attrs.smiles}${f ? ` (${f.hill}, ${Chem.mw(f.mass)} g/mol)` : ''}`; },
    addNodeView: () => ({node, getPos, editor}) => {
      let cur = node, timer;
      const dom = document.createElement('div');
      dom.className = 'chemblock'; dom.contentEditable = 'false';
      const set = attrs => { const pos = getPos(); if (typeof pos == 'number' && editor.isEditable) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, ...attrs})); };
      const ro = () => !editor.isEditable;
      dom.innerHTML = `<div class="chead"><span class="ui">⚗️</span><input data-cname placeholder="Name, z. B. Tris" style="width:160px"><input data-csmiles placeholder="SMILES, z. B. OCC(N)(CO)CO" spellcheck="false" autocomplete="off">
        <button class="btn" data-cweigh>→ Einwaage</button></div><div class="chembody"><div class="chempic"></div><div class="chemfacts"></div></div>`;
      const q = sel => dom.querySelector(sel);
      async function show(smiles, save) {
        let f = null, err = '';
        try { f = smiles ? Chem.formula(smiles) : null; } catch (e) { err = e.message; }
        q('.chemfacts').innerHTML = err ? `<p class="bad">${esc(err)}</p>` : f ? `<p class="hill">${Chem.hillHTML(f.hill)}${f.charge ? ` <span class="sub">(Ladung ${f.charge > 0 ? '+' : ''}${f.charge})</span>` : ''}</p>
          <p><b>${Chem.mw(f.mass)}</b> g/mol</p><p class="sub">${f.atoms} Schweratome</p>` : '<p class="sub">SMILES eingeben, z. B. aus PubChem.</p>';
        q('[data-cweigh]').disabled = !f || ro();
        const svg = !err && smiles ? await drawStructure(smiles) : null;
        q('.chempic').innerHTML = svg || (smiles && !err ? '<p class="sub">Bild nicht möglich</p>' : '');
        if (save && !ro()) set({smiles, svg: svg || ''});
      }
      q('[data-cname]').value = cur.attrs.name; q('[data-csmiles]').value = cur.attrs.smiles;
      if (ro()) dom.querySelectorAll('input').forEach(i => i.readOnly = true);
      dom.addEventListener('input', e => {
        if (e.target.dataset.csmiles !== undefined) { clearTimeout(timer); timer = setTimeout(() => show(e.target.value.trim(), false), 250); }
      });
      dom.addEventListener('change', e => {
        if (e.target.dataset.cname !== undefined) set({name: e.target.value.trim()});
        if (e.target.dataset.csmiles !== undefined) { clearTimeout(timer); show(e.target.value.trim(), true); }
      });
      dom.addEventListener('click', e => {
        if (e.target.dataset.cweigh === undefined) return;
        const f = Chem.formula(cur.attrs.smiles || q('[data-csmiles]').value.trim()), pos = getPos() + cur.nodeSize;
        const data = CALC_KINDS.molarity.data(); data.mw.v = Chem.mw(f.mass);
        editor.chain().insertContentAt(pos, [{type: 'calc', attrs: {kind: 'molarity', data}}]).run();
      });
      show(cur.attrs.smiles, false);
      return {dom, update: n => { if (n.type.name != 'chem') return false; cur = n; return true; },
        stopEvent: e => !!e.target.closest?.('input, button'), ignoreMutation: () => true};
    },
  });
}

function insertChem(smiles = '', name = '') { editor.chain().focus().insertContent([{type: 'chem', attrs: {smiles, name}}, {type: 'paragraph'}]).run(); }
