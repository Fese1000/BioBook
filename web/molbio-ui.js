// Oberfläche zu web/molbio.js im Sequenz-Panel: Sequenz bearbeiten, Feature setzen, Sanger-Lesung (.ab1) ausrichten, Klonierung simulieren.
'use strict';

const TRACE_COLORS = {A: '#3a8f5c', C: '#2a78d6', G: '#1f1d1a', T: '#c0392b'};  // übliche Chromatogramm-Farben

/// Sequenz und Anmerkung zusammen speichern (Sequenzfeld, ggf. „Größe“, Features)
async function saveSequence(st, rec, source) {
  const e = await call('entity', {id: st.entity});
  const values = parseJSON(e.fields_json, {});
  values[st.field] = rec.seq;
  if ('size' in values || parseJSON(e.type_fields, []).some(f => f.key == 'size')) values.size = String(rec.seq.length);
  await call('updateEntity', {id: st.entity, name: e.name, values});
  await call('setSeqAnnotation', {entity: st.entity, field: st.field, circular: rec.circular, features: rec.features, source: source || st.ann.source || ''});
}

function seqEditDialog(el) {
  const st = SEQ_STATE.get(el), dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog"><h3>Sequenz bearbeiten</h3>
    <label class="rf"><span>Aktion</span><select id="seOp"><option value="insert">Einfügen vor Position</option><option value="delete">Löschen</option><option value="replace">Ersetzen</option></select></label>
    <label class="rf"><span>Position</span><input id="seAt" inputmode="numeric" value="1" style="width:90px"></label>
    <label class="rf" id="seLenRow"><span>Anzahl Basen</span><input id="seLen" inputmode="numeric" value="1" style="width:90px"></label>
    <label class="rf" id="seTxtRow"><span>Basen</span><input id="seTxt" spellcheck="false" autocomplete="off" style="font-family:var(--mono);width:100%"></label>
    <p class="sub">Features rechts der Stelle wandern mit; Features im gelöschten Bereich werden gekürzt oder entfernt. ${st.seq.length.toLocaleString(I18N.locale)} bp.</p>
    <p id="seMsg" class="bad"></p><div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="seOk">Anwenden</button></div></form>`;
  const sync = () => { const op = $('#seOp').value; $('#seLenRow').hidden = op == 'insert'; $('#seTxtRow').hidden = op == 'delete'; };
  $('#seOp').onchange = sync; sync();
  dlg.showModal();
  $('#seOk').onclick = async () => {
    try {
      const op = {type: $('#seOp').value, at: +$('#seAt').value, len: +$('#seLen').value, text: $('#seTxt').value};
      const rec = MolBio.editSequence({seq: st.seq, circular: st.ann.circular, features: st.ann.features}, op);
      await saveSequence(st, rec);
      dlg.close(); await renderSeqPanel(el);
      status(`Sequenz geändert: ${rec.seq.length.toLocaleString(I18N.locale)} bp`);
    } catch (e) { $('#seMsg').textContent = e.message; }
  };
}

function featureDialog(el, preset = {}) {
  const st = SEQ_STATE.get(el), dlg = $('#locdlg');
  const types = ['CDS', 'gene', 'promoter', 'terminator', 'rep_origin', 'primer_bind', 'RBS', 'misc_feature'];
  dlg.innerHTML = `<form method="dialog"><h3>Feature setzen</h3>
    <label class="rf"><span>Name</span><input id="ftName" value="${esc(preset.label || '')}" autocomplete="off"></label>
    <label class="rf"><span>Art</span><select id="ftType">${types.map(t => `<option ${t == (preset.type || 'misc_feature') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="rf"><span>Von – bis</span><div><input id="ftFrom" inputmode="numeric" value="${preset.start || ''}" style="width:90px"> – <input id="ftTo" inputmode="numeric" value="${preset.end || ''}" style="width:90px"></div></label>
    <label class="rf"><span>Strang</span><select id="ftStrand"><option value="1">+ (vorwärts)</option><option value="-1" ${preset.strand == -1 ? 'selected' : ''}>− (rückwärts)</option></select></label>
    <p id="ftMsg" class="bad"></p><div class="dlgbtns"><button value="cancel" class="btn">Abbrechen</button><button type="button" class="btn on" id="ftOk">Setzen</button></div></form>`;
  dlg.showModal(); $('#ftName').focus();
  $('#ftOk').onclick = async () => {
    const f = {label: $('#ftName').value.trim() || $('#ftType').value, type: $('#ftType').value, start: +$('#ftFrom').value, end: +$('#ftTo').value, strand: +$('#ftStrand').value};
    try { st.ann = await call('setSeqAnnotation', {entity: st.entity, field: st.field, circular: st.ann.circular, features: [...st.ann.features, f], source: st.ann.source || ''}); dlg.close(); drawSeqPanel(el); }
    catch (e) { $('#ftMsg').textContent = e.message; }
  };
}

// ---------- Sanger ----------
function pickFile(accept, onFile) {
  const p = Object.assign(document.createElement('input'), {type: 'file', accept, hidden: true});
  p.onchange = async () => { const f = p.files[0]; p.remove(); if (f) { try { await onFile(await f.arrayBuffer(), f.name); } catch (e) { alert(`${f.name}: ${e.message}`); } } };
  document.body.appendChild(p); p.click();
}

/// Chromatogramm-Ausschnitt um eine Base der Lesung (±8 Basen)
function chromSVG(read, idx0, strand) {
  const lo = Math.max(0, idx0 - 8), hi = Math.min(read.seq.length - 1, idx0 + 8);
  const x0 = read.ploc[lo] - 6, x1 = read.ploc[hi] + 6, W = 340, H = 90;
  const ymax = Math.max(1, ...['A', 'C', 'G', 'T'].flatMap(b => read.traces[b].slice(x0, x1)));
  const sx = x => (x - x0) / (x1 - x0) * W, sy = y => H - 18 - y / ymax * (H - 26);
  const path = b => read.traces[b].slice(x0, x1).map((y, i) => `${i ? 'L' : 'M'}${sx(x0 + i).toFixed(1)},${sy(y).toFixed(1)}`).join('');
  const letters = [];
  for (let i = lo; i <= hi; i++) letters.push(`<text x="${sx(read.ploc[i]).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="cl ${i == idx0 ? 'hit' : ''}" fill="${TRACE_COLORS[read.seq[i]] || 'var(--mut)'}">${esc(read.seq[i])}</text>`);
  return `<svg class="chrom" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chromatogramm um Base ${idx0 + 1}">
    <rect x="${sx(read.ploc[idx0]) - 7}" y="0" width="14" height="${H - 16}" class="chl"/>
    ${['A', 'C', 'G', 'T'].map(b => `<path d="${path(b)}" stroke="${TRACE_COLORS[b]}" class="tr"/>`).join('')}${letters.join('')}</svg>
    ${strand == -1 ? '<div class="sub">Lesung läuft rückwärts (Gegenstrang)</div>' : ''}`;
}

function sangerShow(el, buf, name) {
  const st = SEQ_STATE.get(el), read = MolBio.parseAB1(buf);
  if (!read.seq) throw new Error('Die Datei enthält keine Basen');
  const al = MolBio.alignRead(st.seq, read.seq, {circular: st.ann.circular, qual: read.qual});
  const [ta, tz] = MolBio.trimRange(read.qual);
  const inGood = d => d.readPos - 1 >= ta && d.readPos - 1 < tz;
  const real = al.diffs.filter(inGood), edge = al.diffs.length - real.length;
  const box = el.querySelector('.sangerbox') || el.appendChild(Object.assign(document.createElement('div'), {className: 'sangerbox'}));
  const lines = [];
  for (let k = 0; k < al.ra.length; k += 70) {
    const r = al.ra.slice(k, k + 70), q = al.qa.slice(k, k + 70);
    lines.push(`<span class="pos">Ref </span>${[...r].map((c, i) => c != q[i] ? `<mark>${c}</mark>` : c).join('')}\n<span class="pos">    </span>${[...r].map((c, i) => c == q[i] ? '|' : ' ').join('')}\n<span class="pos">Les </span>${[...q].map((c, i) => c != r[i] ? `<mark>${c}</mark>` : c).join('')}`);
  }
  box.innerHTML = `<h4>Sanger: ${esc(name)}${read.sample ? ` <span class="sub">(${esc(read.sample)})</span>` : ''}</h4>
    <p>${al.strand == 1 ? 'vorwärts' : 'rückwärts (Gegenstrang)'} · Referenz ${al.refStart}–${al.refEnd} · ${al.length} Positionen · Identität <b>${Calc.fmt(al.identity)} %</b> · gute Lesung: Basen ${ta + 1}–${tz}</p>
    ${real.length ? `<table class="feattab"><tr><th>Position</th><th>Art</th><th>Referenz</th><th>Lesung</th><th>Qualität</th><th></th></tr>
      ${real.slice(0, 30).map(d => `<tr><td class="num">${d.refPos}</td><td>${{sub: 'Austausch', ins: 'Einfügung', del: 'Lücke'}[d.type]}</td><td><code>${d.ref}</code></td><td><code>${d.read}</code></td>
        <td class="num">${d.q ?? '–'}${d.q != null && d.q < 20 ? ' <span class="wbadge warn">unsicher</span>' : ''}</td><td>${d.read != '-' ? chromSVG(read, d.readPos - 1, al.strand) : ''}</td></tr>`).join('')}</table>`
      : '<p><span class="wbadge ok">Keine Abweichung</span> im gut lesbaren Bereich.</p>'}
    ${edge ? `<p class="sub">${edge} Abweichung(en) an den schlecht lesbaren Rändern nicht aufgeführt.</p>` : ''}
    <details><summary>Ausrichtung</summary><pre class="seqtext">${lines.join('\n\n')}</pre></details>`;
  box.scrollIntoView({block: 'nearest'});
  return {al, real};
}

// ---------- Klonierung ----------
async function partOf(o) {
  const e = await call('entity', {id: o.entity});
  const ann = await call('seqAnnotation', {entity: o.entity, field: o.field});
  return {seq: parseJSON(e.fields_json, {})[o.field] || '', circular: ann.circular, features: ann.features, name: `${e.code} ${e.name}`};
}

async function cloningDialog(el) {
  const st = SEQ_STATE.get(el), objs = await call('sequenceObjects');
  const others = objs.filter(o => !(o.entity == st.entity && o.field == st.field));
  const opt = (sel) => `<option value="">—</option>${others.map((o, i) => `<option value="${i}" ${sel == i ? 'selected' : ''}>${esc(`${o.code} ${o.name} (${o.length.toLocaleString(I18N.locale)} bp)`)}</option>`).join('')}`;
  const enz = Object.keys(Bio.ENZYMES);
  const dlg = $('#locdlg');
  dlg.innerHTML = `<form method="dialog" class="clonedlg"><h3>Klonierung simulieren</h3>
    <p class="sub">Vektor: <b>${esc(st.code)} ${esc(st.name)}</b> (${st.seq.length.toLocaleString(I18N.locale)} bp)</p>
    <label class="rf"><span>Methode</span><select id="clM"><option value="rl">Restriktion und Ligation</option><option value="gibson">Gibson</option><option value="gg">Golden Gate</option></select></label>
    <div id="clRL"><label class="rf"><span>Insert</span><select id="clIns">${opt()}</select></label>
      <label class="rf"><span>Enzyme</span><div><select id="clE1">${enz.map(n => `<option ${n == 'EcoRI' ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select id="clE2"><option value="">— nur eins —</option>${enz.map(n => `<option ${n == 'HindIII' ? 'selected' : ''}>${n}</option>`).join('')}</select></div></label></div>
    <div id="clMulti" hidden><label class="rf"><span>Stücke (der Reihe nach)</span><div>${[0, 1, 2, 3].map(i => `<select class="clPart">${opt()}</select>`).join(' ')}</div></label>
      <label class="rf" id="clGGRow"><span>Enzym</span><select id="clGG">${['BsaI', 'BsmBI', 'SapI'].map(n => `<option>${n}</option>`).join('')}</select></label></div>
    <div id="clOut"></div>
    <div class="dlgbtns"><button value="cancel" class="btn">Schließen</button><button type="button" class="btn" id="clRun">Berechnen</button><button type="button" class="btn on" id="clSave" disabled>Als Plasmid anlegen</button></div></form>`;
  const sync = () => { const m = $('#clM').value; $('#clRL').hidden = m != 'rl'; $('#clMulti').hidden = m == 'rl'; $('#clGGRow').hidden = m != 'gg'; $('#clSave').disabled = true; $('#clOut').innerHTML = ''; };
  $('#clM').onchange = sync; sync();
  dlg.showModal();
  let product = null;
  $('#clRun').onclick = async () => {
    try {
      const vec = {seq: st.seq, circular: st.ann.circular, features: st.ann.features};
      const m = $('#clM').value;
      if (m == 'rl') {
        if ($('#clIns').value === '') throw new Error('Insert wählen');
        product = MolBio.restrictionLigation(vec, await partOf(others[+$('#clIns').value]), [$('#clE1').value, $('#clE2').value]);
        product.how = `Restriktion/Ligation mit ${[$('#clE1').value, $('#clE2').value].filter(Boolean).join(' + ')}`;
      } else {
        const picks = [...document.querySelectorAll('.clPart')].map(s => s.value).filter(v => v !== '');
        if (!picks.length) throw new Error('Mindestens ein Stück wählen');
        const parts = [vec, ...await Promise.all(picks.map(i => partOf(others[+i])))];
        product = m == 'gibson' ? MolBio.gibson(parts) : MolBio.goldenGate(parts, $('#clGG').value);
        product.how = m == 'gibson' ? 'Gibson-Assembly' : `Golden Gate mit ${$('#clGG').value}`;
      }
      $('#clOut').innerHTML = `<p><b>${product.seq.length.toLocaleString(I18N.locale)} bp</b>, ringförmig · ${product.features.length} Feature(s) übernommen</p><ul class="sub">${product.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="seqmapbox small">${ringMap({seq: product.seq, name: 'Neues Plasmid', features: product.features, size: 300})}</div>
        <label class="rf"><span>Name</span><input id="clName" value="${esc(`${st.name} + Insert`)}"></label>`;
      $('#clSave').disabled = false;
    } catch (e) { product = null; $('#clSave').disabled = true; $('#clOut').innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  };
  $('#clSave').onclick = async () => {
    if (!product) return;
    const t = (await call('types')).find(x => x.prefix == 'PL');
    const e = await call('createEntity', {type: t.id, name: $('#clName').value.trim() || 'Neues Plasmid', values: {sequence: product.seq, size: String(product.seq.length), source: `Kloniert aus ${st.code} (${product.how})`}});
    await call('setSeqAnnotation', {entity: e.id, field: 'sequence', circular: true, features: product.features, source: product.how});
    dlg.close(); await showEntity(e.id);
    status(`${e.code} angelegt: ${product.seq.length} bp`);
  };
}

function initMolBioUI() {
  $('#reg').addEventListener('click', e => {
    const el = e.target.closest('.seqpanel[data-seqent]'); if (!el) return;
    const d = e.target.dataset;
    if (d.mbedit !== undefined) seqEditDialog(el);
    if (d.mbfeat !== undefined) {
      const st = SEQ_STATE.get(el), h = st.motif ? Bio.findMotif(st.seq, st.motif, {circular: st.ann.circular})[0] : null;
      featureDialog(el, h ? {start: h.start, end: h.end, strand: h.strand, label: st.motif.toUpperCase()} : {});
    }
    if (d.mbsanger !== undefined) pickFile('.ab1,.abi', (buf, name) => sangerShow(el, buf, name));
    if (d.mbclone !== undefined) cloningDialog(el);
  });
}
