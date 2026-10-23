// Zellkultur (Kulturen, Passagen, Mycoplasma-Tests, Einfrierliste) und Gerätebuch (Aufgaben mit Fälligkeit, Protokoll); Passage-Block im Eintrag.
'use strict';

let cultTab = 'list', cultFilter = 'active', cultCur = null, devFilter = 'all', devCur = null;
const CWARN = {myco_pos: ['Mycoplasma positiv', 'bad'], myco_due: ['Mycoplasma-Test fällig', 'warn'], passage_high: ['Höchstpassage erreicht', 'warn']};
const DWARN = {defect: ['defekt', 'bad'], overdue: ['überfällig', 'bad'], due: ['bald fällig', 'warn']};
const CEV = {start: 'Angelegt', thaw: 'Aufgetaut', passage: 'Passage', medium: 'Mediumwechsel', myco: 'Mycoplasma-Test', freeze: 'Eingefroren',
  note: 'Notiz', correct: 'Korrektur', end: 'Beendet'};
const DTASK = {kalibrierung: 'Kalibrierung', wartung: 'Wartung', pruefung: 'Prüfung', reinigung: 'Reinigung'};
const DLOG = {...DTASK, stoerung: 'Störung', reparatur: 'Reparatur', notiz: 'Notiz'};
const DRES = {ok: 'ok', abweichung: 'mit Abweichung', defekt: 'defekt'};
const dday = d => d ? d.split('-').reverse().join('.') : '';
const today = () => new Date().toLocaleDateString('sv-SE');  // JJJJ-MM-TT in Ortszeit
const wb = (w, map) => (w || []).map(k => `<span class="wbadge ${map[k][1]}">${map[k][0]}</span>`).join(' ');
const navCur = k => document.querySelectorAll('#stockNav li').forEach(li => li.classList.toggle('cur', li.dataset.stock == k));

async function refreshCareBadges() {
  const n = await call('careWarnings');
  for (const [id, k, t] of [['#cultBadge', 'cultures', 'Kultur(en) mit fälligem Mycoplasma-Test, positivem Test oder hoher Passage'], ['#devBadge', 'devices', 'Gerät(e) mit fälliger Aufgabe oder defekt']]) {
    const b = $(id); b.hidden = !n[k]; b.textContent = n[k]; b.title = `${n[k]} ${t}`;
  }
  return n;
}

// ---------- Kulturen ----------
async function showCultures(tab = cultTab) {
  await flush();
  cultTab = tab; cultCur = null;
  showView('cult'); navCur('cult');
  return tab == 'frozen' ? renderFrozen() : renderCultures();
}

const cultTabs = () => `<div class="stabs"><button class="btn ${cultTab == 'list' ? 'on' : ''}" data-ctab="list">Kulturen</button>
  <button class="btn ${cultTab == 'frozen' ? 'on' : ''}" data-ctab="frozen">Einfrierliste</button></div>`;

async function renderCultures(q = $('#cultq')?.value || '') {
  const rows = await call('cultures', {filter: cultFilter, q});
  $('#cult').innerHTML = `<div class="reghead"><h2>🧫 Zellkultur</h2>${cultTabs()}
      <input id="cultq" type="search" placeholder="Kulturen suchen" value="${esc(q)}" autocomplete="off">
      <button class="btn ${cultFilter == 'warnings' ? 'on' : ''}" data-cfilter="${cultFilter == 'warnings' ? 'active' : 'warnings'}">⚠ Nur Warnungen</button>
      <button class="btn ${cultFilter == 'all' ? 'on' : ''}" data-cfilter="${cultFilter == 'all' ? 'active' : 'all'}">Beendete zeigen</button>
      <button class="btn on" data-cultnew>+ Kultur</button></div>
    ${rows.length ? `<table class="regtable"><tr><th>Nr.</th><th>Kultur</th><th>Zelllinie</th><th>Passage</th><th>Gefäß · Medium</th><th>Mycoplasma</th><th>Zuletzt</th><th></th></tr>
      ${rows.map(c => `<tr data-cult="${c.id}" class="${c.status != 'active' ? 'gone' : ''}"><td><code>${c.code}</code></td><td><b>${esc(c.name)}</b>${c.status != 'active' ? ' <span class="sub">beendet</span>' : ''}</td>
        <td>${c.entity_code ? `<code>${esc(c.entity_code)}</code> ${esc(c.entity_name)}` : ''}</td><td class="num"><b>P${c.passage}</b>${c.max_passage ? ` <span class="sub">/ ${c.max_passage}</span>` : ''}</td>
        <td>${esc([c.vessel, c.medium].filter(Boolean).join(' · '))}</td><td>${c.last_myco ? `${esc(c.last_myco.detail)} <span class="sub">${dday(c.last_myco.day)}</span>` : '<span class="sub">nie getestet</span>'}</td>
        <td>${dday(c.last_day)}</td><td>${wb(c.warnings, CWARN)}</td></tr>`).join('')}</table>`
      : `<div class="empty">${q || cultFilter == 'warnings' ? 'Nichts gefunden.' : 'Noch keine Kulturen. Mit <b>+ Kultur</b> anlegen oder aus der Einfrierliste auftauen.'}</div>`}`;
  const inp = $('#cultq');
  inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => renderCultures(inp.value).then(() => { const i = $('#cultq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 150); };
  refreshCareBadges();
}

async function renderFrozen() {
  const rows = await call('frozenStock');
  $('#cult').innerHTML = `<div class="reghead"><h2>🧫 Zellkultur</h2>${cultTabs()}</div>
    ${rows.length ? `<table class="regtable"><tr><th>Charge</th><th>Kultur</th><th>Passage</th><th>Eingefroren</th><th>Röhrchen</th><th>Standort</th><th></th></tr>
      ${rows.map(r => `<tr><td><code data-lot="${r.lot_id}" class="lnk">${r.lot_code}</code></td><td data-cult="${r.culture_id}" class="lnk"><code>${r.culture_code}</code> ${esc(r.culture_name)}</td>
        <td class="num">P${r.passage}</td><td>${dday(r.day)}</td><td class="num">${Calc.fmt(+r.amount)}</td>
        <td>${esc(r.location_path || '')}${r.position ? ` · <b>${esc(r.position)}</b>` : ''}</td><td><button class="btn" data-thaw="${r.lot_id}">Auftauen</button></td></tr>`).join('')}</table>`
      : '<div class="empty">Keine eingefrorenen Röhrchen. In einer Kultur mit <b>❄ Einfrieren</b> anlegen.</div>'}`;
}

async function thaw(lotId) {
  const r = (await call('frozenStock')).find(x => x.lot_id == lotId);
  const name = prompt(`Ein Röhrchen ${r ? `${r.culture_name} P${r.passage}` : ''} auftauen. Name der neuen Kultur:`, r ? `${r.culture_name} (aufgetaut ${dday(today())})` : '');
  if (name == null) return;
  try { const c = await call('thawCulture', {lot: lotId, name}); await showCulture(c.id); status(`Aufgetaut: ${c.code} ${c.name}, P${c.passage}`); }
  catch (e) { alert(e.message); }
}

async function showCulture(id, preset = {}) {
  await flush();
  cultCur = id;
  showView('cult'); navCur('cult');
  const c = id == 'new' ? null : await call('culture', {id});
  const v = c || preset;
  const ents = await call('entities', {});
  const zl = ents.filter(e => e.code.startsWith('ZL-'));
  const entList = zl.length ? zl : ents;
  const curEnt = ents.find(e => e.id == (v.entity_id ?? v.entity));
  const active = c?.status == 'active';
  $('#cult').innerHTML = `<div class="reghead"><button class="btn" data-ctab="list">← Kulturen</button>
      <h2>🧫 ${c ? `<code>${c.code}</code> ${esc(c.name)}` : 'Neue Kultur'}</h2>
      ${c ? `<span class="amtbig">P${c.passage}</span> ${c.status != 'active' ? '<span class="wbadge mut">beendet</span>' : ''} ${wb(c.warnings, CWARN)}<button class="btn" data-label="culture:${c.id}">🏷 Etikett</button>` : ''}</div>
    <div class="regdetail"><form id="cultform" class="regform">
      <label class="rf"><span>Name</span><input name="name" value="${esc(v.name || '')}" required autocomplete="off" placeholder="z. B. HeLa Flasche 1"></label>
      <label class="rf"><span>Zelllinie</span><div><input name="entity" list="cultents" value="${esc(curEnt ? `${curEnt.code} ${curEnt.name}` : '')}" placeholder="optional, z. B. ZL-0001" autocomplete="off">
        <datalist id="cultents">${entList.map(e => `<option value="${esc(`${e.code} ${e.name}`)}">`).join('')}</datalist></div></label>
      ${c ? '' : `<label class="rf"><span>Passage</span><input name="passage" value="${esc(v.passage ?? '0')}" inputmode="numeric"></label>
        <label class="rf"><span>Gestartet am</span><input name="day" type="date" value="${today()}"></label>`}
      <label class="rf"><span>Gefäß</span><input name="vessel" value="${esc(v.vessel || '')}" placeholder="z. B. T75, 6-Well"></label>
      <label class="rf"><span>Medium</span><input name="medium" value="${esc(v.medium || '')}" placeholder="z. B. DMEM + 10 % FKS"></label>
      <label class="rf"><span>Höchstpassage</span><input name="max_passage" value="${esc(v.max_passage ?? '')}" inputmode="numeric" placeholder="Warnung ab dieser Passage"></label>
      <label class="rf"><span>Mycoplasma-Test alle</span><div><input name="myco_days" value="${esc(v.myco_days ?? 90)}" inputmode="numeric" style="width:70px"> Tage</div></label>
      <label class="rf"><span>Notiz</span><textarea name="note" rows="2">${esc(v.note || '')}</textarea></label>
      <div class="rfbtns"><span id="cultmsg" class="sub"></span><button class="btn on" type="submit">${c ? 'Speichern' : 'Anlegen'}</button></div></form>
      ${c ? `<aside class="regside">
        ${active ? `<h4>Buchen</h4><div class="lotbtns"><button class="btn on" data-cev="passage">↻ Passage +1</button><button class="btn" data-cev="medium">Mediumwechsel</button>
          <button class="btn" data-cev="myco">Mycoplasma-Test</button><button class="btn" data-cev="freeze">❄ Einfrieren</button><button class="btn" data-cev="note">Notiz</button>
          <button class="btn" data-cev="correct">± Korrektur</button><button class="btn danger" data-cev="end">Beenden</button></div>` : ''}
        <h4>Verlauf</h4><ol class="reghist">${c.events.map(ev => `<li>${dday(ev.day)} · <b>${CEV[ev.kind] || ev.kind}</b> ${cultEvText(ev)}
          ${ev.entry_id ? `<br><a href="#" class="elink" data-entry="${ev.entry_id}">↗ ${esc(ev.entry_title || 'Eintrag')}</a>` : ''}${ev.note ? `<br><span class="sub">${esc(ev.note)}</span>` : ''}</li>`).join('')}</ol></aside>` : ''}
    </div>`;
  if (!c) $('#cultform [name=name]').focus();
}

function cultEvText(ev) {
  if (ev.kind == 'passage') return `P${ev.passage - 1} → P${ev.passage}${ev.detail ? ` (${esc(ev.detail)})` : ''}`;
  if (ev.kind == 'freeze') return `${esc(ev.detail)} P${ev.passage}${ev.lot_code ? ` → <code data-lot="${ev.lot_id}" class="lnk">${ev.lot_code}</code>` : ''}`;
  if (ev.kind == 'thaw') return `P${ev.passage}${ev.lot_code ? ` aus <code data-lot="${ev.lot_id}" class="lnk">${ev.lot_code}</code>` : ''}`;
  if (ev.kind == 'start') return `P${ev.passage}`;
  return esc(ev.detail || '');
}

async function saveCultureForm() {
  const f = $('#cultform'), g = n => f.querySelector(`[name=${n}]`)?.value ?? '';
  const ents = await call('entities', {});
  const t = g('entity').trim();
  const ent = t ? ents.find(e => `${e.code} ${e.name}` == t || e.code == t.split(' ')[0].toUpperCase()) : null;
  if (t && !ent) { $('#cultmsg').textContent = 'Zelllinie nicht gefunden'; return; }
  const values = {name: g('name'), vessel: g('vessel'), medium: g('medium'), max_passage: g('max_passage'), myco_days: g('myco_days'), note: g('note'),
    ...(ent ? {entity: ent.id} : {}), ...(cultCur == 'new' ? {passage: g('passage'), day: g('day')} : {})};
  try {
    const c = await call('saveCulture', {...(cultCur == 'new' ? {} : {id: cultCur}), values});
    await showCulture(c.id);
    $('#cultmsg').textContent = 'Gespeichert';
    refreshCareBadges();
    return c;
  } catch (e) { $('#cultmsg').textContent = e.message; $('#cultmsg').classList.add('bad'); }
}

/// Dialog für ein Kulturereignis; die Felder hängen von der Art ab
async function cultEventDialog(kind) {
  const c = await call('culture', {id: cultCur});
  const locs = kind == 'freeze' ? await call('locations') : [];
  const dlg = $('#locdlg');
  const fields = {
    passage: `<label class="rf"><span>Split</span><input id="ceSplit" placeholder="z. B. 1:10" autocomplete="off"></label>
      <label class="rf"><span>Neues Gefäß</span><input id="ceVessel" placeholder="${esc(c.vessel || 'unverändert')}"></label>`,
    myco: `<label class="rf"><span>Ergebnis</span><select id="ceResult"><option>negativ</option><option>positiv</option><option>unklar</option></select></label>`,
    freeze: `<label class="rf"><span>Röhrchen</span><input id="ceCount" value="3" inputmode="numeric" style="width:70px"></label>
      <label class="rf"><span>Standort</span><select id="ceLoc"><option value="">—</option>${locs.map(l => `<option value="${l.id}">${esc(l.path)}</option>`).join('')}</select></label>
      <label class="rf"><span>Position</span><input id="cePos" placeholder="z. B. A1 (nur in Boxen)" maxlength="3"></label>`,
    correct: `<label class="rf"><span>Richtige Passage</span><input id="cePassage" value="${c.passage}" inputmode="numeric" style="width:70px"></label>`,
  }[kind] || '';
  const title = {passage: `Passage P${c.passage} → P${c.passage + 1}`, end: 'Kultur beenden (verwerfen)', freeze: `Einfrieren (P${c.passage})`}[kind] || CEV[kind];
  dlg.innerHTML = `<form method="dialog"><h3>${esc(c.name)}: ${esc(title)}</h3>${fields}
    ${kind != 'correct' ? `<label class="rf"><span>Datum</span><input id="ceDay" type="date" value="${today()}"></label>` : ''}
    <label class="rf"><span>${kind == 'correct' ? 'Grund' : 'Notiz'}</span><input id="ceNote" autocomplete="off"></label>
    <p id="ceMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="ceSave">${kind == 'end' ? 'Beenden' : 'Verbuchen'}</button></div></form>`;
  dlg.showModal();
  const val = id => dlg.querySelector('#' + id)?.value ?? '';
  $('#ceSave').onclick = async () => {
    const values = {day: val('ceDay'), note: val('ceNote'), split: val('ceSplit'), vessel: val('ceVessel'), result: val('ceResult'), count: val('ceCount'),
      position: val('cePos'), passage: val('cePassage'), ...(val('ceLoc') ? {location: +val('ceLoc')} : {})};
    try {
      const r = await call('cultureEvent', {id: c.id, kind, values});
      dlg.close();
      await showCulture(c.id);
      status(kind == 'passage' ? `${c.code}: P${r.from} → P${r.passage} verbucht` : `${c.code}: ${CEV[kind]} verbucht`);
      refreshCareBadges();
      if (kind == 'freeze') refreshStockBadge();
    } catch (e) { $('#ceMsg').textContent = e.message; }
  };
}

/// Im Registry-Objekt (Zelllinie): ihre Kulturen
async function renderEntityCultures(entityId) {
  const box = document.querySelector('#entCults'); if (!box) return;
  const cs = await call('cultures', {filter: `entity:${entityId}`});
  box.innerHTML = cs.length ? `<h4>Kulturen</h4>${cs.map(c => `<div class="locrow" data-cult="${c.id}"><code>${c.code}</code> ${esc(c.name)} · <b>P${c.passage}</b> ${wb(c.warnings, CWARN)}</div>`).join('')}` : '';
}

// ---------- Geräte ----------
async function showDevices() {
  await flush();
  devCur = null;
  showView('dev'); navCur('dev');
  return renderDevices();
}

async function renderDevices(q = $('#devq')?.value || '') {
  const rows = await call('devices', {filter: devFilter, q});
  $('#dev').innerHTML = `<div class="reghead"><h2>🔧 Geräte</h2>
      <input id="devq" type="search" placeholder="Geräte suchen" value="${esc(q)}" autocomplete="off">
      <button class="btn ${devFilter == 'warnings' ? 'on' : ''}" data-dfilter="${devFilter == 'warnings' ? 'all' : 'warnings'}">⚠ Nur fällige</button>
      <button class="btn on" data-devnew>+ Gerät</button></div>
    ${rows.length ? `<table class="regtable"><tr><th>Nr.</th><th>Gerät</th><th>Modell · Seriennr.</th><th>Standort</th><th>Nächste Aufgabe</th><th></th></tr>
      ${rows.map(d => { const t = d.tasks[0];
        return `<tr data-dev="${d.id}"><td><code>${d.code}</code></td><td><b>${esc(d.name)}</b></td><td>${esc([d.model, d.serial && `SN ${d.serial}`].filter(Boolean).join(' · '))}</td>
        <td>${esc(d.location_path || '')}</td><td>${t ? `${esc(t.title)} <span class="sub">${dday(t.next_due)}</span>` : '<span class="sub">keine</span>'}</td><td>${wb(d.warnings, DWARN)}</td></tr>`; }).join('')}</table>`
      : `<div class="empty">${q || devFilter == 'warnings' ? 'Nichts fällig.' : 'Noch keine Geräte. Mit <b>+ Gerät</b> anlegen, dann Wartung und Kalibrierung mit Intervall eintragen.'}</div>`}`;
  const inp = $('#devq');
  inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => renderDevices(inp.value).then(() => { const i = $('#devq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 150); };
  refreshCareBadges();
}

async function showDevice(id) {
  await flush();
  devCur = id;
  showView('dev'); navCur('dev');
  const d = id == 'new' ? null : await call('device', {id});
  const v = d || {};
  const locs = await call('locations');
  $('#dev').innerHTML = `<div class="reghead"><button class="btn" data-devlist>← Geräte</button>
      <h2>🔧 ${d ? `<code>${d.code}</code> ${esc(d.name)}` : 'Neues Gerät'}</h2>
      ${d ? `${wb(d.warnings, DWARN)}<button class="btn" data-label="device:${d.id}">🏷 Etikett</button>` : ''}</div>
    <div class="regdetail"><form id="devform" class="regform">
      <label class="rf"><span>Name</span><input name="name" value="${esc(v.name || '')}" required autocomplete="off" placeholder="z. B. Zentrifuge 5424"></label>
      <label class="rf"><span>Modell</span><input name="model" value="${esc(v.model || '')}"></label>
      <label class="rf"><span>Seriennummer</span><input name="serial" value="${esc(v.serial || '')}"></label>
      <label class="rf"><span>Standort</span><select name="location"><option value="">—</option>${locs.map(x => `<option value="${x.id}" ${x.id == v.location_id ? 'selected' : ''}>${esc(x.path)}</option>`).join('')}</select></label>
      <label class="rf"><span>Notiz</span><textarea name="note" rows="2">${esc(v.note || '')}</textarea></label>
      <div class="rfbtns"><span id="devmsg" class="sub"></span><button class="btn on" type="submit">${d ? 'Speichern' : 'Anlegen'}</button></div></form>
      ${d ? `<aside class="regside">
        <h4>Wiederkehrende Aufgaben</h4>${d.tasks.length ? d.tasks.map(t => `<div class="task"><div class="grow"><b>${esc(t.title)}</b> ${wb(t.state ? [t.state] : [], DWARN)}<br>
          <span class="sub">alle ${t.interval_days} Tage · fällig ${dday(t.next_due)}</span></div>
          <button class="btn on" data-taskdone="${t.id}">✓ Erledigt</button><button class="x" data-taskedit="${t.id}" title="Bearbeiten">✎</button><button class="x" data-taskdel="${t.id}" title="Entfernen">×</button></div>`).join('')
          : '<p class="sub">Keine. Zum Beispiel Kalibrierung alle 365 Tage.</p>'}
        <button class="btn" data-tasknew>+ Aufgabe</button>
        <h4>Protokoll</h4><div class="lotbtns"><button class="btn danger" data-dlog="stoerung">Störung melden</button><button class="btn" data-dlog="reparatur">Reparatur</button><button class="btn" data-dlog="notiz">Notiz</button></div>
        <ol class="reghist">${d.log.map(g => `<li>${dday(g.day)} · <b>${esc(g.task_title || DLOG[g.kind] || g.kind)}</b>${g.result != 'ok' ? ` <span class="wbadge ${g.result == 'defekt' ? 'bad' : 'warn'}">${DRES[g.result]}</span>` : ''}
          ${g.entry_id ? `<br><a href="#" class="elink" data-entry="${g.entry_id}">↗ ${esc(g.entry_title || 'Eintrag')}</a>` : ''}${g.note ? `<br><span class="sub">${esc(g.note)}</span>` : ''}</li>`).join('')}</ol></aside>` : ''}
    </div>`;
  if (!d) $('#devform [name=name]').focus();
}

async function saveDeviceForm() {
  const f = $('#devform'), g = n => f.querySelector(`[name=${n}]`)?.value ?? '';
  const values = {name: g('name'), model: g('model'), serial: g('serial'), note: g('note'), ...(g('location') ? {location: +g('location')} : {})};
  try {
    const d = await call('saveDevice', {...(devCur == 'new' ? {} : {id: devCur}), values});
    await showDevice(d.id);
    $('#devmsg').textContent = 'Gespeichert';
    return d;
  } catch (e) { $('#devmsg').textContent = e.message; $('#devmsg').classList.add('bad'); }
}

async function taskDialog(task) {
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>${task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h3>
    <label class="rf"><span>Art</span><select id="tKind">${Object.entries(DTASK).map(([k, t]) => `<option value="${k}" ${k == task?.kind ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="rf"><span>Bezeichnung</span><input id="tTitle" value="${esc(task?.title || '')}" placeholder="optional, z. B. Kalibrierung extern (DAkkS)"></label>
    <label class="rf"><span>Intervall</span><div><input id="tInt" value="${task?.interval_days ?? 365}" inputmode="numeric" style="width:70px"> Tage</div></label>
    <label class="rf"><span>Nächste Fälligkeit</span><input id="tDue" type="date" value="${esc(task?.next_due || '')}"></label>
    <p class="sub">Leer: heute + Intervall. Nach „Erledigt“ rechnet das Laborbuch die nächste Fälligkeit selbst aus.</p>
    <p id="tMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="tSave">Sichern</button></div></form>`;
  dlg.showModal();
  $('#tSave').onclick = async () => {
    try {
      await call('saveDeviceTask', {...(task ? {id: task.id} : {}), device: devCur, values: {kind: $('#tKind').value, title: $('#tTitle').value, interval: $('#tInt').value, next_due: $('#tDue').value}});
      dlg.close(); await showDevice(devCur); refreshCareBadges();
    } catch (e) { $('#tMsg').textContent = e.message; }
  };
}

/// Protokoll: Aufgabe erledigt (task) oder Störung/Reparatur/Notiz (kind)
async function deviceLogDialog({task, kind}) {
  const d = await call('device', {id: devCur});
  const t = task && d.tasks.find(x => x.id == task);
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>${esc(d.name)}: ${esc(t ? `${t.title} erledigt` : DLOG[kind])}</h3>
    ${t ? `<label class="rf"><span>Ergebnis</span><select id="gRes">${Object.entries(DRES).map(([k, x]) => `<option value="${k}">${x}</option>`).join('')}</select></label>` : ''}
    <label class="rf"><span>Datum</span><input id="gDay" type="date" value="${today()}"></label>
    <label class="rf"><span>${kind == 'stoerung' ? 'Was ist passiert?' : 'Notiz'}</span><input id="gNote" autocomplete="off" placeholder="${t?.kind == 'kalibrierung' ? 'z. B. Zertifikat Nr., Abweichung' : ''}"></label>
    <p id="gMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="gSave">Eintragen</button></div></form>`;
  dlg.showModal();
  $('#gSave').onclick = async () => {
    try {
      const r = await call('logDevice', {id: d.id, ...(t ? {task: t.id, result: $('#gRes').value} : {kind}), values: {day: $('#gDay').value, note: $('#gNote').value}});
      dlg.close(); await showDevice(d.id); refreshCareBadges();
      status(r.next_due ? `${t.title} eingetragen, nächste Fälligkeit ${dday(r.next_due)}` : `${DLOG[r.kind]} eingetragen`);
    } catch (e) { $('#gMsg').textContent = e.message; }
  };
}

// ---------- Passage-Block im Eintrag ----------
/// Kulturereignis aus dem Eintrag buchen (Passage, Mediumwechsel, Mycoplasma-Test); das Ereignis verweist auf den Eintrag. Unveränderlich.
const CultureNode = TT.Node.create({
  name: 'cultev', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({
    culture: {default: null}, kind: {default: 'passage'}, split: {default: ''}, result: {default: 'negativ'},
    event: {default: null}, label: {default: ''}, from: {default: null}, passage: {default: null}, day: {default: null},
  }),
  parseHTML: () => [{tag: 'div[data-cultev]', getAttrs: el => JSON.parse(el.getAttribute('data-cultev') || '{}')}],
  renderHTML: ({node}) => ['div', {'data-cultev': JSON.stringify(node.attrs)}, cultBlockText(node.attrs)],
  renderText: ({node}) => cultBlockText(node.attrs),
  addNodeView: () => ({node, getPos, editor}) => {
    let cur = node;
    const dom = document.createElement('div');
    dom.className = 'usage cultev'; dom.contentEditable = 'false';
    const set = attrs => { const pos = getPos(); if (typeof pos == 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {...cur.attrs, ...attrs})); };
    async function render() {
      const a = cur.attrs;
      if (a.event || !editor.isEditable) { dom.innerHTML = `<span class="ui">🧫</span><span class="grow">${esc(cultBlockText(a))}</span>`; return; }
      const cs = await call('cultures', {});
      dom.innerHTML = `<span class="ui">🧫 Zellkultur</span>
        <select data-cult>${cs.length ? '<option value="">Kultur wählen …</option>' : '<option value="">keine aktive Kultur</option>'}${cs.map(c => `<option value="${c.id}" ${c.id == a.culture ? 'selected' : ''}>${esc(`${c.code} ${c.name} – P${c.passage}`)}</option>`).join('')}</select>
        <select data-ckind>${['passage', 'medium', 'myco'].map(k => `<option value="${k}" ${k == a.kind ? 'selected' : ''}>${CEV[k]}</option>`).join('')}</select>
        ${a.kind == 'passage' ? `<input data-csplit value="${esc(a.split)}" placeholder="Split, z. B. 1:10" style="width:110px">` : ''}
        ${a.kind == 'myco' ? `<select data-cres>${['negativ', 'positiv', 'unklar'].map(r => `<option ${r == a.result ? 'selected' : ''}>${r}</option>`).join('')}</select>` : ''}
        <button class="btn on" data-cbook ${a.culture ? '' : 'disabled'}>Verbuchen</button><span class="umsg bad"></span>`;
    }
    dom.addEventListener('change', e => {
      const d = e.target.dataset;
      if (d.cult !== undefined) set({culture: +e.target.value || null});
      else if (d.ckind !== undefined) set({kind: e.target.value});
      else if (d.cres !== undefined) set({result: e.target.value});
      else if (d.csplit !== undefined) set({split: e.target.value});
    });
    dom.addEventListener('click', async e => {
      if (e.target.dataset.cbook === undefined) return;
      const a = cur.attrs, msg = dom.querySelector('.umsg');
      const split = dom.querySelector('[data-csplit]')?.value ?? a.split, result = dom.querySelector('[data-cres]')?.value ?? a.result;
      try {
        await flush();
        const r = await call('cultureEvent', {id: a.culture, kind: a.kind, values: {split, result}, entry: cur_entry()});
        set({split, result, event: r.event, from: r.from, passage: r.passage, day: r.day, label: `${r.code} ${r.name}`});
        await flush();
        refreshCareBadges();
      } catch (err) { msg.textContent = err.message; }
    });
    render();
    return {dom, update: n => { if (n.type.name != 'cultev') return false; const changed = JSON.stringify(n.attrs) != JSON.stringify(cur.attrs); cur = n; if (changed) render(); return true; },
      stopEvent: e => !!e.target.closest?.('input, select, button'), ignoreMutation: () => true};
  },
});

function cultBlockText(a) {
  if (!a.event) return `Zellkultur: ${CEV[a.kind] || a.kind} (noch nicht gebucht)`;
  const what = a.kind == 'passage' ? `Passage P${a.from} → P${a.passage}${a.split ? ` (${a.split})` : ''}`
    : a.kind == 'myco' ? `Mycoplasma-Test ${a.result}` : CEV[a.kind];
  return `✓ ${a.label}: ${what} verbucht ${dday(a.day)}`;
}

function insertCultureBlock() { editor.chain().focus().insertContent([{type: 'cultev'}, {type: 'paragraph'}]).run(); }

// ---------- Ereignisse ----------
function initCulture() {
  $('#cult').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.ctab) return showCultures(d.ctab);
    if (d.cfilter) { cultFilter = d.cfilter; return renderCultures(); }
    if (d.cultnew !== undefined) return showCulture('new');
    if (d.cev) {
      if (d.cev == 'end' && !confirm('Kultur beenden? Danach lassen sich keine Ereignisse mehr buchen.')) return;
      return cultEventDialog(d.cev);
    }
    if (d.thaw) return thaw(+d.thaw);
    const lot = e.target.closest('[data-lot]'); if (lot) return showLot(+lot.dataset.lot);
    const c = e.target.closest('[data-cult]'); if (c) return showCulture(+c.dataset.cult);
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; return open(+a.dataset.entry); }
  });
  $('#cult').addEventListener('submit', e => { e.preventDefault(); saveCultureForm(); });
  $('#dev').addEventListener('click', async e => {
    const d = e.target.dataset;
    if (d.devlist !== undefined) return showDevices();
    if (d.dfilter) { devFilter = d.dfilter; return renderDevices(); }
    if (d.devnew !== undefined) return showDevice('new');
    if (d.tasknew !== undefined) return taskDialog(null);
    if (d.taskedit) return taskDialog((await call('device', {id: devCur})).tasks.find(t => t.id == d.taskedit));
    if (d.taskdel) { if (confirm('Aufgabe entfernen? Das Protokoll bleibt erhalten.')) { await call('archiveDeviceTask', {id: +d.taskdel}); await showDevice(devCur); refreshCareBadges(); } return; }
    if (d.taskdone) return deviceLogDialog({task: +d.taskdone});
    if (d.dlog) return deviceLogDialog({kind: d.dlog});
    const row = e.target.closest('[data-dev]'); if (row) return showDevice(+row.dataset.dev);
    const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; return open(+a.dataset.entry); }
  });
  $('#dev').addEventListener('submit', e => { e.preventDefault(); saveDeviceForm(); });
  $('#reg').addEventListener('click', e => { const c = e.target.closest('[data-cult]'); if (c) showCulture(+c.dataset.cult); });
}
