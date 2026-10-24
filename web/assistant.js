// KI-Assistent (eigener Anthropic-Schlüssel): Eintrag zusammenfassen, Fragen an das Laborbuch mit Quellen, Protokoll aus Stichpunkten.
// Nur auf Klick; vorher steht da, was an Anthropic geht. Die Prompt-Bausteine sind reine Funktionen (tests/assistant.test.js).
(function (root) {
  'use strict';

  const SOURCE_CHARS = 6000, MAX_SOURCES = 8;

  const SYSTEM = {
    summary: 'Du hilfst in einem Labor-Notizbuch. Fasse den Eintrag auf Deutsch sachlich zusammen: Ziel, Durchführung, wichtigste Ergebnisse mit Zahlen und Einheiten, offene Punkte. '
      + 'Erfinde nichts; was im Eintrag nicht steht, lässt du weg. Höchstens 8 kurze Stichpunkte, keine Einleitung.',
    qa: 'Du beantwortest Fragen zu einem Labor-Notizbuch nur anhand der mitgeschickten Einträge. Jede Aussage belegst du mit der Kennung des Eintrags in eckigen Klammern, z. B. [E12]. '
      + 'Steht die Antwort nicht in den Einträgen, sag das klar. Antworte auf Deutsch, knapp und mit Zahlen und Einheiten, wie sie im Eintrag stehen.',
    protocol: 'Du schreibst aus Stichpunkten ein Laborprotokoll auf Deutsch: Überschriften „Ziel“, „Material“, „Durchführung“ (nummerierte Schritte mit Mengen, Zeiten, Temperaturen), „Hinweise“. '
      + 'Übernimm alle Angaben aus den Stichpunkten unverändert; ergänze nur übliche Zwischenschritte und markiere jede Ergänzung mit „(ergänzt)“. Kein Fließtext davor oder danach.',
  };

  const clip = (t, n) => { const s = String(t || ''); return s.length > n ? {text: s.slice(0, n), cut: true} : {text: s, cut: false}; };

  function summaryPrompt(e) {
    const c = clip(e.text, 60000);
    return {system: SYSTEM.summary, user: `Titel: ${e.title || 'Ohne Titel'}\n\n${c.text}`, cut: c.cut, chars: c.text.length};
  }

  /// Frage mit Quellen: höchstens 8 Einträge, je höchstens 6000 Zeichen (die Vorschau sagt, was gekürzt wurde)
  function qaPrompt(question, sources) {
    const used = sources.slice(0, MAX_SOURCES).map(s => ({...s, ...clip(s.text, SOURCE_CHARS)}));
    const docs = used.map(s => `<eintrag id="E${s.id}" titel="${String(s.title || '').replace(/"/g, "'")}">\n${s.text}${s.cut ? '\n[… gekürzt]' : ''}\n</eintrag>`).join('\n\n');
    return {system: SYSTEM.qa, user: `${docs}\n\nFrage: ${question}`, used, chars: docs.length + question.length};
  }

  function protocolPrompt(bullets) { return {system: SYSTEM.protocol, user: String(bullets).trim(), chars: String(bullets).trim().length}; }

  /// [E12] in der Antwort → Link auf den Eintrag (nur Kennungen, die als Quelle mitgingen)
  function linkCitations(html, ids) {
    const ok = new Set(ids.map(Number));
    return html.replace(/\[E(\d+)\]/g, (m, n) => ok.has(+n) ? `<a href="#" class="elink aicite" data-entry="${n}">[E${n}]</a>` : m);
  }

  /// Einfaches Markdown der Antwort → Absätze und Listen (sicher: Text wird vorher maskiert)
  function mdToHTML(md, escape) {
    const lines = String(md).replace(/\r/g, '').split('\n'), out = [];
    let list = null;
    const inline = t => escape(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const l of lines) {
      const ul = /^\s*[-*•]\s+(.*)$/.exec(l), ol = /^\s*\d+[.)]\s+(.*)$/.exec(l), h = /^#{1,4}\s+(.*)$/.exec(l);
      if (ul || ol) { const t = ul ? 'ul' : 'ol'; if (list != t) { close(); out.push(`<${t}>`); list = t; } out.push(`<li>${inline((ul || ol)[1])}</li>`); continue; }
      close();
      if (h) out.push(`<h4>${inline(h[1])}</h4>`); else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    }
    close();
    return out.join('');
  }

  /// Antwort als Editor-Inhalt (Absätze, Listen, Überschriften)
  function mdToDoc(md) {
    const lines = String(md).replace(/\r/g, '').split('\n'), out = [];
    let list = null;
    const para = t => ({type: 'paragraph', content: t ? [{type: 'text', text: t.replace(/\*\*(.+?)\*\*/g, '$1')}] : []});
    for (const l of lines) {
      const ul = /^\s*[-*•]\s+(.*)$/.exec(l), ol = /^\s*\d+[.)]\s+(.*)$/.exec(l), h = /^#{1,4}\s+(.*)$/.exec(l);
      if (ul || ol) {
        const t = ul ? 'bulletList' : 'orderedList';
        if (!list || list.type != t) { list = {type: t, content: []}; out.push(list); }
        list.content.push({type: 'listItem', content: [para((ul || ol)[1])]}); continue;
      }
      list = null;
      if (h) out.push({type: 'heading', attrs: {level: 3}, content: [{type: 'text', text: h[1]}]});
      else if (l.trim()) out.push(para(l.trim()));
    }
    return out;
  }

  const AI = {summaryPrompt, qaPrompt, protocolPrompt, linkCitations, mdToHTML, mdToDoc, SYSTEM, MAX_SOURCES, SOURCE_CHARS};
  if (typeof module != 'undefined' && module.exports) module.exports = AI; else root.AI = AI;
})(this);

// ---------- Oberfläche ----------
let AI_ON = false;

async function refreshAI() {
  AI_ON = !!(await call('aiStatus')).configured;
  document.querySelectorAll('.aionly').forEach(el => el.hidden = !AI_ON);
  renderToolbar();
  return AI_ON;
}

/// Vorschau: was geht an Anthropic? true = senden
function aiConfirm(title, lines) {
  if (window.TESTING) return Promise.resolve(window.AI_CONFIRM ?? true);
  return new Promise(res => {
    const dlg = $('#locdlg');
    dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>
      <p>Wird an <b>Anthropic (Claude, ${esc('claude-opus-5-5')})</b> gesendet:</p><ul class="aisend">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      <p class="sub">Mit deinem eigenen Schlüssel; Kosten trägt dein Anthropic-Konto. Nichts davon wird im Laborbuch verändert, bis du die Antwort übernimmst.</p>
      <div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button value="ok" class="btn on">Senden</button></div></form>`;
    dlg.onclose = () => res(dlg.returnValue == 'ok');
    dlg.showModal();
  });
}

function aiResultBox(html, actions, meta) {
  const box = $('#aibox');
  box.hidden = false;
  box.innerHTML = `<div class="aihead"><b>✨ ${esc(meta.title)}</b><span class="sub">${esc(meta.note || '')}</span><button class="x" data-aiclose title="Schließen">×</button></div>
    <div class="aibody">${html}</div><div class="aiacts">${actions}</div>`;
  box.scrollIntoView({block: 'nearest'});
}

async function aiRun(prompt, maxTokens) {
  status('Claude denkt nach …');
  try { const r = await call('aiAsk', {system: prompt.system, user: prompt.user, maxTokens}); status(''); return r; }
  catch (e) { status(''); alert(e.message); return null; }
}

/// Aktuellen Eintrag zusammenfassen
async function aiSummary() {
  await flush();
  const p = AI.summaryPrompt({title: $('#title').value, text: editor.getText({blockSeparator: '\n'})});
  if (!p.chars) return alert('Der Eintrag ist leer.');
  if (!await aiConfirm('Eintrag zusammenfassen', [`dieser Eintrag: „${esc($('#title').value || 'Ohne Titel')}“ (${p.chars.toLocaleString('de-DE')} Zeichen${p.cut ? ', gekürzt' : ''})`])) return null;
  const r = await aiRun(p, 2000); if (!r) return null;
  AIState.last = {kind: 'summary', text: r.text};
  aiResultBox(AI.mdToHTML(r.text, esc), editor.isEditable ? '<button class="btn on" data-aiinsert>Als Zusammenfassung in den Eintrag</button>' : '',
    {title: 'Zusammenfassung', note: `${r.model} · ${r.input_tokens}+${r.output_tokens} Tokens${r.truncated ? ' · abgeschnitten' : ''}`});
  return r;
}

/// Protokoll aus Stichpunkten (Auswahl oder ganzer Eintrag)
async function aiProtocol() {
  await flush();
  const {from, to} = editor.state.selection, sel = from != to ? editor.state.doc.textBetween(from, to, '\n') : '';
  const bullets = sel || editor.getText({blockSeparator: '\n'});
  if (!bullets.trim()) return alert('Erst Stichpunkte schreiben (oder markieren).');
  const p = AI.protocolPrompt(bullets);
  if (!await aiConfirm('Protokoll aus Stichpunkten', [`${sel ? 'die markierten Stichpunkte' : 'der Text dieses Eintrags'} (${p.chars.toLocaleString('de-DE')} Zeichen)`])) return null;
  const r = await aiRun(p, 6000); if (!r) return null;
  AIState.last = {kind: 'protocol', text: r.text};
  aiResultBox(AI.mdToHTML(r.text, esc), editor.isEditable ? '<button class="btn on" data-aiinsert>Unten in den Eintrag einfügen</button>' : '',
    {title: 'Protokoll-Entwurf', note: `${r.model} · „(ergänzt)“ markiert Zusätze von Claude – bitte prüfen`});
  return r;
}

/// Frage an das Laborbuch: Suche, Quellen anzeigen, Antwort mit Verweisen
async function aiAsk(question) {
  const q = String(question || '').trim(); if (!q) return null;
  const words = q.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(w => w.length > 3);
  const hits = new Map();
  for (const w of [q, ...words]) for (const h of await call('search', {q: w}).catch(() => [])) if (!hits.has(h.id)) hits.set(h.id, h);
  const ids = [...hits.keys()].slice(0, AI.MAX_SOURCES);
  if (!ids.length) { $('#aianswer').innerHTML = '<p class="sub">Keine passenden Einträge gefunden – die Frage anders formulieren.</p>'; return null; }
  const sources = [];
  for (const id of ids) { const e = await call('load', {id}); sources.push({id, title: e.title, text: await entryPlainText(e)}); }
  const p = AI.qaPrompt(q, sources);
  if (!await aiConfirm('Frage an das Laborbuch', [`die Frage „${esc(q)}“`, ...p.used.map(s => `[E${s.id}] ${esc(s.title || 'Ohne Titel')}${s.cut ? ' (gekürzt)' : ''}`)])) return null;
  $('#aianswer').innerHTML = '<p class="sub">Claude denkt nach …</p>';
  const r = await aiRun(p, 3000);
  if (!r) { $('#aianswer').innerHTML = ''; return null; }
  $('#aianswer').innerHTML = `${AI.linkCitations(AI.mdToHTML(r.text, esc), ids)}
    <p class="sub">Quellen: ${p.used.map(s => `<a href="#" class="elink" data-entry="${s.id}">[E${s.id}] ${esc(s.title || 'Ohne Titel')}</a>`).join(' · ')} · ${esc(r.model)}</p>`;
  return r;
}

/// Klartext eines gespeicherten Eintrags (über einen unsichtbaren Editor, wie beim Export)
async function entryPlainText(e) {
  const H = aiHelperEditor();
  H.commands.setContent(parseJSON(e.draft_json, {type: 'doc', content: []}), {emitUpdate: false});
  return H.getText({blockSeparator: '\n'});
}
let AI_EDITOR = null;
const aiHelperEditor = () => AI_EDITOR ||= new TT.Editor({element: document.createElement('div'), extensions: editorExtensions(), editable: false});

const AIState = {last: null};

async function showAsk() {
  await flush();
  showView('ask'); navCur('ask');
  $('#ask').innerHTML = `<div class="reghead"><h2>✨ Fragen an das Laborbuch</h2></div>
    <form id="askform" class="askform"><input id="askq" placeholder="z. B. Welche Ausbeute hatten die Plasmid-Präps im Oktober?" autocomplete="off"><button class="btn on">Fragen</button></form>
    <p class="sub">Die passenden Einträge werden gesucht; vor dem Senden siehst du, welche an Claude gehen. Die Antwort verweist mit [E…] auf die Einträge.</p>
    <div id="aianswer"></div>`;
  $('#askq').focus();
}

function initAssistant() {
  $('#ask').addEventListener('submit', e => { e.preventDefault(); aiAsk($('#askq').value); });
  $('#ask').addEventListener('click', e => { const a = e.target.closest('a.elink'); if (a) { e.preventDefault(); showView('doc'); cur = null; open(+a.dataset.entry); } });
  $('#aibox').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.aiclose !== undefined) { $('#aibox').hidden = true; return; }
    if (d.aiinsert !== undefined && AIState.last) {
      const today = new Date().toLocaleDateString('de-DE');
      const head = AIState.last.kind == 'summary' ? `KI-Zusammenfassung (Claude, ${today}) – bitte prüfen` : `Protokoll-Entwurf von Claude (${today}) – bitte prüfen`;
      editor.chain().focus('end').insertContent([{type: 'heading', attrs: {level: 3}, content: [{type: 'text', text: head}]}, ...AI.mdToDoc(AIState.last.text)]).run();
      $('#aibox').hidden = true;
    }
  });
  refreshAI();
}

/// Fußzeile: „✨ KI-Assistent“ (nur sichtbar, wenn ein Schlüssel hinterlegt ist)
function aiMenu(btn) {
  const items = [['✨', 'Eintrag zusammenfassen', () => aiSummary()], ['✨', 'Protokoll aus Stichpunkten', () => aiProtocol()], ['✨', 'Frage ans Laborbuch …', () => showAsk()]];
  popMenu(btn, items.map(([i, t], n) => `<div class="opt" data-ai="${n}">${i} ${esc(t)}</div>`).join(''), el => el.addEventListener('mousedown', e => {
    const o = e.target.closest('[data-ai]'); if (!o) return;
    e.preventDefault(); el.close(); items[+o.dataset.ai][2]();
  }));
}
