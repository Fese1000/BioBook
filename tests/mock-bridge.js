// Nachbau der Swift-Brücke im Speicher, um die Oberfläche im Browser zu testen (tests/make-mock.sh).
// Bildet die Befehle aus app/main.swift nach, ohne Hash-Prüfung und ohne echte Dateien.
(() => {
  const now = () => new Date().toISOString();
  const db = {entries: [], revs: [], projects: [], files: {}, tags: {}, links: {}, opened: [], next: 1, nextP: 1};
  const tagsOf = id => Object.entries(db.tags).filter(([, ids]) => ids.includes(id)).map(([n]) => n).sort();
  const fail = m => { throw new Error(m); };
  const entry = id => db.entries.find(e => e.id == id) || fail(`Eintrag ${id} gibt es nicht`);
  const H = {
    book: () => ({name: 'Testbuch', path: '/tmp/Testbuch.laborbuch', kinds: ['experiment', 'note', 'protocol']}),
    projects: () => db.projects.map(p => ({...p, entries: db.entries.filter(e => e.project_id == p.id).length}))
      .sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name)),
    createProject: a => { if (!a.name?.trim()) fail('Projektname fehlt'); const p = {id: db.nextP++, name: a.name.trim(), color: '', archived: 0}; db.projects.push(p); return p.id; },
    updateProject: a => { const p = db.projects.find(x => x.id == a.id); if (a.name != null) p.name = a.name.trim(); if (a.archived != null) p.archived = a.archived ? 1 : 0; return true; },
    list: a => db.entries.filter(e => (a.project == null || (e.project_id ?? 0) == a.project) && (a.tag == null || tagsOf(e.id).includes(Object.keys(db.tags)[a.tag - 1])))
      .map(e => ({id: e.id, title: e.title, updated: e.updated, kind: e.kind, project_id: e.project_id, revisions: db.revs.filter(r => r.entry_id == e.id).length, tags: tagsOf(e.id).join(', ') || null}))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
    tags: () => Object.keys(db.tags).map((n, i) => ({id: i + 1, name: n, entries: db.tags[n].length})).filter(t => t.entries),
    setTags: a => { for (const n in db.tags) db.tags[n] = db.tags[n].filter(i => i != a.id);
      for (const n of a.names) { const k = n.trim().replace(/^#+/, ''); if (k) (db.tags[k] ||= []).includes(a.id) || db.tags[k].push(a.id); } return tagsOf(a.id); },
    backlinks: a => db.entries.filter(e => (db.links[e.id] || []).includes(a.id)).map(e => ({id: e.id, title: e.title, kind: e.kind})),
    titles: () => db.entries.map(e => ({id: e.id, title: e.title})),
    openFile: a => { db.opened.push(a); return true; },
    templates: () => (db.tpls ||= []).map(t => ({id: t.id, name: t.name, archived: t.archived, ...t.versions.at(-1), updated: t.versions.at(-1).created})),
    saveTemplate: a => { const e = entry(a.entry); if (!a.name?.trim()) fail('Name der Vorlage fehlt'); db.tpls ||= [];
      let t = db.tpls.find(x => x.name.toLowerCase() == a.name.trim().toLowerCase());
      if (!t) { t = {id: db.tpls.length + 1, name: a.name.trim(), archived: 0, versions: []}; db.tpls.push(t); }
      const l = t.versions.at(-1);
      if (l && l.content_json == e.draft_json && l.title == e.title && l.kind == e.kind) return {id: t.id, version: l.version, unchanged: true};
      t.versions.push({version: t.versions.length + 1, title: e.title, kind: e.kind, content_json: e.draft_json, created: now()}); return {id: t.id, version: t.versions.length, unchanged: false}; },
    templateVersions: a => db.tpls.find(t => t.id == a.id).versions.slice().reverse(),
    archiveTemplate: a => { db.tpls.find(t => t.id == a.id).archived = a.archived ? 1 : 0; return true; },
    createFromTemplate: a => { const t = db.tpls.find(x => x.id == a.id); const v = a.version ? t.versions[a.version - 1] : t.versions.at(-1);
      const id = H.create({title: v.title, kind: v.kind, project: a.project}); Object.assign(entry(id), {draft_json: v.content_json, template_id: t.id, template_version: v.version}); return id; },
    startRun: a => { db.runs ||= []; const r0 = db.runs.find(r => r.entry_id == a.entry && r.status == 'running'); if (r0) return r0.id;
      if (!a.steps?.length) fail('Keine Schritte gefunden'); const r = {id: db.runs.length + 1, entry_id: a.entry, started: now(), status: 'running', steps_json: JSON.stringify(a.steps), done: []}; db.runs.push(r); return r.id; },
    activeRun: a => (db.runs || []).find(r => r.entry_id == a.entry && r.status == 'running') || null,
    completeStep: a => { const r = db.runs.find(x => x.id == a.run); let d = r.done.find(x => x.step_no == a.step); if (!d) { d = {step_no: a.step, done_at: now(), note: a.note}; r.done.push(d); } return d; },
    finishRun: a => { const r = db.runs.find(x => x.id == a.run); r.status = a.aborted ? 'aborted' : 'done'; r.finished = now(); return r; },
    notify: () => { db.notified = (db.notified || 0) + 1; return true; },
    create: a => { const e = {id: db.next++, title: a.title || '', created: now(), updated: now(), draft_json: '', text: '', kind: a.kind || 'experiment', project_id: a.project ?? null}; db.entries.push(e); return e.id; },
    setMeta: a => { const e = entry(a.id); if (a.project != null) e.project_id = a.project || null; if (a.kind) e.kind = a.kind; return true; },
    load: a => ({...entry(a.id), tags: tagsOf(a.id)}),
    save: a => { Object.assign(entry(a.id), {title: a.title, draft_json: a.json, text: a.text, updated: now()}); db.links[a.id] = (a.links || []).filter(l => l != a.id); db.lastFiles = a.files; return {updated: now()}; },
    snapshot: a => { const e = entry(a.id); const rs = db.revs.filter(r => r.entry_id == a.id); const last = rs[rs.length - 1];
      if (!e.draft_json || (last && last.content_json == e.draft_json && last.title == e.title)) return null;
      const r = {entry_id: a.id, no: rs.length + 1, title: e.title, content_json: e.draft_json, created: now(), hash: Math.random().toString(16).slice(2).padEnd(64, '0')}; db.revs.push(r); return r; },
    history: a => db.revs.filter(r => r.entry_id == a.id).reverse(),
    revision: a => db.revs.find(r => r.entry_id == a.id && r.no == a.no) || fail(`Revision ${a.no} gibt es nicht`),
    verify: a => ({ok: true, count: db.revs.filter(r => r.entry_id == a.id).length}),
    search: a => db.entries.filter(e => (e.title + ' ' + e.text).toLowerCase().includes(a.q.toLowerCase())).map(e => ({...e, snippet: ''})),
    putFile: a => { const sha = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); db.files[sha] = a; return {sha256: sha}; },
  };
  window.__mock = {db, prompts: [], confirms: true};
  // lab://files/… gibt es im Browser nicht: fetch auf gespeicherte Daten umleiten
  const realFetch = window.fetch.bind(window);
  window.fetch = (u, ...rest) => { const m = /(?:^lab:\/\/files|^\/files)\/([0-9a-f]{64})$/.exec(String(u)); return m ? Promise.resolve(new Response(Uint8Array.from(atob(db.files[m[1]].base64), c => c.charCodeAt(0)))) : realFetch(u, ...rest); };
  window.webkit = {messageHandlers: {lab: {postMessage: async m => { if (!H[m.cmd]) throw new Error('Unbekannt ' + m.cmd); return structuredClone(H[m.cmd](m.args)); }}}};
  window.alert = m => console.log('[alert] ' + m);
  window.prompt = (m, d) => window.__mock.prompts.length ? window.__mock.prompts.shift() : d ?? null;
  window.confirm = () => window.__mock.confirms;
})();
