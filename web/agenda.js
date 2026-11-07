// Fälligkeiten: Datum in Aufgaben erkennen („bis Freitag“, „30.10.“, „morgen“, 2026-10-30), Übersicht „📅 Fällig“
// über Aufgaben, Geräte, Mycoplasma-Tests und Ablaufdaten, Export als .ics. Reine Funktionen oben (tests/agenda.test.js).
(function (root) {
  'use strict';

  const DAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);
  const valid = (y, m, d) => { const x = new Date(y, m - 1, d); return x.getFullYear() == y && x.getMonth() == m - 1 && x.getDate() == d; };

  /// Erstes Datum im Text → {date: 'JJJJ-MM-TT', from, to} oder null; today als 'JJJJ-MM-TT'
  function parseDue(text, today) {
    const t = String(text);
    const pats = [
      [/\b(\d{4})-(\d{2})-(\d{2})\b/, m => valid(+m[1], +m[2], +m[3]) && `${m[1]}-${m[2]}-${m[3]}`],
      [/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d.])/, m => {
        const d = +m[1], mo = +m[2];
        let y = m[3] ? (m[3].length == 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
        if (!valid(y, mo, d)) return null;
        let s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!m[3] && diffDays(s, today) < -180) s = `${y + 1}${s.slice(4)}`;  // „10.01.“ im Dezember meint das nächste Jahr
        return s;
      }],
      [/\b(heute|übermorgen|morgen)\b/i, m => addDays(today, {heute: 0, morgen: 1, übermorgen: 2}[m[1].toLowerCase()])],
      [new RegExp(`\\b(?:bis |am )?(${DAYS.join('|')})\\b`, 'i'), m => {
        const want = DAYS.indexOf(m[1].toLowerCase()), now = parseISO(today).getDay();
        return addDays(today, ((want - now + 7) % 7) || 7);  // nächster solcher Tag, nie heute
      }],
    ];
    let best = null;
    for (const [re, conv] of pats) {
      const m = re.exec(t);
      if (!m) continue;
      const date = conv(m);
      if (date && (!best || m.index < best.from)) best = {date, from: m.index, to: m.index + m[0].length};
    }
    return best;
  }

  /// Einordnen: überfällig, heute, diese Woche (bis Sonntag), später
  function bucket(items, today) {
    const sunday = addDays(today, (7 - parseISO(today).getDay()) % 7);
    const g = {overdue: [], today: [], week: [], later: []};
    for (const it of [...items].sort((a, b) => a.due.localeCompare(b.due) || String(a.title).localeCompare(b.title))) {
      g[it.due < today ? 'overdue' : it.due == today ? 'today' : it.due <= sunday ? 'week' : 'later'].push(it);
    }
    return g;
  }

  function relDay(date, today) {
    const n = diffDays(date, today);
    if (n == 0) return 'heute'; if (n == 1) return 'morgen'; if (n == -1) return 'gestern';
    return n < 0 ? `vor ${-n} Tagen` : `in ${n} Tagen`;
  }

  // ---------- iCalendar ----------
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  /// Zeilen nach RFC 5545 auf 75 Oktette falten (UTF-8, ohne Zeichen zu zerteilen)
  function fold(line) {
    const enc = new TextEncoder(), out = [];
    let cur = '', len = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
      cur += ch; len += n;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  /// Ganztägige Termine; uid bleibt je Objekt gleich, damit ein erneuter Import aktualisiert statt verdoppelt
  function toICS(items, {book = 'BioBook', now = new Date()} = {}) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BioBook//Faelligkeiten//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(`BioBook ${book}`)}`];
    for (const it of items) {
      const d = it.due.replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:${esc(it.uid)}@biobook`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(it.due, 1).replace(/-/g, '')}`,
        `SUMMARY:${esc(it.title)}`, ...(it.sub ? [`DESCRIPTION:${esc(it.sub)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  const Agenda = {parseDue, bucket, relDay, toICS, fold, addDays, iso};
  if (typeof module != 'undefined' && module.exports) module.exports = Agenda; else root.Agenda = Agenda;
})(this);

// ---------- Oberfläche ----------
const todayISO = () => Agenda.iso(new Date());
const AG_ICON = {task: '📝', device: '🔧', myco: '🧫', expiry: '⏳'};

if (typeof TT != 'undefined') {
  /// Termin in Checklisten-Punkten hervorheben (überfällig rot, heute orange); ändert den Inhalt nicht
  var DueDates = TT.Extension.create({
    name: 'duedates',
    addProseMirrorPlugins() {
      const key = new TT.PluginKey('duedates');
      const build = doc => {
        const decos = [], today = todayISO();
        doc.descendants((node, pos) => {
          if (node.type.name != 'taskItem') return;
          const p = node.firstChild; if (!p || !p.isTextblock) return false;
          const hit = Agenda.parseDue(p.textContent, today); if (!hit) return false;
          let off = 0;  // Textposition → Dokumentposition (über die Textknoten des Absatzes)
          p.forEach((child, cpos) => {
            if (!child.isText) { off += child.textContent.length; return; }
            const a = Math.max(hit.from, off), b = Math.min(hit.to, off + child.text.length);
            if (a < b) decos.push(TT.Decoration.inline(pos + 2 + cpos + a - off, pos + 2 + cpos + b - off,
              {class: `duedate ${node.attrs.checked ? 'done' : hit.date < today ? 'overdue' : hit.date == today ? 'today' : ''}`, title: `fällig ${Agenda.relDay(hit.date, today)} (${hit.date.split('-').reverse().join('.')})`}));
            off += child.text.length;
          });
          return false;
        });
        return TT.DecorationSet.create(doc, decos);
      };
      return [new TT.Plugin({key, state: {init: (_, s) => build(s.doc), apply: (tr, old) => tr.docChanged ? build(tr.doc) : old}, props: {decorations: s => key.getState(s)}})];
    },
  });
}

/// Checklisten-Punkte mit Datum (für die Übersicht; beim Speichern)
function collectTasks(doc) {
  const out = [], today = todayISO();
  const walk = n => {
    if (n.type == 'taskItem') {
      const text = (n.content?.[0]?.content || []).map(c => c.text || '').join('');
      const hit = Agenda.parseDue(text, today);
      if (hit) out.push({text, due: hit.date, done: !!n.attrs?.checked});
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}

async function refreshAgendaBadge() {
  const today = todayISO(), items = await call('agenda', {until: today, today});
  const b = $('#agendaBadge'), over = items.filter(i => i.due < today).length;
  b.hidden = !items.length; b.textContent = items.length; b.classList.toggle('soft', !over);
  b.title = `${over} überfällig, ${items.length - over} heute`;
  return items.length;
}

async function showAgenda() {
  await flush();
  showView('agenda'); navCur('agenda');
  const today = todayISO(), items = await call('agenda', {until: Agenda.addDays(today, 30), today});
  const g = Agenda.bucket(items, today);
  const sec = (k, title) => g[k].length ? `<h3 class="osec">${title} <span class="sub">${g[k].length}</span></h3><div class="aglist">${g[k].map(it => `
    <div class="agrow ${k}" data-agt="${it.t}" data-agid="${it.id}"><span class="agicon">${AG_ICON[it.kind] || '•'}</span>
      <span class="agdate">${it.due.split('-').reverse().join('.')}<br><span class="sub">${Agenda.relDay(it.due, today)}</span></span>
      <span class="agtext"><b>${esc(it.title)}</b>${it.sub ? `<br><span class="sub">${esc(it.sub)}</span>` : ''}</span></div>`).join('')}</div>` : '';
  $('#agenda').innerHTML = `<div class="reghead"><h2>📅 Fällig</h2><span class="sub">die nächsten 30 Tage</span><button class="btn" data-agics>Als Kalender (.ics) speichern</button></div>
    ${items.length ? sec('overdue', 'Überfällig') + sec('today', 'Heute') + sec('week', 'Diese Woche') + sec('later', 'Später') :
      '<div class="empty">Nichts fällig. Termine entstehen aus Checklisten mit Datum („bis Freitag“, „30.10.“), Geräteaufgaben, Mycoplasma-Tests und Ablaufdaten.</div>'}`;
  refreshAgendaBadge();
}

async function agendaICS() {
  const today = todayISO(), items = await call('agenda', {until: Agenda.addDays(today, 365), today}), book = await call('book');
  const r = await call('saveText', {name: T(`BioBook ${book.name} – fällig.ics`), text: Agenda.toICS(items, {book: book.name})});
  if (r) status(`${items.length} Termine gespeichert: ${r.path} – in Kalender per Doppelklick importieren`);
  return r;
}

/// Fälliges öffnen: Eintrag, Gerät, Kultur oder Charge
function openAgendaItem(t, id, title) {
  ({entry: () => { showView('doc'); cur = null; open(id, {find: title}); }, device: () => showDevice(id), culture: () => showCulture(id), lot: () => showLot(id)})[t]?.();
}

function initAgenda() {
  $('#agenda').addEventListener('click', e => {
    if (e.target.dataset.agics !== undefined) return agendaICS();
    const row = e.target.closest('[data-agt]'); if (!row) return;
    openAgendaItem(row.dataset.agt, +row.dataset.agid, row.querySelector('.agtext b')?.textContent);
  });
}
