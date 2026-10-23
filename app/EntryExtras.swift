// Am Eintrag: angehängte Protokolle (eigene Einträge, als Reiter daneben), eigene Felder (Metadaten) und „Verknüpft“ –
// alles, was der Eintrag benutzt oder was auf ihn zeigt.
import Foundation

extension Store {
    private func requireEditable(_ id: Int) throws {
        guard let r = try queryRows("SELECT signed_no, deleted FROM entry WHERE id = ?", [id]).first else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        if r["signed_no"] as? Int != nil { throw StoreError.invalid("Der Eintrag ist abgeschlossen. Änderungen bitte als Nachtrag.") }
        if r["deleted"] as? String != nil { throw StoreError.invalid("Der Eintrag liegt im Papierkorb.") }
    }

    /// Protokolle am Eintrag: ausdrücklich angehängte und alle Protokolle, auf die der Text verweist
    func attachments(entry id: Int) throws -> [[String: Any]] {
        try queryRows("""
        SELECT e.id, e.title, e.kind, e.signed_no, 1 AS explicit, a.pos FROM entry_attach a JOIN entry e ON e.id = a.other_id WHERE a.entry_id = ?1 AND e.deleted IS NULL
        UNION
        SELECT e.id, e.title, e.kind, e.signed_no, 0, 1000 FROM link l JOIN entry e ON e.id = l.to_entry
          WHERE l.from_entry = ?1 AND e.kind = 'protocol' AND e.deleted IS NULL AND e.id NOT IN (SELECT other_id FROM entry_attach WHERE entry_id = ?1)
        ORDER BY 6, 2 COLLATE NOCASE
        """, [id])
    }

    func attach(entry id: Int, other: Int) throws {
        try requireEditable(id)
        guard id != other else { throw StoreError.invalid("Ein Eintrag kann nicht an sich selbst hängen") }
        guard try !queryRows("SELECT 1 FROM entry WHERE id = ? AND deleted IS NULL", [other]).isEmpty else { throw StoreError.invalid("Protokoll gibt es nicht") }
        let pos = (try queryRows("SELECT COALESCE(MAX(pos), 0) + 1 AS p FROM entry_attach WHERE entry_id = ?", [id]).first?["p"] as? Int) ?? 1
        try queryRows("INSERT OR IGNORE INTO entry_attach(entry_id, other_id, pos) VALUES(?, ?, ?)", [id, other, pos])
    }

    func detach(entry id: Int, other: Int) throws {
        try requireEditable(id)
        try queryRows("DELETE FROM entry_attach WHERE entry_id = ? AND other_id = ?", [id, other])
    }

    /// Eigene Felder: [{k, v}] – höchstens 50, Bezeichnung bis 60, Wert bis 500 Zeichen; leere Zeilen fallen weg
    func setEntryMeta(entry id: Int, fields raw: [[String: Any]]) throws -> [[String: String]] {
        try requireEditable(id)
        let fields: [[String: String]] = raw.compactMap { f in
            let k = ((f["k"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines), v = ((f["v"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return k.isEmpty && v.isEmpty ? nil : ["k": String(k.prefix(60)), "v": String(v.prefix(500))]
        }
        guard fields.count <= 50 else { throw StoreError.invalid("Höchstens 50 Felder") }
        if fields.contains(where: { $0["k"]!.isEmpty }) { throw StoreError.invalid("Jedes Feld braucht eine Bezeichnung") }
        let json = String(data: try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), encoding: .utf8)!  // feste Reihenfolge der Schlüssel
        try queryRows("UPDATE entry SET meta_json = ?, updated = ? WHERE id = ?", [json, Store.now(), id])
        return fields
    }

    /// Bisher benutzte Feldbezeichnungen (für Vorschläge)
    func metaKeys() throws -> [String] {
        var seen = Set<String>(), out: [String] = []
        for r in try queryRows("SELECT meta_json FROM entry WHERE meta_json != '[]' AND deleted IS NULL ORDER BY updated DESC LIMIT 500") {
            for f in ((try? JSONSerialization.jsonObject(with: Data((r["meta_json"] as! String).utf8))) as? [[String: String]]) ?? [] {
                if let k = f["k"], seen.insert(k.lowercased()).inserted { out.append(k) }
            }
        }
        return out
    }

    /// „Verknüpft“: was der Eintrag benutzt und was auf ihn verweist, nach Art gruppiert
    func related(entry id: Int) throws -> [String: Any] {
        guard let e = try queryRows("SELECT draft_json FROM entry WHERE id = ?", [id]).first else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        let json = (e["draft_json"] as? String) ?? ""
        let refIds = Set(json.matches(of: try Regex("\"refid\":(\\d+)")).compactMap { Int(json[$0.range].split(separator: ":").last ?? "") })
        let refs = try refIds.sorted().compactMap { try queryRows("SELECT id, key, title, year FROM reference WHERE id = ?", [$0]).first }
        return [
            "entities": try queryRows("""
            SELECT en.id, en.name, t.prefix, en.no, t.icon, t.name AS type FROM entry_entity x JOIN entity en ON en.id = x.entity_id JOIN rtype t ON t.id = en.type_id
            WHERE x.entry_id = ? ORDER BY t.name, en.no
            """, [id]).map { r in var r = r; r["code"] = Store.code(prefix: r["prefix"] as! String, no: r["no"] as! Int); return r },
            "lots": try queryRows("""
            SELECT l.id, l.name, l.unit, l.lot_no, SUM(m.delta) AS delta, COUNT(*) AS moves FROM lot_move m JOIN lot l ON l.id = m.lot_id WHERE m.entry_id = ? GROUP BY l.id ORDER BY l.name
            """, [id]).map { r in var r = r; r["code"] = Store.lotCode(r["id"] as! Int); return r },
            "cultures": try queryRows("""
            SELECT c.id, c.name, group_concat(ev.kind, ',') AS kinds FROM culture_event ev JOIN culture c ON c.id = ev.culture_id WHERE ev.entry_id = ? GROUP BY c.id
            """, [id]).map { r in var r = r; r["code"] = Store.cultureCode(r["id"] as! Int); return r },
            "devices": try queryRows("SELECT d.id, d.name, group_concat(g.kind, ',') AS kinds FROM device_log g JOIN device d ON d.id = g.device_id WHERE g.entry_id = ? GROUP BY d.id", [id]),
            "links": try queryRows("SELECT e.id, e.title, e.kind FROM link l JOIN entry e ON e.id = l.to_entry WHERE l.from_entry = ? AND e.deleted IS NULL ORDER BY e.title", [id]),
            "backlinks": try queryRows("SELECT e.id, e.title, e.kind FROM link l JOIN entry e ON e.id = l.from_entry WHERE l.to_entry = ? AND e.deleted IS NULL ORDER BY e.title", [id]),
            "references": refs,
            "results": try queryRows("SELECT s.id, s.name, COUNT(*) AS rows FROM result_row r JOIN result_schema s ON s.id = r.schema_id WHERE r.entry_id = ? GROUP BY s.id", [id]),
            "files": try queryRows("SELECT a.sha256, a.name, a.mime, a.size FROM entry_file f JOIN attachment a ON a.sha256 = f.sha256 WHERE f.entry_id = ? ORDER BY a.name", [id]),
        ]
    }
}
