// Registry: eigene Typen (Plasmid, Primer, …) mit Feldern; Objekte mit fortlaufender ID wie PL-0042,
// Änderungsverlauf je Objekt und Verweise aus Einträgen („Verwendet in“).
import Foundation

extension Store {
    static let fieldTypes = ["text", "longtext", "number", "date", "select", "sequence", "bool", "url"]

    /// Standardtypen für neue Bücher (beim Anlegen der Registry)
    static let defaultTypes: [(String, String, String, [[String: Any]])] = [
        ("Plasmid", "PL", "🧬", [f("backbone", "Backbone"), f("insert", "Insert"), sel("resistance", "Resistenz", ["Ampicillin", "Kanamycin", "Chloramphenicol", "Spectinomycin", "Tetracyclin", "Zeocin", "Puromycin", "Hygromycin"]),
                                 f("size", "Größe (bp)", "number"), f("sequence", "Sequenz", "sequence"), f("source", "Quelle"), f("note", "Notiz", "longtext")]),
        ("Primer", "PR", "🧷", [f("sequence", "Sequenz 5'→3'", "sequence"), f("target", "Ziel / Gen"), sel("direction", "Richtung", ["vorwärts", "rückwärts"]),
                                f("tm", "Tm (°C)", "number"), f("supplier", "Hersteller"), f("note", "Notiz", "longtext")]),
        ("Stamm", "ST", "🦠", [f("organism", "Organismus"), f("genotype", "Genotyp", "longtext"), f("resistance", "Resistenz"), f("plasmid", "Plasmid"), f("source", "Quelle")]),
        ("Zelllinie", "ZL", "🧫", [f("species", "Spezies"), f("tissue", "Gewebe / Typ"), f("medium", "Medium"), sel("mycoplasma", "Mycoplasma", ["negativ", "positiv", "unbekannt"]),
                                   f("catalog", "Katalognr."), f("note", "Notiz", "longtext")]),
        ("Antikörper", "AK", "🔬", [f("target", "Ziel"), f("host", "Wirt"), sel("clonality", "Klonalität", ["monoklonal", "polyklonal"]), f("conjugate", "Konjugat"),
                                     f("dilution_wb", "Verdünnung WB"), f("dilution_if", "Verdünnung IF"), f("supplier", "Hersteller"), f("catalog", "Katalognr.")]),
        ("Chemikalie", "CH", "⚗️", [f("cas", "CAS-Nr."), f("mw", "Molmasse (g/mol)", "number"), f("supplier", "Hersteller"), f("catalog", "Katalognr."), f("sds", "Sicherheitsdatenblatt", "url")]),
    ]
    private static func f(_ key: String, _ label: String, _ type: String = "text") -> [String: Any] { ["key": key, "label": label, "type": type] }
    private static func sel(_ key: String, _ label: String, _ opts: [String]) -> [String: Any] { ["key": key, "label": label, "type": "select", "options": opts] }

    static func code(prefix: String, no: Int) -> String { "\(prefix)-\(String(format: "%04d", no))" }

    // MARK: Typen
    func types() throws -> [[String: Any]] {
        try queryRows("""
        SELECT t.id, t.name, t.prefix, t.icon, t.fields_json, t.archived,
          (SELECT COUNT(*) FROM entity e WHERE e.type_id = t.id AND e.archived = 0) AS count
        FROM rtype t ORDER BY t.archived, t.name COLLATE NOCASE
        """)
    }

    /// Felder prüfen: eindeutige Schlüssel, bekannte Typen, Auswahlfelder mit Optionen
    static func cleanFields(_ raw: [[String: Any]]) throws -> [[String: Any]] {
        var seen = Set<String>()
        return try raw.map { f in
            guard let key = f["key"] as? String, key.range(of: "^[a-z][a-z0-9_]{0,30}$", options: .regularExpression) != nil, seen.insert(key).inserted else {
                throw StoreError.invalid("Feldschlüssel ungültig oder doppelt: \(f["key"] ?? "")")
            }
            let label = ((f["label"] as? String) ?? key).trimmingCharacters(in: .whitespaces)
            let type = (f["type"] as? String) ?? "text"
            guard fieldTypes.contains(type) else { throw StoreError.invalid("Feldtyp unbekannt: \(type)") }
            var out: [String: Any] = ["key": key, "label": label.isEmpty ? key : label, "type": type]
            if type == "select" {
                let opts = ((f["options"] as? [String]) ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                guard !opts.isEmpty else { throw StoreError.invalid("Auswahlfeld „\(label)“ braucht Optionen") }
                out["options"] = opts
            }
            return out
        }
    }

    /// Typ anlegen (id nil) oder ändern. Das Kürzel lässt sich nur ändern, solange es keine Objekte gibt (sonst änderten sich alle IDs).
    func saveType(id: Int?, name: String, prefix: String, icon: String, fields: [[String: Any]]) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespaces), p = prefix.trimmingCharacters(in: .whitespaces).uppercased()
        guard !n.isEmpty else { throw StoreError.invalid("Name des Typs fehlt") }
        guard p.range(of: "^[A-Z]{1,4}$", options: .regularExpression) != nil else { throw StoreError.invalid("Kürzel: 1–4 Buchstaben, z. B. PL") }
        let clean = try Store.cleanFields(fields)
        let json = String(data: try JSONSerialization.data(withJSONObject: clean), encoding: .utf8)!
        return try transactionRun {
            if let id {
                guard let old = try queryRows("SELECT prefix FROM rtype WHERE id = ?", [id]).first else { throw StoreError.invalid("Typ gibt es nicht") }
                if (old["prefix"] as? String)?.uppercased() != p, try !queryRows("SELECT 1 FROM entity WHERE type_id = ? LIMIT 1", [id]).isEmpty {
                    throw StoreError.invalid("Das Kürzel lässt sich nicht mehr ändern, weil es schon Objekte mit diesen IDs gibt")
                }
                try queryRows("UPDATE rtype SET name = ?, prefix = ?, icon = ?, fields_json = ? WHERE id = ?", [n, p, icon, json, id])
                return id
            }
            try queryRows("INSERT INTO rtype(name, prefix, icon, fields_json, created) VALUES(?, ?, ?, ?, ?)", [n, p, icon, json, Store.now()])
            return lastID()
        }
    }

    func archiveType(id: Int, archived: Bool) throws { try queryRows("UPDATE rtype SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]) }

    // MARK: Objekte
    private func typeRow(_ id: Int) throws -> [String: Any] {
        guard let t = try queryRows("SELECT id, name, prefix, icon, fields_json FROM rtype WHERE id = ?", [id]).first else { throw StoreError.invalid("Typ gibt es nicht") }
        return t
    }

    /// Werte gegen die Felder des Typs prüfen; unbekannte Schlüssel werden verworfen, leere entfernt
    func cleanValues(typeId: Int, _ values: [String: Any]) throws -> [String: String] {
        let fields = (try JSONSerialization.jsonObject(with: Data((try typeRow(typeId)["fields_json"] as! String).utf8)) as? [[String: Any]]) ?? []
        var out: [String: String] = [:]
        for f in fields {
            guard let key = f["key"] as? String, let label = f["label"] as? String else { continue }
            let raw = values[key].map { "\($0)" }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if raw.isEmpty { continue }
            switch f["type"] as? String {
            case "number":
                guard Double(raw.replacingOccurrences(of: ",", with: ".")) != nil else { throw StoreError.invalid("\(label): keine Zahl") }
            case "date":
                guard raw.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { throw StoreError.invalid("\(label): Datum als JJJJ-MM-TT") }
            case "select":
                guard (f["options"] as? [String] ?? []).contains(raw) else { throw StoreError.invalid("\(label): „\(raw)“ ist keine erlaubte Auswahl") }
            case "url":
                guard raw.hasPrefix("https://") || raw.hasPrefix("http://") else { throw StoreError.invalid("\(label): Link muss mit https:// beginnen") }
            case "sequence":
                let seq = raw.uppercased().filter { !$0.isWhitespace && $0 != "-" }
                guard seq.range(of: "^[ACGTUNRYSWKMBDHV]+$", options: .regularExpression) != nil else { throw StoreError.invalid("\(label): nur Basen (A, C, G, T/U, IUPAC)") }
                out[key] = seq; continue
            case "bool":
                out[key] = ["1", "true", "ja"].contains(raw.lowercased()) ? "ja" : "nein"; continue
            default: break
            }
            out[key] = raw
        }
        return out
    }

    private func json(_ d: [String: String]) -> String { String(data: try! JSONSerialization.data(withJSONObject: d, options: [.sortedKeys]), encoding: .utf8)! }

    private func indexEntity(_ id: Int) throws {
        guard let e = try queryRows("SELECT e.no, e.name, e.fields_json, t.prefix FROM entity e JOIN rtype t ON t.id = e.type_id WHERE e.id = ?", [id]).first else { return }
        let code = Store.code(prefix: e["prefix"] as! String, no: e["no"] as! Int)
        let vals = ((try? JSONSerialization.jsonObject(with: Data((e["fields_json"] as! String).utf8))) as? [String: String] ?? [:]).values.joined(separator: " ")
        try queryRows("DELETE FROM entity_search WHERE rowid = ?", [id])
        try queryRows("INSERT INTO entity_search(rowid, code, name, fields) VALUES(?, ?, ?, ?)", [id, code + " " + code.replacingOccurrences(of: "-", with: ""), e["name"], vals])
    }

    func createEntity(typeId: Int, name: String, values: [String: Any], author: String) throws -> [String: Any] {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Name fehlt") }
        let clean = try cleanValues(typeId: typeId, values)
        let id: Int = try transactionRun {
            let t = try typeRow(typeId)
            let no = try queryRows("SELECT next_no FROM rtype WHERE id = ?", [typeId]).first!["next_no"] as! Int
            try queryRows("UPDATE rtype SET next_no = next_no + 1 WHERE id = ?", [typeId])
            let now = Store.now()
            try queryRows("INSERT INTO entity(type_id, no, name, fields_json, created, updated) VALUES(?, ?, ?, ?, ?, ?)", [typeId, no, n, json(clean), now, now])
            let id = lastID()
            try queryRows("INSERT INTO entity_history(entity_id, changed, name, fields_json, author) VALUES(?, ?, ?, ?, ?)", [id, now, n, json(clean), author])
            _ = t
            try indexEntity(id)
            return id
        }
        return try entity(id: id)
    }

    /// Ändern; jede Änderung landet im Verlauf (der sich nicht ändern lässt)
    func updateEntity(id: Int, name: String, values: [String: Any], author: String) throws -> [String: Any] {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Name fehlt") }
        guard let e = try queryRows("SELECT type_id, name, fields_json FROM entity WHERE id = ?", [id]).first else { throw StoreError.invalid("Objekt gibt es nicht") }
        let clean = json(try cleanValues(typeId: e["type_id"] as! Int, values))
        if clean == e["fields_json"] as? String, n == e["name"] as? String { return try entity(id: id) }
        try transactionRun {
            let now = Store.now()
            try queryRows("UPDATE entity SET name = ?, fields_json = ?, updated = ? WHERE id = ?", [n, clean, now, id])
            try queryRows("INSERT INTO entity_history(entity_id, changed, name, fields_json, author) VALUES(?, ?, ?, ?, ?)", [id, now, n, clean, author])
            try indexEntity(id)
        }
        return try entity(id: id)
    }

    func archiveEntity(id: Int, archived: Bool) throws { try queryRows("UPDATE entity SET archived = ? WHERE id = ?", [archived ? 1 : 0, id]) }

    func entity(id: Int) throws -> [String: Any] {
        guard var e = try queryRows("""
        SELECT e.id, e.type_id, e.no, e.name, e.fields_json, e.created, e.updated, e.archived, t.name AS type_name, t.prefix, t.icon, t.fields_json AS type_fields
        FROM entity e JOIN rtype t ON t.id = e.type_id WHERE e.id = ?
        """, [id]).first else { throw StoreError.invalid("Objekt gibt es nicht") }
        e["code"] = Store.code(prefix: e["prefix"] as! String, no: e["no"] as! Int)
        e["history"] = try queryRows("SELECT changed, name, fields_json, author FROM entity_history WHERE entity_id = ? ORDER BY id DESC", [id])
        e["used_in"] = try queryRows("SELECT en.id, en.title, en.kind, en.updated FROM entry_entity x JOIN entry en ON en.id = x.entry_id WHERE x.entity_id = ? AND en.deleted IS NULL ORDER BY en.updated DESC", [id])
        return e
    }

    /// Objekte eines Typs (oder aller Typen), optional gefiltert über die Suche
    func entities(typeId: Int?, q: String = "", archived: Bool = false) throws -> [[String: Any]] {
        var conds = ["e.archived = ?"], args: [Any?] = [archived ? 1 : 0]
        if let typeId { conds.append("e.type_id = ?"); args.append(typeId) }
        let terms = q.split(whereSeparator: { $0.isWhitespace }).map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"*" }
        if !terms.isEmpty { conds.append("e.id IN (SELECT rowid FROM entity_search WHERE entity_search MATCH ?)"); args.append(terms.joined(separator: " ")) }
        return try queryRows("""
        SELECT e.id, e.type_id, e.no, e.name, e.fields_json, e.updated, t.prefix, t.icon, t.name AS type_name,
          (SELECT COUNT(*) FROM entry_entity x JOIN entry en ON en.id = x.entry_id AND en.deleted IS NULL WHERE x.entity_id = e.id) AS uses
        FROM entity e JOIN rtype t ON t.id = e.type_id WHERE \(conds.joined(separator: " AND ")) ORDER BY t.name, e.no DESC LIMIT 2000
        """, args).map { r in var r = r; r["code"] = Store.code(prefix: r["prefix"] as! String, no: r["no"] as! Int); return r }
    }

    /// Verweise auf Objekte in einem Eintrag festhalten (aus dem Editor beim Speichern)
    func setEntryEntities(entry id: Int, _ ids: [Int]) throws {
        try queryRows("DELETE FROM entry_entity WHERE entry_id = ?", [id])
        for e in Set(ids) { try queryRows("INSERT INTO entry_entity(entry_id, entity_id) SELECT ?, id FROM entity WHERE id = ?", [id, e]) }
    }
}
