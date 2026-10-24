// Farbschemata: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const {THEMES, contrast, ids, valid} = require('../web/themes.js');

const VARS = ['--bg', '--side', '--ink', '--mut', '--line', '--acc', '--accfg', '--sel', '--code'];

test('jedes Schema setzt alle Farben als #rrggbb', () => {
  for (const [id, t] of Object.entries(THEMES)) {
    if (!t.vars) continue;
    assert.deepEqual(Object.keys(t.vars).sort(), [...VARS].sort(), id);
    for (const v of Object.values(t.vars)) assert.match(v, /^#[0-9a-f]{6}$/i, `${id}: ${v}`);
  }
});

test('Kontraste sind lesbar (WCAG AA)', () => {
  for (const [id, t] of Object.entries(THEMES)) {
    if (!t.vars) continue;
    const v = t.vars, check = (a, b, min, what) => assert.ok(contrast(a, b) >= min, `${id}: ${what} ${contrast(a, b).toFixed(2)} < ${min}`);
    check(v['--ink'], v['--bg'], 7, 'Text auf Hintergrund');
    check(v['--ink'], v['--side'], 7, 'Text auf Seitenleiste');
    check(v['--ink'], v['--sel'], 6, 'Text auf Auswahl');
    check(v['--mut'], v['--bg'], 4.5, 'gedämpfter Text auf Hintergrund');
    check(v['--mut'], v['--side'], 4.2, 'gedämpfter Text auf Seitenleiste');
    check(v['--accfg'], v['--acc'], 4.5, 'Schrift auf Akzentfarbe');
    check(v['--acc'], v['--bg'], 3, 'Akzent auf Hintergrund');
  }
});

test('Hell/Dunkel stimmt mit dem Hintergrund überein', () => {
  for (const [id, t] of Object.entries(THEMES)) {
    if (!t.vars) continue;
    const dark = contrast(t.vars['--bg'], '#000000') < contrast(t.vars['--bg'], '#ffffff');
    assert.equal(!!t.dark, dark, id);
  }
});

test('Namen und Gültigkeit', () => {
  assert.ok(ids.length >= 12 && valid('nord') && valid('system') && !valid('nope') && !valid('__proto__'));
  assert.ok(Object.values(THEMES).every(t => t.name.length > 2));
});
