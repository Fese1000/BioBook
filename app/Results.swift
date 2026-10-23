// Strukturierte Ergebnisse: Vorlagen mit festen Feldern (Zahl mit Einheit, Text, Datum, Auswahl, Formel) und Ergebniszeilen je Eintrag.
// Die Zeilen stehen im Eintrag (Block); beim Speichern wird ein Abbild hier abgelegt, damit sich über viele Einträge auswerten lässt.
import Foundation

extension Store {
    static let resultFieldTypes = ["number", "text", "date", "select", "formula"]

    static let defaultResultSchemas: [(String, [[String: Any]])] = [
        ("Plasmid-Präp", [["key": "probe", "label": "Probe", "type": "text"], ["key": "konz", "label": "Konzentration", "type": "number", "unit": "ng/µl"],
                          ["key": "a260_280", "label": "A260/280", "type": "number"], ["key": "a260_230", "label": "A260/230", "type": "number"],
                          ["key": "volumen", "label": "Volumen", "type": "number", "unit": "µl"],
                          ["key": "ausbeute", "label": "Ausbeute", "type": "formula", "unit": "µg", "expr": "konz * volumen / 1000"]]),
        ("Proteinbestimmung", [["key": "probe", "label": "Probe", "type": "text"], ["key": "messwert", "label": "Konzentration (Messung)", "type": "number", "unit": "µg/ml"],
                               ["key": "verd", "label": "Verdünnung", "type": "number", "unit": "×"],
                               ["key": "konz", "label": "Konzentration (Probe)", "type": "formula", "unit": "µg/ml", "expr": "messwert * verd"]]),
        ("qPCR", [["key": "probe", "label": "Probe", "type": "text"], ["key": "gen", "label": "Gen", "type": "text"],
                  ["key": "ct", "label": "Ct", "type": "number"], ["key": "ct_ref", "label": "Ct Referenzgen", "type": "number"],
                  ["key": "dct", "label": "ΔCt", "type": "formula", "expr": "ct - ct_ref"]]),
    ]

    func resultSchemas() throws -> [[String: Any]] {
        try queryRows("""
        SELECT s.id, s.name, s.fields_json, s.archived,
          (SELECT COUNT(*) FROM result_row r JOIN entry e ON e.id = r.entry_id AND e.deleted IS NULL WHERE r.schema_id = s.id) AS rows
        FROM result_schema s ORDER BY s.archived, s.name COLLATE NOCASE
        """)
    }

    static func cleanResultFields(_ raw: [[String: Any]]) throws -> [[String: Any]] {
        var seen = Set<String>()
        let fields: [[String: Any]] = try raw.map { f in
            guard let key = f["key"] as? String, key.range(of: "^[a-z][a-z0-9_]{0,30}$", options: .regularExpression) != nil, seen.insert(key).inserted else {
                throw StoreError.invalid("Feldschlüssel ungültig oder doppelt: \(f["key"] ?? "")")
            }
            let type = (f["type"] as? String) ?? "number"
            guard resultFieldTypes.contains(type) else { throw StoreError.invalid("Feldtyp unbekannt: \(type)") }
            var out: [String: Any] = ["key": key, "label": ((f["label"] as? String) ?? key).trimmingCharacters(in: .whitespaces), "type": type]
            if let u = (f["unit"] as? String)?.trimmingCharacters(in: .whitespaces), !u.isEmpty { out["unit"] = u }
            if type == "select" {
                let opts = ((f["options"] as? [String]) ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                guard !opts.isEmpty else { throw StoreError.invalid("Auswahlfeld braucht Optionen") }
                out["options"] = opts
            }
            if type == "formula" {
                guard let e = (f["expr"] as? String)?.trimmingCharacters(in: .whitespaces), !e.isEmpty else { throw StoreError.invalid("Formelfeld braucht eine Formel") }
                out["expr"] = e
            }
            return out
        }
        // Formeln dürfen nur vorhandene Felder benutzen (die genaue Prüfung macht die Oberfläche beim Rechnen)
        let keys = Set(fields.map { $0["key"] as! String })
        let fnNames: Set<String> = ["sqrt", "log10", "ln", "abs", "round", "min", "max", "e"]
        for f in fields where f["type"] as? String == "formula" {
            let expr = f["expr"] as! String
            let ids = expr.matches(of: try Regex("[a-zA-Z_][a-zA-Z0-9_]*")).map { String(expr[$0.range]) }  // als Text, weil „*/“ im Regex-Literal einen Kommentar beendet
            for id in ids where !keys.contains(id) && !fnNames.contains(id) { throw StoreError.invalid("Formel „\(expr)“: unbekanntes Feld \(id)") }
        }
        return fields
    }

    func saveResultSchema(id: Int?, name: String, fields: [[String: Any]]) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Name der Vorlage fehlt") }
        let clean = try Store.cleanResultFields(fields)
        guard !clean.isEmpty else { throw StoreError.invalid("Die Vorlage braucht mindestens ein Feld") }
        let json = String(data: try JSONSerialization.data(withJSONObject: clean), encoding: .utf8)!
        if let id {
            try queryRows("UPDATE result_schema SET name = ?, fields_json = ? WHERE id = ?", [n, json, id])
            return id
        }
        try queryRows("INSERT INTO result_schema(name, fields_json, created) VALUES(?, ?, ?)", [n, json, Store.now()])
        return lastID()
    }

    /// Ergebnisse eines Eintrags ersetzen (beim Speichern); results: [{schema, rows: [{feld: wert}]}]
    func setEntryResults(entry id: Int, _ results: [[String: Any]]) throws {
        try queryRows("DELETE FROM result_row WHERE entry_id = ?", [id])
        var no = 0
        for r in results {
            guard let schema = r["schema"] as? Int, try !queryRows("SELECT 1 FROM result_schema WHERE id = ?", [schema]).isEmpty else { continue }
            for row in (r["rows"] as? [[String: Any]]) ?? [] {
                let vals = row.filter { !"\($0.value)".trimmingCharacters(in: .whitespaces).isEmpty }
                if vals.isEmpty { continue }
                no += 1
                let json = String(data: try JSONSerialization.data(withJSONObject: vals, options: [.sortedKeys]), encoding: .utf8)!
                try queryRows("INSERT INTO result_row(entry_id, schema_id, row_no, values_json) VALUES(?, ?, ?, ?)", [id, schema, no, json])
            }
        }
    }

    /// Alle Zeilen einer Vorlage über alle Einträge (ohne Papierkorb); optional nach Projekt und Zeitraum (JJJJ-MM-TT)
    func resultRows(schema: Int, project: Int? = nil, from: String? = nil, to: String? = nil) throws -> [[String: Any]] {
        var conds = ["r.schema_id = ?", "e.deleted IS NULL"], args: [Any?] = [schema]
        if let p = project { if p == 0 { conds.append("e.project_id IS NULL") } else { conds.append("e.project_id = ?"); args.append(p) } }
        if let f = from, !f.isEmpty { conds.append("substr(e.created, 1, 10) >= ?"); args.append(f) }
        if let t = to, !t.isEmpty { conds.append("substr(e.created, 1, 10) <= ?"); args.append(t) }
        return try queryRows("""
        SELECT r.entry_id, r.row_no, r.values_json, e.title, e.created, e.project_id
        FROM result_row r JOIN entry e ON e.id = r.entry_id WHERE \(conds.joined(separator: " AND ")) ORDER BY e.created, r.row_no
        """, args)
    }
}
