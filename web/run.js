// Ausführungsmodus: ein Protokoll Schritt für Schritt abarbeiten, mit Zeitstempel je Schritt, Notizen und Timern.
// Der Lauf liegt in der Datenbank (übersteht Neustarts); am Ende wird ein Ablaufprotokoll an den Eintrag angehängt.
'use strict';

let RUN = null;     // {id, entry, title, started, steps: [text], done: {no: {done_at, note}}, pos}
let TIMERS = [];    // {id, label, end, total, notified}
let timerTick = null;

/// Schritte aus dem Dokument: Checklisten- und nummerierte Punkte; gibt es keine, alle Absätze und Aufzählungspunkte
function extractSteps(doc) {
  const text = n => (n.content || []).map(c => c.type == 'text' ? c.text : c.type == 'mention' ? c.attrs.label : c.content ? text(c) : '').join('');
  const strict = [], loose = [];
  const walk = (n, inOrdered) => {
    if (n.type == 'taskItem' || (n.type == 'listItem' && inOrdered)) {
      const first = (n.content || []).find(c => c.type == 'paragraph');
      const t = first ? text(first).trim() : '';
      if (t) strict.push(t);
    }
    if ((n.type == 'paragraph' || n.type == 'heading') && text(n).trim()) loose.push(text(n).trim());
    (n.content || []).forEach(c => walk(c, n.type == 'orderedList' ? true : n.type == 'bulletList' || n.type == 'taskList' ? false : inOrdered));
  };
  walk(doc, false);
  return strict.length ? strict : loose;
}

const hhmm = iso => new Date(iso).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'});
const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };
const since = (a, b) => clock((new Date(b) - new Date(a)) / 1000);

async function startRun() {
  if (!cur || preview) return;
  await flush();
  const steps = extractSteps(editor.getJSON());
  if (!steps.length) return alert('Keine Schritte gefunden. Schreib die Schritte als nummerierte Liste oder Checkliste.');
  const id = await call('startRun', {entry: cur, steps});
  await resumeRun();
  return id;
}

/// Laufenden Lauf des offenen Eintrags laden und anzeigen
async function resumeRun() {
  const r = await call('activeRun', {entry: cur});
  if (!r) return;
  const done = Object.fromEntries(r.done.map(d => [d.step_no, d]));
  const steps = JSON.parse(r.steps_json);
  const firstOpen = steps.findIndex((_, i) => !done[i + 1]);
  RUN = {id: r.id, entry: cur, title: $('#title').value, started: r.started, steps, done, pos: firstOpen < 0 ? steps.length - 1 : firstOpen};
  $('#run').hidden = false;
  renderRun();
  if (!timerTick) timerTick = setInterval(tickTimers, 250);
}

function renderRun() {
  if (!RUN) return;
  const {steps, done, pos} = RUN, n = steps.length, d = done[pos + 1];
  const dur = Calc.duration(steps[pos]);
  const count = Object.keys(done).length;
  $('#run').innerHTML = `<div class="rhead"><b>▶ ${esc(RUN.title || 'Lauf')}</b><span>gestartet ${hhmm(RUN.started)} · ${count} von ${n} erledigt</span>
      <span class="grow"></span><button class="btn" data-rhide title="Lauf läuft weiter (Esc)">Ausblenden</button>
      <button class="btn" data-rabort>Abbrechen</button><button class="btn on" data-rfinish>Lauf beenden</button></div>
    <div id="timers"></div>
    <div class="rmain">
      <ol class="rlist">${steps.map((s, i) => `<li class="${i == pos ? 'cur' : ''} ${done[i + 1] ? 'done' : ''}" data-rgo="${i}"><span>${esc(s)}</span>${done[i + 1] ? `<small>${hhmm(done[i + 1].done_at)}</small>` : ''}</li>`).join('')}</ol>
      <div class="rstep">
        <div class="rnum">Schritt ${pos + 1} von ${n}</div>
        <div class="rtext">${esc(steps[pos])}</div>
        ${d ? `<div class="rdone">✓ erledigt um ${hhmm(d.done_at)} (${since(RUN.started, d.done_at)} nach Start)${d.note ? ` · ${esc(d.note)}` : ''}</div>`
          : `<input id="rnote" placeholder="Notiz oder Abweichung (optional)" autocomplete="off">
             <div class="rbtns"><button class="btn on big" data-rdone>✓ Erledigt <small>Leertaste</small></button>
             ${dur ? `<button class="btn big" data-rtimer="${dur}">⏱ ${clock(dur)} starten</button>` : ''}</div>`}
        <div class="rnav"><button class="btn" data-rprev ${pos == 0 ? 'disabled' : ''}>← Zurück</button><button class="btn" data-rnext ${pos == n - 1 ? 'disabled' : ''}>Weiter →</button></div>
      </div>
    </div>`;
  renderTimers();
}

function renderTimers() {
  const el = document.querySelector('#timers');
  if (!el) return;
  const now = Date.now();
  el.innerHTML = TIMERS.map(t => { const left = (t.end - now) / 1000;
    return `<span class="timer ${left <= 0 ? 'over' : ''}" title="${esc(t.label)}">⏱ ${left > 0 ? clock(left) : 'fertig'} · ${esc(t.label.slice(0, 40))}<button data-tdel="${t.id}" title="Timer entfernen">×</button></span>`; }).join('');
}

function tickTimers() {
  const now = Date.now();
  for (const t of TIMERS) if (!t.notified && t.end <= now) { t.notified = true; call('notify').catch(() => {}); }
  renderTimers();
  if (!TIMERS.length && !RUN) { clearInterval(timerTick); timerTick = null; }
}

async function doneStep() {
  if (!RUN || RUN.done[RUN.pos + 1]) return;
  const note = document.querySelector('#rnote')?.value.trim() || '';
  const d = await call('completeStep', {run: RUN.id, step: RUN.pos + 1, note});
  RUN.done[RUN.pos + 1] = d;
  const next = RUN.steps.findIndex((_, i) => i > RUN.pos && !RUN.done[i + 1]);
  if (next >= 0) RUN.pos = next;
  renderRun();
}

/// Lauf beenden: Ablaufprotokoll als Tabelle an den Eintrag hängen und eine Revision sichern
async function finishRun(aborted) {
  if (!RUN) return;
  const openCount = RUN.steps.length - Object.keys(RUN.done).length;
  if (!aborted && openCount && !confirm(`${openCount} Schritt(e) sind nicht erledigt. Lauf trotzdem beenden?`)) return;
  if (aborted && !confirm('Lauf abbrechen? Das Ablaufprotokoll wird trotzdem angehängt.')) return;
  const r = await call('finishRun', {run: RUN.id, aborted});
  const done = Object.fromEntries(r.done.map(d => [d.step_no, d]));
  const day = new Date(r.started).toLocaleDateString('de-DE', {dateStyle: 'medium'});
  const cell = t => ({type: 'tableCell', content: [{type: 'paragraph', content: t ? [{type: 'text', text: String(t)}] : []}]});
  const head = t => ({type: 'tableHeader', content: [{type: 'paragraph', content: [{type: 'text', text: t}]}]});
  const rows = RUN.steps.map((s, i) => ({type: 'tableRow', content: [cell(`${i + 1}. ${s}`), cell(done[i + 1] ? hhmm(done[i + 1].done_at) : '—'),
    cell(done[i + 1] ? since(r.started, done[i + 1].done_at) : ''), cell(done[i + 1]?.note || '')]}));
  const block = [
    {type: 'heading', attrs: {level: 3}, content: [{type: 'text', text: `Ablaufprotokoll ${day}, ${hhmm(r.started)}–${hhmm(r.finished)}${aborted ? ' (abgebrochen)' : ''}`}]},
    {type: 'table', content: [{type: 'tableRow', content: [head('Schritt'), head('Erledigt'), head('seit Start'), head('Notiz')]}, ...rows]},
    {type: 'paragraph', content: [{type: 'text', text: `${Object.keys(done).length} von ${RUN.steps.length} Schritten erledigt.`}]},
  ];
  closeRun();
  if (cur != r.entry_id) await open(r.entry_id);
  editor.chain().insertContentAt(editor.state.doc.content.size, block).run();
  changed();
  await snapshot(true);
  status(aborted ? 'Lauf abgebrochen, Ablaufprotokoll angehängt' : 'Lauf beendet, Ablaufprotokoll angehängt');
}

function closeRun() { TIMERS = TIMERS.filter(t => !t.notified); RUN = null; $('#run').hidden = true; $('#run').innerHTML = ''; updateRunBar(); }
function hideRun() { RUN = null; $('#run').hidden = true; updateRunBar(); }

/// Hinweis über dem Eintrag, wenn ein Lauf offen ist, der gerade nicht angezeigt wird
async function updateRunBar() {
  const r = cur && !preview ? await call('activeRun', {entry: cur}) : null;
  $('#runbar').hidden = !r || !!RUN;
  if (r) $('#runbar').innerHTML = `<span class="grow">▶ Lauf läuft seit ${hhmm(r.started)} · ${r.done.length} von ${JSON.parse(r.steps_json).length} Schritten erledigt</span><button class="btn on" data-rresume>Fortsetzen</button>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, li[data-rgo]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.rdone !== undefined) doneStep();
  else if (ds.rtimer) { TIMERS.push({id: Date.now(), label: RUN?.steps[RUN.pos] || 'Timer', end: Date.now() + ds.rtimer * 1000, total: +ds.rtimer, notified: false});
    if (!timerTick) timerTick = setInterval(tickTimers, 250); renderTimers(); }
  else if (ds.tdel) { TIMERS = TIMERS.filter(x => x.id != ds.tdel); renderTimers(); }
  else if (ds.rprev !== undefined && RUN) { RUN.pos--; renderRun(); }
  else if (ds.rnext !== undefined && RUN) { RUN.pos++; renderRun(); }
  else if (ds.rgo !== undefined && RUN) { RUN.pos = +ds.rgo; renderRun(); }
  else if (ds.rfinish !== undefined) finishRun(false);
  else if (ds.rabort !== undefined) finishRun(true);
  else if (ds.rhide !== undefined) hideRun();
  else if (ds.rresume !== undefined) resumeRun().then(updateRunBar);
});

document.addEventListener('keydown', e => {
  if (!RUN || $('#run').hidden) return;
  if (e.key == 'Escape') { e.preventDefault(); hideRun(); }
  else if (e.key == ' ' && e.target.id != 'rnote' && e.target.tagName != 'INPUT') { e.preventDefault(); doneStep(); }
  else if (e.key == 'Enter' && e.target.id == 'rnote') { e.preventDefault(); doneStep(); }
  else if (e.key == 'ArrowRight' && e.target.tagName != 'INPUT' && RUN.pos < RUN.steps.length - 1) { RUN.pos++; renderRun(); }
  else if (e.key == 'ArrowLeft' && e.target.tagName != 'INPUT' && RUN.pos > 0) { RUN.pos--; renderRun(); }
});
