// Sprachschicht: Die Quelltexte sind deutsch, Englisch kommt aus web/lang/en.json (Deutsch → Englisch).
// Schlüssel mit {0}, {1} … stehen für wechselnde Teile („{0} Einträge“); sie werden zu Mustern und die Treffer rekursiv übersetzt.
// Die Sprache setzt Swift vor dem Laden der Seite (window.UI_LANG = 'de' | 'en'). Übersetzt werden Textknoten, Attribute
// (title, placeholder, aria-label, alt, label), alert/confirm/prompt und der Fenstertitel. Nutzertexte im Editor bleiben unberührt.
// T(text) übersetzt einen Text von Hand (für Export-Dateien und andere Texte, die nie im DOM erscheinen).
(() => {
  const LANG = window.UI_LANG === 'en' ? 'en' : 'de';
  const SHADOW = LANG === 'de' && window.I18N_SHADOW === true;   // Abdeckungsprüfung: deutsch anzeigen, still gegen Englisch prüfen
  document.documentElement.lang = LANG;
  const exact = new Map(), pats = [], cache = new Map();
  const missed = new Set();   // Texte, für die es keine Übersetzung gab (Abdeckungsprüfung)
  const produced = new Set();   // bereits übersetzte (englische) Texte, die nicht als „unübersetzt“ zählen sollen
  const SKIP = '.ProseMirror, script, style, textarea, code, pre, [data-noi18n]';
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
  const PRE = /^([^\p{L}]+)([\s\S]+)$/u;                     // Symbole und Zahlen vor dem Text
  const SUF = /^([\s\S]*[\p{L}\p{N}])([^\p{L}\p{N}]+)$/u;   // Symbole nach dem Text
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function add(dict) {
    for (const [de, en] of Object.entries(dict)) {
      if (/\{\d+\}/.test(de)) {
        const parts = de.split(/\{\d+\}/);
        const re = new RegExp('^' + parts.map(esc).join('([\\s\\S]*?)') + '$');
        pats.push({re, en, weight: parts.join('').length});
      } else exact.set(de, en);
    }
    pats.sort((a, b) => b.weight - a.weight);   // das genauere Muster zuerst
    cache.clear();
  }

  function core(s) {
    const e = exact.get(s); if (e !== undefined) return e;
    for (const p of pats) { const m = p.re.exec(s); if (m) return p.en.replace(/\{(\d+)\}/g, (_, i) => T(m[+i + 1] ?? '')); }
    // Symbole und Zahlen vor oder nach dem Text („🔬 Antikörper“, „◆ 01 Explosiv“, „Filter ●“): nur den Text übersetzen
    const pre = PRE.exec(s);
    if (pre) { const inner = core(pre[2]); if (inner !== pre[2]) return pre[1] + inner; }
    const suf = SUF.exec(s);
    if (suf) { const inner = core(suf[1]); if (inner !== suf[1]) return inner + suf[2]; }
    // Teile mit „ · “ („Notiz · 07.11.2026 · 2 Rev.“): jedes Stück für sich
    if (s.includes(' · ')) { const out = s.split(' · ').map(p => T(p)).join(' · '); if (out !== s) return out; }
    if (s.includes('\n')) { const out = s.split('\n').map(l => T(l)).join('\n'); if (out !== s) return out; }
    return s;
  }

  function T(s) {
    if ((LANG !== 'en' && !SHADOW) || typeof s !== 'string' || !s) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), c = m[2];
    if (!c) return s;
    let r = cache.get(c);
    if (r === undefined) { r = core(c); cache.set(c, r); }
    if (r !== c) { produced.add(r); missed.delete(c); }
    else if (!produced.has(c) && /[A-Za-zÄÖÜäöüß]{2}/.test(c)) missed.add(c);
    return r === c || SHADOW ? s : m[1] + r + m[3];
  }

  const textNode = n => { const v = n.nodeValue, t = T(v); if (t !== v) n.nodeValue = t; };
  const attr = (el, a) => { const v = el.getAttribute(a); if (v) { const t = T(v); if (t !== v) el.setAttribute(a, t); } };

  function walk(root) {
    if (root.nodeType === 3) { if (!root.parentElement || !root.parentElement.closest(SKIP)) textNode(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    const els = [root];
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) textNode(n); else els.push(n); }
    for (const el of els) for (const a of ATTRS) if (el.hasAttribute(a)) attr(el, a);
  }

  let mo = null;
  function start() {
    if ((LANG !== 'en' && !SHADOW) || mo) return;
    walk(document.body); document.title = T(document.title);
    mo = new MutationObserver(list => {
      for (const r of list) {
        if (r.type === 'childList') r.addedNodes.forEach(n => walk(n));
        else if (r.type === 'characterData') { if (!r.target.parentElement || !r.target.parentElement.closest(SKIP)) textNode(r.target); }
        else if (r.type === 'attributes' && !r.target.closest(SKIP)) attr(r.target, r.attributeName);
      }
      mo.takeRecords();   // eigene Änderungen nicht noch einmal verarbeiten
    });
    mo.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS});
  }

  // Dialoge des Systems
  if (LANG === 'en') for (const f of ['alert', 'confirm', 'prompt']) {
    const orig = window[f].bind(window);
    window[f] = (msg, ...rest) => orig(T(String(msg ?? '')), ...rest);
  }

  const ready = (async () => {
    if (LANG !== 'en' && !SHADOW) return;
    try { add(await (await fetch('lang/en.json')).json()); } catch (e) { console.error('Übersetzung nicht geladen', e); }
  })();
  // bis die Übersetzung geladen ist, nichts Deutsches aufblitzen lassen
  if (LANG === 'en') { document.documentElement.classList.add('i18n-wait'); }
  ready.then(() => {
    const go = () => { start(); document.documentElement.classList.remove('i18n-wait'); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  });

  window.I18N = {
    lang: LANG, ready, add, T,
    locale: LANG === 'en' ? 'en-GB' : 'de-DE',
    untranslated() { return [...missed].filter(s => !produced.has(s)); },
  };
  window.T = T;
})();
