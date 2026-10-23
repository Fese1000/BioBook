// Datenbank-Verweise: Kennungen im Text erkennen (GenBank/RefSeq, UniProt, PubMed, DOI, Addgene), im Editor als Link zeigen
// (⌘-Klick öffnet), unter dem Eintrag auflisten und auf Wunsch von NCBI/UniProt holen und als Registry-Objekt anlegen.
// findIds ist eine reine Funktion (tests/dblinks.test.js).
(function (root) {
  'use strict';

  // Reihenfolge = Vorrang bei Überschneidung (UniProt P04637 vor GenBank-Form „1 Buchstabe + 5 Ziffern“)
  const KINDS = [
    {kind: 'refseq', label: 'NCBI RefSeq', re: /\b((?:N[CGMRTWZ]|X[MR]|NP|XP|YP|WP|AC)_\d{5,9}(?:\.\d+)?)\b/g,
      url: id => `https://www.ncbi.nlm.nih.gov/${/^(NP|XP|YP|WP)_/.test(id) ? 'protein' : 'nuccore'}/${id}`, fetch: id => /^(NP|XP|YP|WP)_/.test(id) ? null : 'ncbi-nuccore'},
    {kind: 'uniprot', label: 'UniProt', re: /\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b/g,
      url: id => `https://www.uniprot.org/uniprotkb/${id}`, fetch: () => 'uniprot'},
    {kind: 'genbank', label: 'NCBI GenBank', re: /\b([A-Z]\d{5}|[A-Z]{2}\d{6}|[A-Z]{2}\d{8})(?:\.\d+)?\b/g,
      url: id => `https://www.ncbi.nlm.nih.gov/nuccore/${id}`, fetch: () => 'ncbi-nuccore'},
    {kind: 'pubmed', label: 'PubMed', re: /\bPMID:?\s*(\d{1,9})\b/gi, url: id => `https://pubmed.ncbi.nlm.nih.gov/${id}/`, fetch: () => null},
    {kind: 'doi', label: 'DOI', re: /\b(10\.\d{4,9}\/[^\s"<>]*[^\s"<>.,;:)\]])/g, url: id => `https://doi.org/${id}`, fetch: () => null},
    {kind: 'addgene', label: 'Addgene', re: /\bAddgene\s*#?\s*(\d{4,7})\b/gi, url: id => `https://www.addgene.org/${id}/`, fetch: () => null},
  ];

  /// Alle Kennungen in einem Text: {kind, label, id, from, to, url, fetch}; from/to umfassen den ganzen Treffer (z. B. „PMID: 123“)
  function findIds(text) {
    const all = [];
    KINDS.forEach((k, prio) => {
      for (const m of String(text).matchAll(k.re)) all.push({kind: k.kind, label: k.label, id: m[1], from: m.index, to: m.index + m[0].length, url: k.url(m[1]), fetch: k.fetch(m[1]), prio});
    });
    all.sort((a, b) => a.from - b.from || a.prio - b.prio);
    const out = [];
    for (const h of all) if (!out.length || h.from >= out[out.length - 1].to) out.push(h);
    return out.map(({prio, ...h}) => h);
  }

  const DbRef = {findIds, KINDS};
  if (typeof module != 'undefined' && module.exports) module.exports = DbRef; else root.DbRef = DbRef;
})(this);

if (typeof TT != 'undefined') {
  /// Kennungen im Editor unterstreichen (Dekoration, ändert den Inhalt nicht)
  var DbLinks = TT.Extension.create({
    name: 'dblinks',
    addProseMirrorPlugins() {
      const key = new TT.PluginKey('dblinks');
      const build = doc => {
        const decos = [];
        doc.descendants((node, pos) => {
          if (!node.isText) return;
          for (const m of DbRef.findIds(node.text)) decos.push(TT.Decoration.inline(pos + m.from, pos + m.to, {class: 'dblink', 'data-url': m.url, title: `${m.label} ${m.id} – ⌘-Klick öffnet`}));
        });
        return TT.DecorationSet.create(doc, decos);
      };
      return [new TT.Plugin({key, state: {init: (_, s) => build(s.doc), apply: (tr, old) => tr.docChanged ? build(tr.doc) : old}, props: {decorations: s => key.getState(s)}})];
    },
  });
}

const OPENED = [];  // im Selbsttest statt Browser
function openExternal(url) {
  if (window.TESTING) { OPENED.push(url); return; }
  const a = document.createElement('a'); a.href = url; a.click();  // die App öffnet https-Links im Browser
}

async function refreshDbRefs() {
  const box = $('#dbrefs'); if (!box || !editor) return;
  const seen = new Set(), ids = DbRef.findIds(editor.getText({blockSeparator: '\n'})).filter(h => !seen.has(h.kind + h.id) && seen.add(h.kind + h.id));
  box.hidden = !ids.length;
  box.innerHTML = `<h4>Datenbank-Verweise</h4>` + ids.map(h => `<span class="dbref"><a href="${esc(h.url)}" data-ext>${esc(h.id)}</a> <span class="sub">${esc(h.label)}</span>
    ${h.fetch && editor.isEditable ? `<button class="btn" data-dbfetch="${esc(h.fetch)}" data-dbid="${esc(h.id)}" title="Holen und als Registry-Objekt anlegen">📥 in die Registry</button>` : ''}</span>`).join('');
}

/// Sequenz von NCBI bzw. Protein von UniProt holen und als Registry-Objekt anlegen
async function dbImport(source, id, typeId) {
  status(`Hole ${id} …`);
  const text = await call('fetchRemote', {source, id});
  if (source == 'ncbi-nuccore') {
    const r = Bio.parseGenBank(text)[0];
    const t = (await call('types')).find(x => x.id == typeId);
    const fields = parseJSON(t.fields_json, []), sf = fields.find(f => f.type == 'sequence');
    if (!sf) throw new Error(`${t.name} hat kein Sequenzfeld`);
    const has = k => fields.some(f => f.key == k);
    const values = {[sf.key]: r.seq, ...(has('size') ? {size: String(r.seq.length)} : {}), ...(has('source') ? {source: `NCBI ${r.accession || id}`} : {}), ...(has('note') ? {note: r.description} : {})};
    const e = await call('createEntity', {type: t.id, name: `${r.accession || id} ${r.description}`.slice(0, 90), values});
    await call('setSeqAnnotation', {entity: e.id, field: sf.key, circular: r.circular, features: r.features.slice(0, 2000), source: `NCBI ${r.accession || id}`});
    return e;
  }
  if (source == 'uniprot') {
    const u = JSON.parse(text);
    const t = await proteinType();
    const name = u.proteinDescription?.recommendedName?.fullName?.value || u.proteinDescription?.submissionNames?.[0]?.fullName?.value || u.uniProtkbId || id;
    return call('createEntity', {type: t, name: `${u.primaryAccession || id} ${name}`.slice(0, 90), values: {uniprot: u.primaryAccession || id, gene: u.genes?.[0]?.geneName?.value || '',
      organism: u.organism?.scientificName || '', length: String(u.sequence?.length || ''), aa_sequence: u.sequence?.value || '', note: u.uniProtkbId || ''}});
  }
  throw new Error('Unbekannte Quelle');
}

/// Typ „Protein“ für UniProt-Einträge (wird beim ersten Abruf angelegt)
async function proteinType() {
  const ts = await call('types');
  const t = ts.find(x => x.name == 'Protein' && parseJSON(x.fields_json, []).some(f => f.key == 'uniprot'));
  if (t) return t.id;
  const prefix = ['PT', 'PRT', 'PROT'].find(p => !ts.some(x => x.prefix.toUpperCase() == p));
  return call('saveType', {name: ts.some(x => x.name == 'Protein') ? 'Protein (UniProt)' : 'Protein', prefix, icon: '🧩', fields: [
    {key: 'uniprot', label: 'UniProt', type: 'text'}, {key: 'gene', label: 'Gen', type: 'text'}, {key: 'organism', label: 'Organismus', type: 'text'},
    {key: 'length', label: 'Länge (aa)', type: 'number'}, {key: 'aa_sequence', label: 'Aminosäuren', type: 'longtext'}, {key: 'note', label: 'Notiz', type: 'longtext'}]});
}

/// Auswahl des Typs (nur für Sequenzen), dann holen; Fehler (kein Netz, nicht gefunden) als Meldung
async function dbFetchDialog(source, id) {
  let typeId = null;
  if (source == 'ncbi-nuccore') {
    const ts = (await call('types')).filter(t => !t.archived && parseJSON(t.fields_json, []).some(f => f.type == 'sequence') && t.prefix != 'PR');
    const dlg = $('#locdlg');
    dlg.innerHTML = `<form method="dialog"><h3>${esc(id)} in die Registry holen</h3>
      <label class="rf"><span>Anlegen als</span><select id="dbType">${ts.map(t => `<option value="${t.id}">${esc(t.icon)} ${esc(t.name)}</option>`).join('')}</select></label>
      <p class="sub">Die Sequenz kommt von NCBI (GenBank-Format) samt Features. Dafür wird einmal eine Verbindung zu ncbi.nlm.nih.gov aufgebaut.</p>
      <p id="dbMsg" class="bad"></p><div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="dbGo">Holen</button></div></form>`;
    dlg.showModal();
    return new Promise(res => {
      $('#dbGo').onclick = async () => {
        $('#dbGo').disabled = true; $('#dbMsg').textContent = '';
        try { const e = await dbImport(source, id, +$('#dbType').value); dlg.close(); status(`Angelegt: ${e.code} ${e.name}`); await showEntity(e.id); res(e); }
        catch (err) { $('#dbMsg').textContent = err.message; $('#dbGo').disabled = false; }
      };
    });
  }
  try { const e = await dbImport(source, id); status(`Angelegt: ${e.code} ${e.name}`); await showEntity(e.id); return e; }
  catch (err) { alert(err.message); }
}

function initDbLinks() {
  $('#editor').addEventListener('click', e => {
    const d = e.target.closest('.dblink');
    if (d && (e.metaKey || !editor.isEditable)) { e.preventDefault(); openExternal(d.dataset.url); }
  });
  $('#dbrefs').addEventListener('click', e => {
    const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); return openExternal(a.href); }
    const b = e.target.closest('[data-dbfetch]'); if (b) dbFetchDialog(b.dataset.dbfetch, b.dataset.dbid);
  });
}
