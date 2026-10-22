// Nachbau der Swift-Brücke im Speicher, um die Oberfläche im Browser zu testen (tests/make-mock.sh).
// Bildet die Befehle aus app/main.swift nach, ohne Hash-Prüfung und ohne echte Dateien.
(() => {
  const now = () => new Date().toISOString();
  const db = {entries: [], revs: [], projects: [], files: {}, next: 1, nextP: 1};
  const fail = m => { throw new Error(m); };
  const entry = id => db.entries.find(e => e.id == id) || fail(`Eintrag ${id} gibt es nicht`);
  const H = {
    book: () => ({name: 'Testbuch', path: '/tmp/Testbuch.laborbuch', kinds: ['experiment', 'note', 'protocol']}),
    projects: () => db.projects.map(p => ({...p, entries: db.entries.filter(e => e.project_id == p.id).length}))
      .sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name)),
    createProject: a => { if (!a.name?.trim()) fail('Projektname fehlt'); const p = {id: db.nextP++, name: a.name.trim(), color: '', archived: 0}; db.projects.push(p); return p.id; },
    updateProject: a => { const p = db.projects.find(x => x.id == a.id); if (a.name != null) p.name = a.name.trim(); if (a.archived != null) p.archived = a.archived ? 1 : 0; return true; },
    list: a => db.entries.filter(e => a.project == null || (e.project_id ?? 0) == a.project)
      .map(e => ({id: e.id, title: e.title, updated: e.updated, kind: e.kind, project_id: e.project_id, revisions: db.revs.filter(r => r.entry_id == e.id).length}))
      .sort((a, b) => b.updated.localeCompare(a.updated)),
    create: a => { const e = {id: db.next++, title: a.title || '', created: now(), updated: now(), draft_json: '', text: '', kind: a.kind || 'experiment', project_id: a.project ?? null}; db.entries.push(e); return e.id; },
    setMeta: a => { const e = entry(a.id); if (a.project != null) e.project_id = a.project || null; if (a.kind) e.kind = a.kind; return true; },
    load: a => entry(a.id),
    save: a => { Object.assign(entry(a.id), {title: a.title, draft_json: a.json, text: a.text, updated: now()}); return {updated: now()}; },
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
  window.webkit = {messageHandlers: {lab: {postMessage: async m => { if (!H[m.cmd]) throw new Error('Unbekannt ' + m.cmd); return structuredClone(H[m.cmd](m.args)); }}}};
  window.alert = m => console.log('[alert] ' + m);
  window.prompt = (m, d) => window.__mock.prompts.length ? window.__mock.prompts.shift() : d ?? null;
  window.confirm = () => window.__mock.confirms;
})();
