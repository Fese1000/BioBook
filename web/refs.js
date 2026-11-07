// Literatur: Quellen lesen (BibTeX, RIS, Crossref/CSL-JSON, PubMed) und schreiben, Kurz- und Vollzitat.
// Reine Funktionen oben (tests/refs.test.js); Bibliothek, Zitat im Eintrag und Literaturliste darunter.
(function (root) {
  'use strict';

  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const LATEX = [[/\\"\{?a\}?/g, 'ä'], [/\\"\{?o\}?/g, 'ö'], [/\\"\{?u\}?/g, 'ü'], [/\\"\{?A\}?/g, 'Ä'], [/\\"\{?O\}?/g, 'Ö'], [/\\"\{?U\}?/g, 'Ü'],
    [/\\ss\b\{?\}?/g, 'ß'], [/\\'\{?e\}?/g, 'é'], [/\\`\{?e\}?/g, 'è'], [/\\'\{?a\}?/g, 'á'], [/\\c\{?c\}?/g, 'ç'], [/\\&/g, '&'], [/~/g, ' '], [/---/g, '—'], [/--/g, '–']];
  const delatex = s => LATEX.reduce((t, [re, r]) => t.replace(re, r), String(s)).replace(/[{}]/g, '');

  /// „Nachname, Vorname“, „Vorname Nachname“ oder „{Konsortium}“ → {family, given}
  function parseName(n) {
    const s = clean(n);
    if (/^\{.*\}$/.test(s)) return {family: delatex(s), given: ''};
    if (s.includes(',')) { const [f, g] = s.split(/,\s*/); return {family: delatex(f), given: delatex(g || '')}; }
    const parts = delatex(s).split(' ');
    return parts.length == 1 ? {family: parts[0], given: ''} : {family: parts.pop(), given: parts.join(' ')};
  }

  /// PubMed-Form „Yanisch-Perron C“ → {family, given}
  const pubmedName = n => { const m = /^(.*?)\s+([A-Z]{1,4})$/.exec(clean(n)); return m ? {family: m[1], given: m[2].split('').join('. ') + '.'} : {family: clean(n), given: ''}; };

  /// „103-19“ (PubMed-Kurzform) → „103–119“
  function fullPages(p) {
    const m = /^(\d+)\s*[-–]+\s*(\d+)$/.exec(p);
    if (!m) return p.replace(/-+/g, '–');
    const [, a, b] = m;
    return `${a}–${b.length < a.length ? a.slice(0, a.length - b.length) + b : b}`;
  }

  function norm(r) {
    const out = {type: r.type || 'article', title: clean(r.title), authors: (r.authors || []).filter(a => a.family || a.given), year: r.year ? String(r.year).slice(0, 4) : '',
      journal: clean(r.journal), volume: clean(r.volume), issue: clean(r.issue), pages: fullPages(clean(r.pages)), doi: clean(r.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, ''),
      pmid: clean(r.pmid), url: clean(r.url)};
    return out;
  }

  // ---------- BibTeX ----------
  function parseBibTeX(text) {
    const s = String(text), out = [];
    let i = 0;
    while ((i = s.indexOf('@', i)) >= 0) {
      const m = /^@(\w+)\s*\{\s*([^,\s]*)\s*,/.exec(s.slice(i));
      if (!m || /^(comment|preamble|string)$/i.test(m[1])) { i++; continue; }
      let j = i + m[0].length, depth = 1;
      const start = j;
      for (; j < s.length && depth > 0; j++) { if (s[j] == '{') depth++; else if (s[j] == '}') depth--; }
      const body = s.slice(start, j - 1), fields = {};
      let k = 0;
      while (k < body.length) {
        const fm = /^\s*,?\s*([\w-]+)\s*=\s*/.exec(body.slice(k));
        if (!fm) break;
        k += fm[0].length;
        let v = '';
        if (body[k] == '{') { let d = 0, e = k; for (; e < body.length; e++) { if (body[e] == '{') d++; else if (body[e] == '}' && --d == 0) break; } v = body.slice(k + 1, e); k = e + 1; }
        else if (body[k] == '"') { const e = body.indexOf('"', k + 1); v = body.slice(k + 1, e); k = e + 1; }
        else { const e = /^[^,]*/.exec(body.slice(k))[0]; v = e; k += e.length; }
        fields[fm[1].toLowerCase()] = clean(v);
      }
      out.push(norm({type: m[2] ? m[1].toLowerCase() : m[1].toLowerCase(), key: m[2], title: delatex(fields.title || ''),
        authors: (fields.author || '').split(/\s+and\s+/).filter(Boolean).map(parseName), year: fields.year || (fields.date || '').slice(0, 4),
        journal: delatex(fields.journal || fields.journaltitle || fields.booktitle || ''), volume: fields.volume, issue: fields.number || fields.issue,
        pages: fields.pages, doi: fields.doi, pmid: fields.pmid, url: fields.url}));
      out[out.length - 1].key = m[2];
      i = j;
    }
    return out;
  }

  // ---------- RIS ----------
  function parseRIS(text) {
    const out = [];
    let cur = null;
    for (const line of String(text).split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(line);
      if (!m) continue;
      const [, tag, v] = m;
      if (tag == 'TY') { cur = {type: v.trim() == 'JOUR' ? 'article' : v.trim().toLowerCase(), authors: []}; continue; }
      if (!cur) continue;
      if (tag == 'ER') { out.push(norm(cur)); cur = null; continue; }
      if (tag == 'AU' || tag == 'A1') cur.authors.push(parseName(v));
      else if (tag == 'TI' || tag == 'T1') cur.title = v;
      else if (['JO', 'JF', 'T2', 'JA'].includes(tag) && !cur.journal) cur.journal = v;
      else if (tag == 'PY' || tag == 'Y1' || tag == 'DA') cur.year = cur.year || v.slice(0, 4);
      else if (tag == 'VL') cur.volume = v; else if (tag == 'IS') cur.issue = v;
      else if (tag == 'SP') cur.pages = v; else if (tag == 'EP') cur.pages = `${cur.pages || ''}-${v}`;
      else if (tag == 'DO') cur.doi = v; else if (tag == 'UR') cur.url = v;
      else if (tag == 'AN' && /^\d+$/.test(v.trim())) cur.pmid = v.trim();
    }
    return out;
  }

  // ---------- Crossref / CSL-JSON (auch Zotero) und PubMed ----------
  const first = v => Array.isArray(v) ? v[0] : v;
  function fromCSL(c) {
    const m = c.message || c;
    return norm({type: m.type == 'journal-article' || m.type == 'article-journal' ? 'article' : m.type, title: first(m.title),
      authors: (m.author || []).map(a => ({family: a.family || a.literal || a.name || '', given: a.given || ''})),
      year: (m.issued || m['published-print'] || m['published-online'] || m.published)?.['date-parts']?.[0]?.[0],
      journal: first(m['container-title']) || first(m['short-container-title']), volume: m.volume, issue: m.issue, pages: m.page, doi: m.DOI, pmid: m.PMID, url: m.URL});
  }

  function fromPubMed(json, pmid) {
    const r = json.result?.[pmid] || json.result?.[json.result?.uids?.[0]];
    if (!r || r.error) throw new Error(`PMID ${pmid} wurde nicht gefunden`);
    return norm({title: String(r.title).replace(/\.$/, ''), authors: (r.authors || []).filter(a => a.authtype == 'Author').map(a => pubmedName(a.name)),
      year: (r.pubdate || '').slice(0, 4), journal: r.source || r.fulljournalname, volume: r.volume, issue: r.issue, pages: r.pages,
      doi: (r.articleids || []).find(a => a.idtype == 'doi')?.value, pmid: r.uid || pmid});
  }

  // ---------- Ausgabe ----------
  function citeShort(r) {
    const a = r.authors || [], y = r.year || 'o. J.';
    if (!a.length) return `${(r.title || 'Ohne Titel').split(' ').slice(0, 3).join(' ')} ${y}`;
    if (a.length == 1) return `${a[0].family} ${y}`;
    if (a.length == 2) return `${a[0].family} & ${a[1].family} ${y}`;
    return `${a[0].family} et al. ${y}`;
  }

  const initials = g => clean(g).split(/[\s.-]+/).filter(Boolean).map(p => p[0].toUpperCase()).join('');
  function formatFull(r) {
    const a = (r.authors || []).map(x => `${x.family}${x.given ? ' ' + initials(x.given) : ''}`);
    const names = a.length > 6 ? a.slice(0, 6).join(', ') + ' et al.' : a.join(', ');
    const src = [r.journal, r.volume ? `${r.volume}${r.issue ? `(${r.issue})` : ''}` : '', r.pages].filter(Boolean).join(' ').replace(/ (\d+\(?\d*\)?) ([\d–]+)$/, ' $1:$2');
    return [names && `${names} (${r.year || 'o. J.'})`, r.title && `${r.title.replace(/\.$/, '')}.`, src && `${src}.`, r.doi && `doi:${r.doi}`, !r.doi && r.pmid && `PMID ${r.pmid}`].filter(Boolean).join(' ');
  }

  function makeKey(r, taken = new Set()) {
    const base = `${(r.authors?.[0]?.family || 'Quelle').normalize('NFD').replace(/[^A-Za-z]/g, '')}${r.year || ''}`;
    let k = base, n = 0;
    while (taken.has(k)) k = base + String.fromCharCode(97 + n++);
    return k;
  }

  function toBibTeX(refs) {
    const taken = new Set();
    return refs.map(r => {
      const key = r.key && !taken.has(r.key) ? r.key : makeKey(r, taken); taken.add(key);
      const f = [['author', (r.authors || []).map(a => a.given ? `${a.family}, ${a.given}` : `{${a.family}}`).join(' and ')], ['title', r.title], ['journal', r.journal],
        ['year', r.year], ['volume', r.volume], ['number', r.issue], ['pages', (r.pages || '').replace('–', '--')], ['doi', r.doi], ['pmid', r.pmid], ['url', r.url]].filter(([, v]) => v);
      return `@${r.type == 'article' || !r.type ? 'article' : r.type}{${key},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
    }).join('\n\n') + '\n';
  }

  function toRIS(refs) {
    return refs.map(r => ['TY  - JOUR', ...(r.authors || []).map(a => `AU  - ${a.family},${a.given ? ' ' + a.given : ''}`), r.title && `TI  - ${r.title}`, r.journal && `JO  - ${r.journal}`,
      r.year && `PY  - ${r.year}`, r.volume && `VL  - ${r.volume}`, r.issue && `IS  - ${r.issue}`, ...(r.pages ? (([sp, ep]) => [`SP  - ${sp}`, ep && `EP  - ${ep}`])(r.pages.split('–')) : []),
      r.doi && `DO  - ${r.doi}`, r.pmid && `AN  - ${r.pmid}`, 'ER  - '].filter(Boolean).join('\n')).join('\n\n') + '\n';
  }

  function parseAnyRefs(text) {
    const t = String(text).replace(/^﻿/, '').trim();
    if (t.startsWith('@') || /@\w+\s*\{/.test(t)) return parseBibTeX(t);
    if (/^TY  -/m.test(t)) return parseRIS(t);
    if (t.startsWith('[') || t.startsWith('{')) { const j = JSON.parse(t); return (Array.isArray(j) ? j : j.items || [j]).map(fromCSL); }
    throw new Error('Format nicht erkannt (BibTeX, RIS oder CSL-JSON)');
  }

  const Refs = {parseBibTeX, parseRIS, fromCSL, fromPubMed, citeShort, formatFull, makeKey, toBibTeX, toRIS, parseAnyRefs, parseName, norm};
  if (typeof module != 'undefined' && module.exports) module.exports = Refs; else root.Refs = Refs;
})(this);

// ---------- Oberfläche ----------
if (typeof TT != 'undefined') {
  /// Zitat im Text: „(Sanger et al. 1977)“; trägt Kurz- und Vollzitat selbst, damit signierte Einträge unverändert bleiben
  var CiteNode = TT.Node.create({
    name: 'cite', group: 'inline', inline: true, atom: true, selectable: true,
    addAttributes: () => ({short: {default: ''}, full: {default: ''}, refid: {default: null}}),
    parseHTML: () => [{tag: 'span[data-cite]', getAttrs: el => JSON.parse(el.getAttribute('data-cite') || '{}')}],
    renderHTML: ({node}) => ['span', {'data-cite': JSON.stringify(node.attrs), class: 'cite', title: node.attrs.full}, `(${node.attrs.short})`],
    renderText: ({node}) => `(${node.attrs.short})`,
  });
}

let LIT_CUR = null;
const refData = r => ({...JSON.parse(r.data_json), id: r.id, key: r.key});

/// Literaturliste an exportiertes HTML anhängen (Reihenfolge des ersten Zitats)
function withBibliography(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html'), seen = new Map();
  doc.querySelectorAll('span[data-cite]').forEach(s => { const a = JSON.parse(s.getAttribute('data-cite') || '{}'); const k = a.refid ?? a.full; if (!seen.has(k)) seen.set(k, a); });
  if (!seen.size) return html;
  return html + `<section class="bibliography"><h3>Literatur</h3><ol>${[...seen.values()].map(a => `<li>${esc(a.full || a.short)}</li>`).join('')}</ol></section>`;
}

function refreshCiteBox() {
  const box = $('#citebox'); if (!box || !editor) return;
  const seen = new Map();
  editor.state.doc.descendants(n => { if (n.type.name == 'cite') { const k = n.attrs.refid ?? n.attrs.full; if (!seen.has(k)) seen.set(k, n.attrs); } });
  box.hidden = !seen.size;
  box.innerHTML = `<h4>Literatur</h4><ol>${[...seen.values()].map(a => `<li>${a.refid ? `<a href="#" data-litopen="${a.refid}">${esc(a.full || a.short)}</a>` : esc(a.full || a.short)}</li>`).join('')}</ol>`;
}

/// DOI oder PMID holen und in die Bibliothek legen (vorhandene wird wiederverwendet)
async function fetchReference(text) {
  const t = String(text).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/i, '');
  let data, source;
  if (/^10\.\d{4,9}\/\S+$/.test(t)) { data = Refs.fromCSL(JSON.parse(await call('fetchRemote', {source: 'crossref', id: t}))); source = 'Crossref'; }
  else if (/^(PMID:?\s*)?\d{1,9}$/i.test(t)) { const id = t.replace(/\D/g, ''); data = Refs.fromPubMed(JSON.parse(await call('fetchRemote', {source: 'pubmed', id})), id); source = 'PubMed'; }
  else throw new Error('Bitte eine DOI (10.…) oder PMID eingeben');
  const taken = new Set((await call('references')).map(r => r.key));
  return call('saveReference', {data: {...data, key: Refs.makeKey(data, taken)}, source});
}

async function importReferenceText(text, name) {
  const list = Refs.parseAnyRefs(text), taken = new Set((await call('references')).map(r => r.key));
  for (const r of list) { if (!r.key || taken.has(r.key)) r.key = Refs.makeKey(r, taken); taken.add(r.key); }
  const res = await call('importReferences', {list, source: name});
  status(`${name}: ${res.added} neu, ${res.existing} schon vorhanden`);
  return res;
}

// Bibliothek
async function showLiterature(id = LIT_CUR) {
  await flush();
  LIT_CUR = id;
  showView('lit'); navCur('lit');
  return renderLiterature();
}

async function renderLiterature(q = $('#litq')?.value || '') {
  const rows = (await call('references', {q})).map(refData);
  const sel = LIT_CUR ? await call('reference', {id: LIT_CUR}).catch(() => null) : null;
  const sd = sel && refData(sel);
  $('#lit').innerHTML = `<div class="reghead"><h2>📚 Literatur</h2>
      <input id="litq" type="search" placeholder="Bibliothek durchsuchen" value="${esc(q)}" autocomplete="off">
      <button class="btn" data-litimport>📥 BibTeX/RIS</button><button class="btn" data-litexport>BibTeX exportieren</button></div>
    <div class="litadd"><input id="litfetch" placeholder="DOI oder PMID, z. B. 10.1016/0378-1119(85)90120-9" autocomplete="off" spellcheck="false"><button class="btn on" data-litfetch>Holen</button>
      <input id="litzot" placeholder="In Zotero suchen" autocomplete="off"><button class="btn" data-litzot>Zotero</button><span id="litmsg" class="sub"></span></div>
    <div id="litzotres"></div>
    <div class="litwrap"><div>${rows.length ? `<table class="regtable"><tr><th>Zitat</th><th>Titel</th><th>Zeitschrift</th><th>Jahr</th></tr>
      ${rows.map(r => `<tr data-lit="${r.id}" class="${r.id == LIT_CUR ? 'cur' : ''}"><td><b>${esc(Refs.citeShort(r))}</b></td><td>${esc(r.title)}</td><td>${esc(r.journal)}</td><td>${esc(r.year)}</td></tr>`).join('')}</table>`
      : `<div class="empty">${q ? 'Nichts gefunden.' : 'Noch keine Quellen. DOI oder PMID oben eingeben, eine BibTeX/RIS-Datei importieren oder in Zotero suchen.'}</div>`}</div>
    ${sd ? `<aside class="regside"><h4>${esc(Refs.citeShort(sd))}</h4><p>${esc(Refs.formatFull(sd))}</p>
      ${sd.doi ? `<p><a href="https://doi.org/${esc(sd.doi)}" data-ext>doi.org/${esc(sd.doi)}</a></p>` : ''}${sd.pmid ? `<p><a href="https://pubmed.ncbi.nlm.nih.gov/${esc(sd.pmid)}/" data-ext>PubMed ${esc(sd.pmid)}</a></p>` : ''}
      <p class="sub">Schlüssel ${esc(sel.key)}${sel.source ? ` · aus ${esc(sel.source)}` : ''}</p>
      <h4>Zitiert in</h4>${sel.cited_in.length ? sel.cited_in.map(e => `<a href="#" class="elink" data-entry="${e.id}">↗ ${esc(e.title || 'Ohne Titel')}</a>`).join('<br>') : '<span class="sub">noch nirgends (im Eintrag „📚 Quelle“)</span>'}
      ${sel.cited_in.length ? '' : `<p><button class="btn danger" data-litdel="${sel.id}">Aus der Bibliothek löschen</button></p>`}</aside>` : ''}</div>`;
  const inp = $('#litq');
  inp.oninput = () => { clearTimeout(inp._t); inp._t = setTimeout(() => renderLiterature(inp.value).then(() => { const i = $('#litq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 150); };
}

/// Zitat einfügen: Bibliothek durchsuchen oder DOI/PMID direkt holen
async function citeDialog() {
  const dlg = $('#locdlg');
  const list = async q => (await call('references', {q})).map(refData);
  const draw = rs => $('#ciList').innerHTML = rs.length ? rs.slice(0, 30).map(r => `<div class="cirow" data-ci="${r.id}"><b>${esc(Refs.citeShort(r))}</b> <span class="sub">${esc(r.title)}</span></div>`).join('')
    : '<p class="sub">Keine Quelle gefunden – DOI oder PMID eingeben und „Holen“.</p>';
  dlg.innerHTML = `<form method="dialog"><h3>Zitat einfügen</h3>
    <input id="ciQ" placeholder="Suchen oder DOI/PMID" autocomplete="off" spellcheck="false" style="width:100%">
    <div id="ciList" class="cilist"></div><p id="ciMsg" class="bad"></p>
    <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn" id="ciFetch">DOI/PMID holen</button></div></form>`;
  dlg.showModal();
  draw(await list(''));
  $('#ciQ').oninput = async e => draw(await list(e.target.value.trim()));
  const pick = r => { dlg.close(); insertCite(r); };
  $('#ciList').onclick = async e => { const row = e.target.closest('[data-ci]'); if (row) pick(refData(await call('reference', {id: +row.dataset.ci}))); };
  $('#ciFetch').onclick = async () => {
    $('#ciMsg').textContent = '';
    try { const r = await fetchReference($('#ciQ').value); pick(refData(r)); } catch (err) { $('#ciMsg').textContent = err.message; }
  };
}

function insertCite(r) {
  editor.chain().focus().insertContent([{type: 'cite', attrs: {short: Refs.citeShort(r), full: Refs.formatFull(r), refid: r.id}}, {type: 'text', text: ' '}]).run();
}

function initLiterature() {
  const picker = Object.assign(document.createElement('input'), {type: 'file', accept: '.bib,.bibtex,.ris,.json,.txt', hidden: true});
  document.body.appendChild(picker);
  picker.onchange = async () => { const f = picker.files[0]; if (!f) return; try { await importReferenceText(await f.text(), f.name); await renderLiterature(); } catch (err) { alert(`${f.name}: ${err.message}`); } picker.value = ''; };
  $('#lit').addEventListener('click', async e => {
    const d = e.target.dataset;
    const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); return openExternal(a.href); }
    const el = e.target.closest('a.elink'); if (el) { e.preventDefault(); showView('doc'); cur = null; return open(+el.dataset.entry); }
    if (d.litimport !== undefined) return picker.click();
    if (d.litexport !== undefined) { const rs = (await call('references')).map(refData); const r = await call('saveText', {name: T('Literatur.bib'), text: Refs.toBibTeX(rs)}); if (r) status(`Gespeichert: ${r.path}`); return r; }
    if (d.litfetch !== undefined) {
      $('#litmsg').textContent = 'Hole …';
      try { const r = await fetchReference($('#litfetch').value); LIT_CUR = r.id; await renderLiterature(); $('#litmsg').textContent = r.existing ? 'War schon in der Bibliothek' : 'Hinzugefügt'; }
      catch (err) { $('#litmsg').textContent = err.message; }
      return;
    }
    if (d.litzot !== undefined) {
      try {
        const items = JSON.parse(await call('fetchRemote', {source: 'zotero', id: $('#litzot').value.trim() || ' '}));
        const rs = (Array.isArray(items) ? items : items.items || []).map(Refs.fromCSL);
        $('#litzotres').innerHTML = rs.length ? `<div class="zotres">${rs.map((r, i) => `<div class="cirow"><b>${esc(Refs.citeShort(r))}</b> ${esc(r.title)} <button class="btn" data-zotadd="${i}">übernehmen</button></div>`).join('')}</div>` : '<p class="sub">Nichts in Zotero gefunden.</p>';
        $('#litzotres')._rs = rs;
      } catch (err) { $('#litmsg').textContent = err.message; }
      return;
    }
    if (d.zotadd) {
      const r = $('#litzotres')._rs[+d.zotadd], taken = new Set((await call('references')).map(x => x.key));
      const res = await call('importReferences', {list: [{...r, key: Refs.makeKey(r, taken)}], source: 'Zotero'});
      status(res.added ? 'Aus Zotero übernommen' : 'War schon in der Bibliothek'); return renderLiterature();
    }
    if (d.litdel) { if (!confirm('Quelle aus der Bibliothek löschen?')) return; await call('deleteReference', {id: +d.litdel}); LIT_CUR = null; return renderLiterature(); }
    const row = e.target.closest('[data-lit]'); if (row) { LIT_CUR = +row.dataset.lit; return renderLiterature(); }
  });
  $('#citebox').addEventListener('click', e => { const a = e.target.closest('[data-litopen]'); if (a) { e.preventDefault(); showLiterature(+a.dataset.litopen); } });
  $('#editor').addEventListener('click', e => { const c = e.target.closest('span.cite'); if (c && (e.metaKey || !editor.isEditable)) { const a = JSON.parse(c.dataset.cite || '{}'); if (a.refid) showLiterature(a.refid); } });
}
