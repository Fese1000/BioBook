// Laufendes Laborbuch: Tagesabschnitte im Eintrag („Dienstag, 30.6.2026“), einklappbar; „+ Heute“ legt den Tag einmal an.
// Der Zeitraum (erster bis letzter Tag) geht beim Speichern mit und steht in der Liste. Reine Hilfen oben (tests/days.test.js).
(function (root) {
  'use strict';
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  /// „Dienstag, 30.6.2026“
  function dayLabel(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    if (!y || !m || !d) return String(date || 'Ohne Datum');
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', {weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric'});
  }
  /// Zeitraum für die Liste: „30.06.–15.10.2026“, über Jahre „30.12.2025–02.01.2026“, ein Tag „30.06.2026“
  function rangeLabel(first, last) {
    if (!first) return '';
    const f = first.split('-'), l = (last || first).split('-');
    const full = p => `${p[2]}.${p[1]}.${p[0]}`;
    if (first == (last || first)) return full(f);
    return f[0] == l[0] ? `${f[2]}.${f[1]}.–${full(l)}` : `${full(f)}–${full(l)}`;
  }
  /// Tage eines Dokuments (oberste Ebene), sortiert und ohne doppelte
  const daysOf = doc => [...new Set((doc.content || []).filter(n => n.type == 'day' && /^\d{4}-\d{2}-\d{2}$/.test(n.attrs?.date || '')).map(n => n.attrs.date))].sort();
  const Days = {iso, dayLabel, rangeLabel, daysOf};
  if (typeof module != 'undefined' && module.exports) module.exports = Days; else root.Days = Days;
})(this);

if (typeof TT != 'undefined') {
  const DAY_OPEN = new Map();  // „Eintrag:Datum“ → eingeklappt (nur für diese Sitzung)
  var DayNode = TT.Node.create({
    name: 'day', group: 'block', content: 'block+', defining: true, isolating: true,
    addAttributes: () => ({date: {default: ''}}),
    parseHTML: () => [{tag: 'section[data-day]', contentElement: '.daybody', getAttrs: el => ({date: el.getAttribute('data-day') || ''})}],
    renderHTML: ({node}) => ['section', {'data-day': node.attrs.date, class: 'day'}, ['h3', {class: 'dayhead'}, Days.dayLabel(node.attrs.date)], ['div', {class: 'daybody'}, 0]],
    addKeyboardShortcuts() { return {'Mod-Shift-d': () => { addToday(); return true; }}; },
    addNodeView: () => ({node, editor, getPos}) => {
      let cur = node;
      const dom = document.createElement('section');
      dom.className = 'day'; dom.dataset.day = node.attrs.date;
      const head = document.createElement('div');
      head.className = 'dayhead'; head.contentEditable = 'false';
      const body = document.createElement('div');
      body.className = 'daybody';
      dom.append(head, body);
      const key = () => `${typeof cur_entry == 'function' ? cur_entry() : ''}:${cur.attrs.date}`;
      const draw = () => {
        const closed = DAY_OPEN.get(key()) === true;
        dom.classList.toggle('collapsed', closed);
        head.innerHTML = `<button class="daytog" title="Ein-/ausklappen (⌥-Klick: alle)">${closed ? '▸' : '▾'}</button><span class="daylabel">📅 ${esc(Days.dayLabel(cur.attrs.date))}</span>`
          + (editor.isEditable ? '<button class="dayedit" title="Datum dieses Tages ändern">✎ Datum</button>' : '')
          + (closed ? `<span class="sub">${cur.childCount} Absatz/Absätze eingeklappt</span>` : '');
      };
      /// Datum nachträglich ändern; ein zweiter Abschnitt mit demselben Datum wird abgelehnt (der Tag soll eindeutig bleiben)
      const editDate = () => {
        const input = document.createElement('input'); input.type = 'date'; input.value = cur.attrs.date;
        head.querySelector('.dayedit').replaceWith(input); input.focus();
        let done = false;
        const finish = apply => {
          if (done) return; done = true;
          const date = input.value;
          if (apply && date && date != cur.attrs.date) {
            let taken = false;
            editor.state.doc.forEach(n => { if (n.type.name == 'day' && n.attrs.date == date) taken = true; });
            if (taken) alert(`Für den ${Days.dayLabel(date)} gibt es in diesem Eintrag schon einen Tagesabschnitt.`);
            else editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, {...cur.attrs, date}));
          }
          draw();
        };
        input.addEventListener('change', () => finish(true));
        input.addEventListener('blur', () => finish(false));
        input.addEventListener('keydown', e => { if (e.key == 'Escape') finish(false); if (e.key == 'Enter') finish(true); });
      };
      head.addEventListener('mousedown', e => {
        if (e.target.closest('input[type=date]')) return;  // Datumsfeld bedienen, nicht ein-/ausklappen
        e.preventDefault();
        if (e.target.closest('.dayedit')) return editDate();
        const closed = !(DAY_OPEN.get(key()) === true);
        if (e.altKey) { document.querySelectorAll('#editor section.day').forEach(s => s.dispatchEvent(new CustomEvent('daytoggle', {detail: closed}))); return; }
        DAY_OPEN.set(key(), closed); draw();
      });
      dom.addEventListener('daytoggle', e => { DAY_OPEN.set(key(), e.detail); draw(); });
      dom.expand = () => { DAY_OPEN.set(key(), false); draw(); };
      draw();
      return {dom, contentDOM: body,
        update: n => { if (n.type.name != 'day') return false; const ch = n.attrs.date != cur.attrs.date; cur = n; if (ch) { dom.dataset.day = n.attrs.date; draw(); } else if (dom.classList.contains('collapsed')) draw(); return true; },
        stopEvent: e => head.contains(e.target), ignoreMutation: m => head.contains(m.target)};
    },
  });
}

/// „+ Heute“: Tag von heute ans Ende anlegen (oder hinspringen, wenn es ihn schon gibt)
function addToday() {
  if (!editor?.isEditable) return false;
  const date = Days.iso(new Date());
  let at = null;
  editor.state.doc.forEach((n, pos) => { if (n.type.name == 'day' && n.attrs.date == date) at = pos; });
  if (at != null) {
    const node = editor.state.doc.nodeAt(at);
    editor.view.nodeDOM(at)?.expand?.();
    editor.chain().focus(at + node.nodeSize - 2).run();
  } else {
    const doc = editor.state.doc, empty = doc.childCount == 1 && doc.firstChild.type.name == 'paragraph' && !doc.firstChild.content.size;
    const node = {type: 'day', attrs: {date}, content: [{type: 'paragraph'}]};
    if (empty) editor.commands.setContent({type: 'doc', content: [node]});
    else editor.chain().insertContentAt(doc.content.size, node).run();
    editor.chain().focus(editor.state.doc.content.size - 2).run();
  }
  editor.view.domAtPos(editor.state.selection.from)?.node?.parentElement?.scrollIntoView({block: 'center'});
  return true;
}

/// Nach dem Öffnen zur ersten Stelle mit text springen (Suchtreffer, Aufgabe aus „Fällig“); eingeklappte Tage öffnen sich
function jumpToText(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || !editor) return false;
  let hit = null;
  editor.state.doc.descendants((n, pos) => {
    if (hit || !n.isText) return !hit;
    const i = n.text.toLowerCase().indexOf(t);
    if (i >= 0) hit = {from: pos + i, to: pos + i + t.length};
  });
  if (!hit) return false;
  const $p = editor.state.doc.resolve(hit.from);
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name == 'day') editor.view.nodeDOM($p.before(d))?.expand?.();
  editor.commands.setTextSelection(hit);
  const el = editor.view.domAtPos(hit.from).node;
  (el.nodeType == 3 ? el.parentElement : el)?.scrollIntoView({block: 'center'});
  return true;
}
