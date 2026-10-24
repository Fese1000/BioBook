// Einstellungen der Oberfläche (liegen im Buch): Farbschema, „Neuer Tab beim Öffnen aus der Seitenleiste“, ausgeblendete Reiter.
// „Reiter“ der Registry lassen sich ausblenden und über das Menü ⋯ wieder einblenden – nichts geht verloren.

let PREFS = {};
const NAV_TABS = {agenda: '📅 Fällig', lots: '📦 Bestand', orders: '🛒 Bestellungen', cult: '🧫 Zellkultur', dev: '🔧 Geräte', lit: '📚 Literatur', ask: '✨ Fragen', analysis: '📊 Auswertung'};

async function loadPrefs() {
  PREFS = await call('prefs').catch(() => ({}));
  applyPrefs();
}

function applyTheme(id) {
  const root = document.documentElement, t = Themes.valid(id) ? Themes.THEMES[id] : Themes.THEMES.system;
  for (const k of Object.keys(Themes.THEMES.hell.vars)) root.style.removeProperty(k);
  root.style.colorScheme = t.vars ? (t.dark ? 'dark' : 'light') : '';
  if (t.vars) for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.dataset.theme = Themes.valid(id) ? id : 'system';
}

const hiddenTabs = () => new Set((PREFS.hiddenTabs || '').split(',').filter(Boolean));
const tabsOnOpen = () => PREFS.newtab != 'off';

function applyPrefs() {
  applyTheme(PREFS.theme || 'system');
  const hid = hiddenTabs();
  document.querySelectorAll('#stockNav li[data-stock]').forEach(li => li.classList.toggle('tabhidden', hid.has(li.dataset.stock)));
}

async function savePref(key, value) {
  PREFS[key] = value;
  await call('setPref', {key, value});
  applyPrefs();
}

async function setTabHidden(key, hide) {
  const s = hiddenTabs(); hide ? s.add(key) : s.delete(key);
  await savePref('hiddenTabs', [...s].join(','));
}

/// Menü ⋯ an der Registry: alle Reiter mit Haken, dazu archivierte Typen zum Zurückholen
function tabsMenu(btn) {
  const hid = hiddenTabs(), archived = (typeof regTypes != 'undefined' ? regTypes : []).filter(t => t.archived);
  popMenu(btn, `<div class="sub" style="padding:4px 10px">Reiter ein- und ausblenden</div>
    ${Object.entries(NAV_TABS).map(([k, t]) => `<div class="opt" data-tabkey="${k}">${hid.has(k) ? '☐' : '☑'} ${esc(t)}</div>`).join('')}
    ${archived.length ? `<div class="sub" style="padding:8px 10px 4px">Archivierte Typen</div>${archived.map(t => `<div class="opt" data-typeback="${t.id}">↺ ${esc(t.icon)} ${esc(t.name)}</div>`).join('')}` : ''}
    ${hid.size ? '<div class="opt" data-tabsall>Alle Reiter einblenden</div>' : ''}`, el => el.addEventListener('mousedown', async e => {
    const o = e.target.closest('[data-tabkey],[data-typeback],[data-tabsall]'); if (!o) return;
    e.preventDefault(); el.close();
    if (o.dataset.tabkey) await setTabHidden(o.dataset.tabkey, !hid.has(o.dataset.tabkey));
    else if (o.dataset.typeback) { await call('archiveType', {id: +o.dataset.typeback, archived: false}); await loadTypes(); }
    else await savePref('hiddenTabs', '');
  }));
}

// ---------- Neuer Tab beim Öffnen aus der Seitenleiste ----------
let TARGET = '';  // was dieser Tab gerade zeigt („entry:12“, „view:agenda“, „type:3“); leer = noch nichts

function reportTarget(spec) { TARGET = spec; call('setTarget', {spec}).catch(() => {}); }

/// Öffnet `spec` in einem neuen Tab, wenn die Einstellung an ist und dieser Tab schon etwas zeigt; sonst läuft `local` hier.
/// Im Selbsttest bleibt alles im selben Tab, außer `window.TEST_TABS` ist gesetzt.
async function openFromSidebar(spec, local) {
  if (tabsOnOpen() && TARGET && TARGET != spec && (!window.TESTING || window.TEST_TABS)) { await flush(); return call('openTarget', {spec}); }
  return local();
}

/// Beim Start eines Tabs mit ?open=…
async function openSpec(spec) {
  const [kind, arg] = String(spec).split(':');
  if (kind == 'entry') return open(+arg);
  if (kind == 'type') return showType(+arg);
  if (kind == 'view') return openView(arg);
}

function openView(k) {
  ({analysis: showAnalysis, orders: showOrders, lit: () => showLiterature(null), agenda: showAgenda, calendar: showCalendar, ask: showAsk,
    cult: () => showCultures('list'), dev: showDevices, lots: () => showStock('lots')})[k]?.();
}

// ---------- Hinweisleiste (Updates, fehlgeschlagene Sicherung) ----------
/// text ist reiner Text; actions: [{label, run, primary}] – jede Schaltfläche schließt die Leiste
function notice(text, actions = []) {
  const bar = $('#noticebar');
  bar.innerHTML = `<span class="ntext">${esc(text)}</span>${actions.map((a, i) => `<button class="btn ${a.primary ? 'on' : ''}" data-nact="${i}">${esc(a.label)}</button>`).join('')}<button class="btn nclose" data-nact="x" title="Schließen" aria-label="Schließen">✕</button>`;
  bar.hidden = false;
  bar.onclick = async e => {
    const b = e.target.closest('[data-nact]'); if (!b) return;
    bar.hidden = true;
    if (b.dataset.nact != 'x') await actions[+b.dataset.nact].run?.();
  };
}

/// Das Update, das beim leisen Prüfen gefunden wurde (oder null)
async function updateAvailable() {
  const u = await call('pendingUpdate').catch(() => null);
  if (!u || PREFS.updateSkip == u.latest) return;
  notice(`Version ${u.latest} ist verfügbar (du hast ${u.current}).`, [
    u.canInstall ? {label: 'Jetzt aktualisieren', primary: true, run: async () => {
      if (!confirm('Update laden, prüfen und die App neu starten? Dein Stand wird vorher gespeichert.')) return;
      await flush();
      try { await call('updateInstall'); } catch (e) { notice('Update fehlgeschlagen: ' + e.message); }
    }} : {label: 'Einstellungen', primary: true, run: () => showSettings()},
    {label: 'Später'},
    {label: 'Diese Version überspringen', run: () => savePref('updateSkip', u.latest)}]);
}
