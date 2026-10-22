// Nachbau der Swift-Brücke im Speicher, um die Oberfläche im Browser zu testen (tests/make-mock.sh).
(() => {
  const now = () => new Date().toISOString();
  const db = {entries: [], revs: [], files: {}, next: 1};
  const H = {
    list: () => db.entries.map(e => ({id: e.id, title: e.title, updated: e.updated, revisions: db.revs.filter(r => r.entry_id == e.id).length})).sort((a, b) => b.updated.localeCompare(a.updated)),
    create: a => { const e = {id: db.next++, title: a.title || '', created: now(), updated: now(), draft_json: '', text: ''}; db.entries.push(e); return e.id; },
    load: a => db.entries.find(e => e.id == a.id),
    save: a => { Object.assign(db.entries.find(e => e.id == a.id), {title: a.title, draft_json: a.json, text: a.text, updated: now()}); return {updated: now()}; },
    snapshot: a => { const e = H.load(a); const rs = db.revs.filter(r => r.entry_id == a.id); const last = rs[rs.length - 1];
      if (last && last.json == e.draft_json && last.title == e.title) return null;
      const r = {entry_id: a.id, no: rs.length + 1, title: e.title, json: e.draft_json, created: now(), hash: Math.random().toString(16).slice(2).padEnd(64, '0')}; db.revs.push(r); return r; },
    history: a => db.revs.filter(r => r.entry_id == a.id).reverse(),
    verify: a => ({ok: true, count: db.revs.filter(r => r.entry_id == a.id).length}),
    search: a => db.entries.filter(e => (e.title + ' ' + e.text).toLowerCase().includes(a.q.toLowerCase())).map(e => ({...e, snippet: ''})),
    putFile: a => { const sha = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); db.files[sha] = a; return {sha256: sha}; },
  };
  window.webkit = {messageHandlers: {lab: {postMessage: async m => { if (!H[m.cmd]) throw new Error('Unbekannt ' + m.cmd); return structuredClone(H[m.cmd](m.args)); }}}};
  window.alert = m => console.log('[alert] ' + m);
})();
