// Ansicht „📅 Kalender“: Monat oder Woche, rechts der gewählte Tag. Zeigt geplante Termine und Experimente (frei anlegbar, per Ziehen
// verschiebbar), Einträge mit Tagesabschnitt und Fälliges. Zu einem Plan lässt sich der Eintrag mit passendem Tag anlegen.

const CAL = {mode: 'month', anchor: null, sel: null, plans: [], rows: [], due: [], form: null, seq: 0};
const CAL_KIND = {termin: ['Termin', '🗓'], experiment: ['Experiment', '🧪']};

const calRange = () => CAL.mode == 'week'
  ? (w => [w[0], w[6]])(SideCal.weekOf(CAL.anchor))
  : (g => [g[0].days[0].iso, g.at(-1).days.at(-1).iso])(SideCal.monthGrid(+CAL.anchor.slice(0, 4), +CAL.anchor.slice(5, 7) - 1));

async function showCalendar() {
  await flush();
  CAL.anchor ||= todayISO();
  showView('calendar'); navCur('calendar');
  await calLoad();
}

async function calLoad() {
  const seq = ++CAL.seq, [from, to] = calRange();
  const [plans, rows, due] = await Promise.all([call('plans', {from, to}), call('list', {}), call('agenda', {until: to, today: todayISO()}).catch(() => [])]);
  if (seq != CAL.seq) return;
  Object.assign(CAL, {plans, rows, due: due.filter(d => d.due >= from)});
  calDraw();
}

/// Alles, was an einem Tag steht, in Anzeigereihenfolge: Pläne (nach Uhrzeit), Fälliges, Einträge
function calItems() {
  const [from, to] = calRange();
  const plans = SideCal.spread(CAL.plans, p => p.day, p => p.day_end, from, to);
  // lange Spannen (Laufendes BioBook) nur am ersten und letzten Tag zeigen, sonst steht der Eintrag in jeder Zelle
  const ends = (r, i) => (a => a.length ? a[i] : '')(SideCal.entrySpan(r)), long = r => SideCal.entrySpan(r).length && SideCal.entrySpan(r)[0] && Math.round((SideCal.parse(ends(r, 1)) - SideCal.parse(ends(r, 0))) / 86400000) > 3;
  const ents = SideCal.spread(CAL.rows.flatMap(r => long(r) ? [{...r, _at: ends(r, 0)}, {...r, _at: ends(r, 1)}] : [r]), r => r._at || SideCal.entrySpan(r)[0], r => r._at || SideCal.entrySpan(r)[1], from, to);
  const due = {}; for (const d of CAL.due) (due[d.due] ||= []).push(d);
  return {plans, ents, due};
}

function calChip(kind, it) {
  if (kind == 'plan') return `<div class="cchip plan ${it.kind} ${it.done ? 'done' : ''}" draggable="true" data-cplan="${it.id}" title="${esc(it.title)}${it.note ? '\n' + esc(it.note) : ''}">${it.time_from ? `<b>${esc(it.time_from)}</b> ` : ''}${esc(it.title)}</div>`;
  if (kind == 'due') return `<div class="cchip due" data-agt="${it.t}" data-agid="${it.id}" title="fällig">${AG_ICON[it.kind] || '•'} ${esc(it.title)}</div>`;
  return `<div class="cchip entry" data-centry="${it.id}" title="${esc(it.title || 'Ohne Titel')}">📄 ${esc(it.title || 'Ohne Titel')}</div>`;
}

function calDraw() {
  const today = todayISO(), [from] = calRange(), items = calItems();
  const week = CAL.mode == 'week', y = +CAL.anchor.slice(0, 4), m = +CAL.anchor.slice(5, 7) - 1;
  const days = week ? SideCal.weekOf(CAL.anchor).map(iso => ({iso, day: +iso.slice(8), inMonth: true})) : SideCal.monthGrid(y, m).flatMap(w => w.days);
  const title = week ? `KW ${SideCal.isoWeek(SideCal.parse(SideCal.weekOf(CAL.anchor)[3]))} · ${Days.rangeLabel(SideCal.weekOf(CAL.anchor)[0], SideCal.weekOf(CAL.anchor)[6])}` : SideCal.label(y, m);
  const label = d => week ? new Date(+d.iso.slice(0, 4), +d.iso.slice(5, 7) - 1, d.day).toLocaleDateString('de-DE', {weekday: 'short', day: 'numeric', month: 'numeric'})
    : d.day == 1 ? `1. ${SideCal.MONTHS[+d.iso.slice(5, 7) - 1].slice(0, 3)}` : String(d.day);
  const cell = d => {
    const all = [...(items.plans[d.iso] || []).map(p => ['plan', p]), ...(items.due[d.iso] || []).map(x => ['due', x]), ...(items.ents[d.iso] || []).map(r => ['entry', r])];
    const shown = week ? all : all.slice(0, 3);
    return `<div class="ccell ${d.inMonth ? '' : 'other'} ${d.iso == today ? 'today' : ''} ${d.iso == CAL.sel ? 'sel' : ''}" data-cday="${d.iso}">
      <div class="cnum"><span>${label(d)}</span><button class="cadd" data-cnew="${d.iso}" title="Termin oder Experiment planen">+</button></div>
      ${shown.map(([k, it]) => calChip(k, it)).join('')}${all.length > shown.length ? `<div class="cmore">+ ${all.length - shown.length} weitere</div>` : ''}</div>`;
  };
  $('#calendar').innerHTML = `<div class="calbar"><h2>📅 Kalender</h2>
      <div class="seg"><button class="btn ${week ? '' : 'on'}" data-cmode="month">Monat</button><button class="btn ${week ? 'on' : ''}" data-cmode="week">Woche</button></div>
      <div class="seg"><button class="btn" data-cmove="-1" title="Zurück">‹</button><button class="btn" data-ctoday>Heute</button><button class="btn" data-cmove="1" title="Weiter">›</button></div>
      <b class="caltitle">${esc(title)}</b>
      <span class="grow"></span><button class="btn on" data-cnew="${CAL.sel || today}">+ Planen</button></div>
    <div class="calmain"><div class="calbody ${week ? 'week' : ''}">
      ${week ? '' : `<div class="calwd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span>${w}</span>`).join('')}</div>`}
      <div class="calcells ${week ? 'week' : ''}">${days.map(cell).join('')}</div></div>
      <div class="calside" id="calside"></div></div>`;
  calDrawSide(items);
}

function calDrawSide(items = calItems()) {
  const box = $('#calside'); if (!box) return;
  if (CAL.form) return calDrawForm(box);
  const d = CAL.sel;
  if (!d) { box.innerHTML = '<p class="sub">Tag anklicken, um Termine, Experimente und Einträge zu sehen. Mit „+“ im Tag oder „+ Planen“ etwas einplanen; Pläne lassen sich auf einen anderen Tag ziehen.</p>'; return; }
  const plans = items.plans[d] || [], ents = items.ents[d] || [], due = items.due[d] || [];
  box.innerHTML = `<h3>${esc(Days.dayLabel(d))}</h3>
    <p class="row"><button class="btn on" data-cnew="${d}" data-ckind="termin">+ Termin</button><button class="btn" data-cnew="${d}" data-ckind="experiment">+ Experiment</button></p>
    ${plans.map(p => `<div class="cplan ${p.kind} ${p.done ? 'done' : ''}" data-cplanrow="${p.id}">
      <label class="cpt"><input type="checkbox" data-cdone="${p.id}" ${p.done ? 'checked' : ''}> <b>${CAL_KIND[p.kind][1]} ${esc(p.title)}</b></label>
      <div class="sub">${p.time_from ? esc(p.time_from) + (p.time_to ? '–' + esc(p.time_to) : '') + ' Uhr' : 'ganztägig'}${p.day_end ? ` · ${Days.rangeLabel(p.day, p.day_end)}` : ''}</div>
      ${p.note ? `<div class="cnote">${esc(p.note)}</div>` : ''}
      ${p.entry_id ? `<div class="cent"><a href="#" class="elink" data-entry="${p.entry_id}">↗ ${esc(p.entry_title || 'Eintrag')}</a></div>` : ''}
      <div class="cpb"><button class="btn" data-cedit="${p.id}">Ändern</button>
        <button class="btn" data-centryfor="${p.id}">${p.entry_id ? '📄 Eintrag öffnen' : '📄 Eintrag anlegen'}</button><button class="btn danger" data-cdel="${p.id}" title="Plan löschen (ein Eintrag bleibt)">🗑</button></div></div>`).join('')}
    ${due.length ? `<h4>Fällig</h4><div class="aglist">${due.map(x => `<div class="agrow" data-agt="${x.t}" data-agid="${x.id}"><span class="agicon">${AG_ICON[x.kind] || '•'}</span><span class="agtext"><b>${esc(x.title)}</b>${x.sub ? `<br><span class="sub">${esc(x.sub)}</span>` : ''}</span></div>`).join('')}</div>` : ''}
    ${ents.length ? `<h4>Einträge</h4>${ents.map(r => `<div class="cent"><a href="#" class="elink" data-entry="${r.id}">↗ ${esc(r.title || 'Ohne Titel')}</a></div>`).join('')}` : ''}
    ${plans.length || due.length || ents.length ? '' : '<p class="sub">An diesem Tag ist nichts eingetragen.</p>'}`;
}

function calDrawForm(box) {
  const f = CAL.form;
  box.innerHTML = `<h3>${f.id ? 'Plan ändern' : 'Neu planen'}</h3>
    <div class="cform"><input id="cfTitle" placeholder="Titel, z. B. Transfektion HeLa" value="${esc(f.title)}" autocomplete="off">
      <div class="row"><label><input type="radio" name="cfKind" value="termin" ${f.kind == 'termin' ? 'checked' : ''}> 🗓 Termin</label><label><input type="radio" name="cfKind" value="experiment" ${f.kind == 'experiment' ? 'checked' : ''}> 🧪 Experiment</label></div>
      <label>Tag <input id="cfDay" type="date" value="${esc(f.day)}"></label>
      <label>bis (mehrtägig) <input id="cfEnd" type="date" value="${esc(f.day_end)}"></label>
      <div class="row"><label>von <input id="cfFrom" type="time" value="${esc(f.time_from)}"></label><label>bis <input id="cfTo" type="time" value="${esc(f.time_to)}"></label></div>
      <textarea id="cfNote" rows="4" placeholder="Notiz (kommt in den Eintrag, wenn du ihn anlegst)">${esc(f.note)}</textarea>
      <fieldset class="cflink"><legend>Eintrag dazu</legend>
        <label class="inl"><input type="radio" name="cfLink" value="none" ${f.link == 'none' ? 'checked' : ''}> keiner</label>
        <label class="inl"><input type="radio" name="cfLink" value="link" ${f.link == 'link' ? 'checked' : ''}> vorhandenen verlinken</label>
        <input id="cfEntry" list="cfEntries" placeholder="Eintrag suchen …" value="${esc(f.entryLabel)}" autocomplete="off" ${f.link == 'link' ? '' : 'hidden'}>
        <datalist id="cfEntries">${CAL.rows.map(r => `<option value="${esc(calEntryLabel(r))}"></option>`).join('')}</datalist>
        ${f.id && f.entry_id ? '' : `<label class="inl"><input type="radio" name="cfLink" value="new" ${f.link == 'new' ? 'checked' : ''}> neuen Eintrag anlegen (mit Tagesabschnitt und Notiz)</label>`}
      </fieldset>
      <p class="sub bad" id="cfMsg" role="alert"></p>
      <div class="row"><button class="btn on" id="cfSave">${f.id ? 'Sichern' : 'Planen'}</button><button class="btn" id="cfCancel">Abbrechen</button></div></div>`;
  $('#cfTitle').focus();
}

/// „Titel · #12“ – die Nummer macht gleiche Titel unterscheidbar und wird beim Speichern wieder gelesen
const calEntryLabel = r => `${r.title || 'Ohne Titel'} · #${r.id}`;

function calOpenForm(day, kind, plan) {
  const linked = plan?.entry_id && CAL.rows.find(r => r.id == plan.entry_id);
  CAL.form = plan ? {id: plan.id, title: plan.title, kind: plan.kind, day: plan.day, day_end: plan.day_end, time_from: plan.time_from, time_to: plan.time_to, note: plan.note, done: !!plan.done,
      entry_id: plan.entry_id || null, link: plan.entry_id ? 'link' : 'none', entryLabel: linked ? calEntryLabel(linked) : plan.entry_id ? `${plan.entry_title || ''} · #${plan.entry_id}` : ''}
    : {id: null, title: '', kind: kind || 'termin', day, day_end: '', time_from: '', time_to: '', note: '', done: false, entry_id: null, link: 'none', entryLabel: ''};
  CAL.sel = day; calDraw();
}

async function calSaveForm() {
  const f = CAL.form, kindEl = document.querySelector('input[name=cfKind]:checked');
  const mode = document.querySelector('input[name=cfLink]:checked')?.value || 'none';
  const values = {title: $('#cfTitle').value, kind: kindEl?.value || 'termin', day: $('#cfDay').value, day_end: $('#cfEnd').value, time_from: $('#cfFrom').value, time_to: $('#cfTo').value, note: $('#cfNote').value, done: f.done, entry_id: null};
  if (mode == 'link') {
    const id = +($('#cfEntry').value.match(/#(\d+)\s*$/)?.[1] || 0);
    if (!id) { $('#cfMsg').textContent = 'Bitte einen Eintrag aus der Liste wählen (oder „keiner“).'; return; }
    values.entry_id = id;
  }
  let planId;
  try { planId = await call('savePlan', {id: f.id, values}); } catch (e) { $('#cfMsg').textContent = e.message; return; }
  if (mode == 'new') await call('planEntry', {id: planId});  // nur wenn gewünscht
  CAL.form = null; CAL.sel = values.day; await calLoad();
  if (mode == 'new') { const id = CAL.plans.find(p => p.id == planId)?.entry_id; if (id) { showView('doc'); cur = null; await open(id); await refreshList(); } }
}

async function calMovePlan(id, to) {
  const p = CAL.plans.find(x => x.id == id); if (!p || p.day == to) return;
  const span = p.day_end ? Math.round((SideCal.parse(p.day_end) - SideCal.parse(p.day)) / 86400000) : 0;
  await call('savePlan', {id, values: {...p, day: to, day_end: span ? SideCal.addDays(to, span) : '', done: !!p.done}});
  CAL.sel = to; await calLoad();
}

function initCalendar() {
  const root = $('#calendar');
  root.addEventListener('click', async e => {
    const t = e.target, d = id => t.closest(`[${id}]`);
    if (t.closest('a.elink')) { e.preventDefault(); showView('doc'); cur = null; return open(+t.closest('a.elink').dataset.entry); }
    if (d('data-cmode')) { CAL.mode = d('data-cmode').dataset.cmode; CAL.anchor = CAL.sel || CAL.anchor; return calLoad(); }
    if (d('data-cmove')) {
      const by = +d('data-cmove').dataset.cmove;
      CAL.anchor = CAL.mode == 'week' ? SideCal.addDays(CAL.anchor, 7 * by) : (x => `${x.year}-${String(x.month + 1).padStart(2, '0')}-01`)(SideCal.shiftMonth(+CAL.anchor.slice(0, 4), +CAL.anchor.slice(5, 7) - 1, by));
      return calLoad();
    }
    if (d('data-ctoday')) { CAL.anchor = CAL.sel = todayISO(); return calLoad(); }
    if (d('data-cnew')) { const b = d('data-cnew'); return calOpenForm(b.dataset.cnew, b.dataset.ckind, null); }
    if (d('data-cedit')) return calOpenForm(CAL.sel, null, CAL.plans.find(p => p.id == d('data-cedit').dataset.cedit));
    if (d('data-cdel')) { if (!confirm('Diesen Plan löschen? Ein angelegter Eintrag bleibt erhalten.')) return; await call('deletePlan', {id: +d('data-cdel').dataset.cdel}); return calLoad(); }
    if (d('data-centryfor')) { const id = await call('planEntry', {id: +d('data-centryfor').dataset.centryfor}); showView('doc'); cur = null; await open(id); return refreshList(); }
    if (t.id == 'cfSave') return calSaveForm();
    if (t.id == 'cfCancel') { CAL.form = null; return calDrawSide(); }
    if (t.dataset.cdone) { await call('planDone', {id: +t.dataset.cdone, done: t.checked}); return calLoad(); }
    const due = d('data-agt'); if (due) return openAgendaItem(due.dataset.agt, +due.dataset.agid, due.querySelector('b')?.textContent || due.textContent.trim());
    const ent = d('data-centry'); if (ent) { showView('doc'); cur = null; return open(+ent.dataset.centry); }
    const plan = d('data-cplan'); if (plan) { CAL.sel = plan.closest('[data-cday]').dataset.cday; return calDraw(); }
    const cell = d('data-cday'); if (cell) { CAL.sel = cell.dataset.cday; CAL.form = null; calDraw(); }
  });
  root.addEventListener('dblclick', e => { const c = e.target.closest('.ccell'); if (c && !e.target.closest('.cchip')) calOpenForm(c.dataset.cday, 'termin', null); });
  root.addEventListener('change', e => { if (e.target.name == 'cfLink') { $('#cfEntry').hidden = e.target.value != 'link'; if (e.target.value == 'link') $('#cfEntry').focus(); } });
  root.addEventListener('keydown', e => { if (e.key == 'Enter' && e.target.id == 'cfTitle') { e.preventDefault(); calSaveForm(); } if (e.key == 'Escape' && CAL.form) { CAL.form = null; calDrawSide(); } });
  root.addEventListener('dragstart', e => { const p = e.target.closest('[data-cplan]'); if (p) { e.dataTransfer.setData('text/plan', p.dataset.cplan); e.dataTransfer.effectAllowed = 'move'; } });
  root.addEventListener('dragover', e => { if (e.target.closest('.ccell') && e.dataTransfer.types.includes('text/plan')) { e.preventDefault(); } });
  root.addEventListener('drop', e => { const c = e.target.closest('.ccell'), id = e.dataTransfer.getData('text/plan'); if (c && id) { e.preventDefault(); calMovePlan(+id, c.dataset.cday); } });
}
