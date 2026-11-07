// Sprachschicht: node --test tests/
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

function load(lang) {
  const sent = [];
  const win = {UI_LANG: lang, alert: m => sent.push(['alert', m]), confirm: m => (sent.push(['confirm', m]), true), prompt: m => (sent.push(['prompt', m]), ''), console};
  win.window = win;
  win.document = {documentElement: {classList: {add() {}, remove() {}}}, readyState: 'loading', addEventListener() {}, body: null};
  win.fetch = async () => ({json: async () => ({})});
  win.Node = {}; win.NodeFilter = {};
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/i18n.js'), 'utf8'), win);
  return {I18N: win.I18N, T: win.T, win, sent};
}

test('Deutsch: Texte bleiben unverändert', async () => {
  const {I18N, T} = load('de');
  I18N.add({'Neuer Eintrag': 'New entry'});
  assert.equal(T('Neuer Eintrag'), 'Neuer Eintrag');
  assert.equal(I18N.locale, 'de-DE');
});

test('Englisch: exakte Treffer, Leerraum bleibt, Muster mit Platzhaltern', async () => {
  const {I18N, T} = load('en');
  I18N.add({'Neuer Eintrag': 'New entry', '{0} Einträge': '{0} entries', 'Eintrag Nr. {0} · Revision {1}': 'Entry no. {0} · Revision {1}', 'fertig': 'done', 'Status: {0}': 'Status: {0}'});
  assert.equal(T('Neuer Eintrag'), 'New entry');
  assert.equal(T('  Neuer Eintrag \n'), '  New entry \n');
  assert.equal(T('3 Einträge'), '3 entries');
  assert.equal(T('Eintrag Nr. 7 · Revision 2'), 'Entry no. 7 · Revision 2');
  assert.equal(T('Status: fertig'), 'Status: done', 'Treffer im Muster werden selbst übersetzt');
  assert.equal(T('Zeile\nNeuer Eintrag'), 'Zeile\nNew entry', 'mehrzeilig: Zeile für Zeile');
  assert.equal(T('Unbekannt'), 'Unbekannt');
  assert.equal(T(''), '');
  assert.equal(T(null), null);
  assert.equal(I18N.locale, 'en-GB');
});

test('Englisch: das genauere Muster gewinnt', async () => {
  const {I18N, T} = load('en');
  I18N.add({'{0} gelöscht': '{0} deleted', '{0} gelöscht, {1} bleiben': '{0} deleted, {1} remain'});
  assert.equal(T('3 gelöscht, 2 bleiben'), '3 deleted, 2 remain');
  assert.equal(T('3 gelöscht'), '3 deleted');
});

test('Englisch: alert, confirm und prompt werden übersetzt', async () => {
  const {I18N, win, sent} = load('en');
  I18N.add({'Wirklich löschen?': 'Really delete?'});
  win.alert('Wirklich löschen?'); win.confirm('Wirklich löschen?'); win.prompt('Wirklich löschen?');
  assert.deepEqual(sent.map(s => s[1]), ['Really delete?', 'Really delete?', 'Really delete?']);
});

test('Sonderzeichen im Schlüssel sind kein Muster-Fehler', async () => {
  const {I18N, T} = load('en');
  I18N.add({'Kosten (€) [je Probe] + $5 ^ *': 'Cost (€) [per sample] + $5 ^ *'});
  assert.equal(T('Kosten (€) [je Probe] + $5 ^ *'), 'Cost (€) [per sample] + $5 ^ *');
});

test('Englisch: Symbole davor und danach und Teile mit · werden einzeln übersetzt', async () => {
  const {I18N, T} = load('en');
  I18N.add({'Antikörper': 'Antibody', 'Explosiv': 'Explosive', 'Filter': 'Filters', 'Notiz': 'Note', '{0} Rev.': '{0} rev.', 'Hell': 'Light'});
  assert.equal(T('🔬 Antikörper'), '🔬 Antibody');
  assert.equal(T('☑ 📅 Antikörper'), '☑ 📅 Antibody');
  assert.equal(T('◆ 01 Explosiv'), '◆ 01 Explosive');
  assert.equal(T('Filter ●'), 'Filters ●');
  assert.equal(T('Hell ○'), 'Light ○');
  assert.equal(T('Notiz · 07.11.2026, 22:48 · 2 Rev.'), 'Note · 07.11.2026, 22:48 · 2 rev.');
  assert.equal(T('↗ Mein eigener Titel'), '↗ Mein eigener Titel', 'unbekannter Text bleibt');
  I18N.add({'Einwaage (Masse = c · V)': 'Weighing (mass = c · V)'});
  assert.equal(T('🧮 Einwaage (Masse = c · V)'), '🧮 Weighing (mass = c · V)', 'schließende Klammer gehört zum Text');
});

test('Verfolgung: übersetzte und unübersetzte Texte werden unterschieden', async () => {
  const {I18N, T} = load('en');
  I18N.add({'Speichern': 'Save'});
  T('Speichern'); T('Noch nicht übersetzt'); T('Save');
  assert.deepEqual(I18N.untranslated(), ['Noch nicht übersetzt'], 'der englische Text zählt nicht als unübersetzt');
});

test('Wörterbuch: gültiges JSON, Platzhalter links und rechts gleich, keine leeren Werte', () => {
  const f = path.join(__dirname, '../web/lang/en.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [de, en] of Object.entries(d)) {
    assert.ok(typeof en === 'string' && en.trim(), `leerer Wert für „${de}“`);
    const a = (de.match(/\{\d+\}/g) || []).sort().join(), b = (en.match(/\{\d+\}/g) || []).sort().join();
    assert.equal(a, b, `Platzhalter weichen ab: „${de}“ → „${en}“`);
  }
});
