// Literatur-Bibliothek: Quellen als normalisiertes JSON (Autoren, Titel, Zeitschrift, Jahr, DOI, PMID …), eindeutiger Zitierschlüssel.
// Zitate im Eintrag tragen den vollen Text selbst (signierte Einträge bleiben stabil); „Zitiert in“ sucht über die Einträge.
import Foundation

extension Store {
    func references(q: String = "") throws -> [[String: Any]] {
        let t = q.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return try queryRows("SELECT id, key, data_json, source, updated FROM reference ORDER BY year DESC, key COLLATE NOCASE") }
        return try queryRows("SELECT id, key, data_json, source, updated FROM reference WHERE data_json LIKE ? OR key LIKE ? ORDER BY year DESC, key COLLATE NOCASE", ["%\(t)%", "%\(t)%"])
    }

    /// Quelle speichern; gibt es DOI oder PMID schon, wird die vorhandene geliefert (existing = true)
    func saveReference(id: Int?, data: [String: Any], source: String) throws -> [String: Any] {
        let title = ((data["title"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        let authors = (data["authors"] as? [[String: Any]]) ?? []
        guard !title.isEmpty || !authors.isEmpty else { throw StoreError.invalid("Quelle ohne Titel und Autoren") }
        let doi = ((data["doi"] as? String) ?? "").trimmingCharacters(in: .whitespaces), pmid = ((data["pmid"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        if id == nil, let old = try queryRows("SELECT id FROM reference WHERE (? != '' AND doi = ? COLLATE NOCASE) OR (? != '' AND pmid = ?) LIMIT 1", [doi, doi, pmid, pmid]).first {
            var r = try reference(id: old["id"] as! Int); r["existing"] = true; return r
        }
        var d = data
        let wanted = ((data["key"] as? String) ?? "").filter { $0.isLetter || $0.isNumber || "-_:".contains($0) }
        var key = wanted.isEmpty ? "Quelle\((data["year"] as? String) ?? "")" : wanted, n = 0
        while try !queryRows("SELECT 1 FROM reference WHERE key = ? AND id != ?", [key, id ?? -1]).isEmpty { key = (wanted.isEmpty ? "Quelle" : wanted) + String(UnicodeScalar(97 + n)!); n += 1 }
        d["key"] = key
        let json = String(data: try JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]), encoding: .utf8)!, now = Store.now()
        let fields: [Any?] = [key, json, doi.isEmpty ? nil : doi, pmid.isEmpty ? nil : pmid, title, (data["year"] as? String) ?? ""]
        if let id {
            try queryRows("UPDATE reference SET key = ?, data_json = ?, doi = ?, pmid = ?, title = ?, year = ?, updated = ? WHERE id = ?", fields + [now, id])
            return try reference(id: id)
        }
        try queryRows("INSERT INTO reference(key, data_json, doi, pmid, title, year, source, created, updated) VALUES(?,?,?,?,?,?,?,?,?)", fields + [source, now, now])
        return try reference(id: lastID())
    }

    func reference(id: Int) throws -> [String: Any] {
        guard var r = try queryRows("SELECT id, key, data_json, source, created, updated FROM reference WHERE id = ?", [id]).first else { throw StoreError.invalid("Quelle gibt es nicht") }
        r["cited_in"] = try citedIn(reference: id)
        return r
    }

    /// Einträge, in denen die Quelle zitiert ist (Zitat-Knoten mit refid)
    func citedIn(reference id: Int) throws -> [[String: Any]] {
        try queryRows("SELECT id, title FROM entry WHERE deleted IS NULL AND (draft_json LIKE ? OR draft_json LIKE ?) ORDER BY updated DESC", ["%\"refid\":\(id),%", "%\"refid\":\(id)}%"])
    }

    func importReferences(_ list: [[String: Any]], source: String) throws -> [String: Any] {
        var added = 0, existing = 0, ids: [Int] = []
        try transactionRun {
            for d in list {
                let r = try saveReference(id: nil, data: d, source: source)
                if r["existing"] as? Bool == true { existing += 1 } else { added += 1 }
                ids.append(r["id"] as! Int)
            }
        }
        return ["added": added, "existing": existing, "ids": ids]
    }

    func deleteReference(id: Int) throws {
        guard try citedIn(reference: id).isEmpty else { throw StoreError.invalid("Die Quelle ist zitiert und bleibt deshalb in der Bibliothek") }
        try queryRows("DELETE FROM reference WHERE id = ?", [id])
    }
}
