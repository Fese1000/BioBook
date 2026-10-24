// Seitenleiste: Abschnitte lassen sich einklappen (Zustand bleibt). Der Kalender ist eine eigene Ansicht (calendar.js).

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
  if (!window.TESTING) try { localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch {}  // der Selbsttest soll den gemerkten Zustand nicht verstellen
}

function initFolds() {
  const st = foldState();
  document.querySelectorAll('.sec[data-fold]').forEach(sec => {
    sec.tabIndex = 0; sec.setAttribute('role', 'button');
    setFolded(sec, !!st[sec.dataset.fold]);
  });
}
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

}
