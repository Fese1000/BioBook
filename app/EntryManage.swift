// Einträge verwalten: Status (mit Farbe), Anheften, „zuletzt geöffnet“, Duplizieren, gespeicherte Suchen.
import Foundation

extension Store {
    static let statuses = ["", "laufend", "fertig", "fehlgeschlagen", "pausiert"]

    /// Status und Anheften dürfen sich auch bei abgeschlossenen Einträgen ändern – sie gehören zur Ordnung, nicht zum Inhalt
    func setEntryFlags(id: Int, status: String?, pinned: Bool?) throws {
        guard try !queryRows("SELECT 1 FROM entry WHERE id = ?", [id]).isEmpty else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        if let st = status {
            guard Store.statuses.contains(st) else { throw StoreError.invalid("Unbekannter Status: \(st)") }
            try queryRows("UPDATE entry SET status = ? WHERE id = ?", [st, id])
        }
        if let p = pinned { try queryRows("UPDATE entry SET pinned = ? WHERE id = ?", [p ? 1 : 0, id]) }
    }

    func touchOpened(id: Int) throws { try queryRows("UPDATE entry SET opened = ? WHERE id = ?", [Store.now(), id]) }

    /// Kopie als neuer Entwurf: Inhalt, Art, Projekt, Tags, Metadaten, angehängte Protokolle – ohne Revisionen, Signatur und Status
    func duplicate(id: Int) throws -> Int {
        guard let e = try queryRows("SELECT title, kind, project_id, draft_json, draft_text, meta_json FROM entry WHERE id = ?", [id]).first else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        return try transactionRun {
            let title = "\((e["title"] as? String) ?? "") (Kopie)".trimmingCharacters(in: .whitespaces)
            let nid = try create(title: title, project: e["project_id"] as? Int, kind: (e["kind"] as? String) ?? "experiment")
            try queryRows("UPDATE entry SET draft_json = ?, draft_text = ?, meta_json = ? WHERE id = ?", [e["draft_json"], e["draft_text"], e["meta_json"], nid])
            try queryRows("UPDATE search SET body = ? WHERE rowid = ?", [e["draft_text"], nid])
            try queryRows("INSERT INTO entry_tag(entry_id, tag_id) SELECT ?, tag_id FROM entry_tag WHERE entry_id = ?", [nid, id])
            try queryRows("INSERT INTO entry_attach(entry_id, other_id, pos) SELECT ?, other_id, pos FROM entry_attach WHERE entry_id = ?", [nid, id])
            return nid
        }
    }

    func savedSearches() throws -> [[String: Any]] { try queryRows("SELECT id, name, query_json FROM saved_search ORDER BY name COLLATE NOCASE") }

    func saveSearch(name: String, query: [String: Any]) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Name fehlt") }
        let json = String(data: try JSONSerialization.data(withJSONObject: query, options: [.sortedKeys]), encoding: .utf8)!
        try queryRows("INSERT INTO saved_search(name, query_json, created) VALUES(?, ?, ?)", [String(n.prefix(60)), json, Store.now()])
        return lastID()
    }

    func deleteSavedSearch(id: Int) throws { try queryRows("DELETE FROM saved_search WHERE id = ?", [id]) }
}
