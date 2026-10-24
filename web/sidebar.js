// Seitenleiste: Abschnitte lassen sich einklappen (Zustand bleibt), dazu ein Monatskalender.
// Ein Klick auf einen Tag zeigt in der Liste die Einträge dieses Tages (Zeitraum-Filter), ein zweiter Klick hebt das auf.
// Punkt = Einträge an dem Tag, Strich = mehrere, rotes Quadrat = etwas ist fällig (aus „📅 Fällig“).

const FOLD_KEY = 'laborbuch.fold';
const foldState = () => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; } };

function setFolded(sec, folded) {
  document.querySelectorAll(sec.dataset.target).forEach(el => el.classList.toggle('folded', folded));
  sec.classList.toggle('closed', folded);
  sec.setAttribute('aria-expanded', String(!folded));
}

function toggleFold(sec) {
  const folded = !sec.classList.contains('closed');
  setFolded(sec, folded);
  const st = foldState(); st[sec.dataset.fold] = folded;
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch {}
  if (sec.dataset.fold == 'cal' && !folded) SIDECAL.draw();
}

function initFolds() {
  const st = foldState();
  document.querySelectorAll('.sec[data-fold]').forEach(sec => {
    sec.tabIndex = 0; sec.setAttribute('role', 'button');
    setFolded(sec, !!st[sec.dataset.fold]);
  });
}
// ---------- Kalender ----------
const SIDECAL = {
  year: new Date().getFullYear(), month: new Date().getMonth(), rows: [], due: {}, timer: null, seq: 0,
  /// nach Änderungen an der Liste: Daten neu holen, aber gebündelt
  touch() { clearTimeout(this.timer); this.timer = setTimeout(() => this.load(), 400); },
  async load() {
    const seq = ++this.seq;
    if ($('#sidecal').classList.contains('folded')) return;
    const grid = SideCal.monthGrid(this.year, this.month), last = grid.at(-1).days.at(-1).iso;
    const [rows, due] = await Promise.all([call('list', {}), call('agenda', {until: last, today: todayISO()}).catch(() => [])]);
    if (seq != this.seq) return;  // inzwischen ein neuerer Monat
    this.rows = rows; this.due = {};
    for (const it of due) (this.due[it.due] ||= []).push(it.title);
    this.draw();
  },
  draw() {
    const grid = SideCal.monthGrid(this.year, this.month), today = todayISO();
    const marks = SideCal.markDays(this.rows, grid[0].days[0].iso, grid.at(-1).days.at(-1).iso);
    const sel = LISTF.from && LISTF.from == LISTF.to ? LISTF.from : '';
    $('#sidecal').innerHTML = `<div class="calhead"><button data-calmove="-12" title="Vorjahr">«</button><button data-calmove="-1" title="Voriger Monat">‹</button>
      <b>${SideCal.label(this.year, this.month)}</b><button data-calmove="1" title="Nächster Monat">›</button><button data-calmove="12" title="Nächstes Jahr">»</button></div>
      <div class="calgrid"><span class="kw">KW</span>${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="wd">${w}</span>`).join('')}
      ${grid.map(w => `<span class="kw">${w.week}</span>` + w.days.map(d => {
        const n = marks[d.iso] || 0, due = this.due[d.iso];
        const tip = [n ? `${n} Eintrag${n == 1 ? '' : 'e'}` : '', due ? `fällig: ${due.slice(0, 3).join(', ')}${due.length > 3 ? ' …' : ''}` : ''].filter(Boolean).join(' · ');
        return `<button class="d ${d.inMonth ? '' : 'other'} ${d.iso == today ? 'today' : ''} ${d.iso == sel ? 'sel' : ''} ${n ? 'has' : ''} ${n > 2 ? 'many' : ''} ${due ? 'due' : ''}" data-calday="${d.iso}" ${tip ? `title="${esc(tip)}"` : ''}>${d.day}</button>`;
      }).join('')).join('')}</div>
      <div class="calfoot"><span>${sel ? 'Liste zeigt ' + Days.dayLabel(sel).replace(/^[^,]+, /, '') : ''}</span><button class="link" data-caltoday>Heute</button></div>`;
  },
  move(by) {
    const m = SideCal.shiftMonth(this.year, this.month, by); this.year = m.year; this.month = m.month;
    this.draw(); this.load();
  },
};

/// erst von start() aufgerufen: `$`, LISTF und refreshList gibt es beim Laden dieser Datei noch nicht
function initSidebar() {
  initFolds();
  document.querySelector('aside').addEventListener('click', e => {
    const sec = e.target.closest('.sec[data-fold]');
    if (sec && !e.target.closest('button')) toggleFold(sec);
  });
  document.querySelector('aside').addEventListener('keydown', e => {
    const sec = e.target.closest?.('.sec[data-fold]');
    if (sec && e.target == sec && (e.key == 'Enter' || e.key == ' ')) { e.preventDefault(); toggleFold(sec); }
  });

  $('#sidecal').addEventListener('click', e => {
    const mv = e.target.closest('[data-calmove]'), day = e.target.closest('[data-calday]');
    if (mv) return SIDECAL.move(+mv.dataset.calmove);
    if (e.target.closest('[data-caltoday]')) { const t = new Date(); SIDECAL.year = t.getFullYear(); SIDECAL.month = t.getMonth(); SIDECAL.draw(); return SIDECAL.load(); }
    if (!day) return;
    const iso = day.dataset.calday, again = LISTF.from == iso && LISTF.to == iso;
    Object.assign(LISTF, again ? {from: '', to: ''} : {from: iso, to: iso});
    SIDECAL.draw();  // sofort sichtbar, die Liste folgt
    if (!again && day.classList.contains('other')) { const [y, m] = iso.split('-').map(Number); SIDECAL.year = y; SIDECAL.month = m - 1; SIDECAL.load(); }
    refreshList();
  });
  SIDECAL.load();
}
