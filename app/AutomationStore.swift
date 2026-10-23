// Automatisierung, Speicherteil: Eintrag aus Text anlegen, Text anhängen, Text lesen (getestet in tests/main.swift).
import Foundation

extension Store {
    /// Text als Absätze im Editor-Format (TipTap/ProseMirror-JSON)
    static func paragraphs(_ text: String) -> [[String: Any]] {
        text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").map { line in
            line.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": [["type": "text", "text": line]]]
        }
    }

    /// Neuer Eintrag mit Titel und Text (Titel leer: erste Zeile des Textes)
    func newEntry(title: String, text: String) throws -> Int {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let finalTitle = String((t.isEmpty ? firstLine : t).prefix(120))
        let id = try create(title: finalTitle)
        if !text.isEmpty {
            let json = String(data: try JSONSerialization.data(withJSONObject: ["type": "doc", "content": Store.paragraphs(text)]), encoding: .utf8)!
            _ = try saveDraft(id: id, title: finalTitle, json: json, text: text)
        }
        return id
    }

    /// Titel, Arbeitsstand und Suchtext (load liefert den Suchtext nicht mit)
    private func entryRow(_ id: Int) throws -> [String: Any] {
        guard let e = try queryRows("SELECT title, draft_json, draft_text FROM entry WHERE id = ?", [id]).first else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        return e
    }

    /// Text unten an einen Eintrag anhängen (nicht bei abgeschlossenen oder gelöschten Einträgen).
    /// Ändert nur Inhalt und Suchtext – Verweise, Dateien, Ergebnisse und Aufgaben des Eintrags bleiben, wie sie sind.
    func appendText(entry id: Int, text: String) throws {
        guard let st = try queryRows("SELECT signed_no, deleted FROM entry WHERE id = ?", [id]).first else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        if st["deleted"] as? String != nil { throw StoreError.invalid("Der Eintrag liegt im Papierkorb. Erst wiederherstellen.") }
        if st["signed_no"] as? Int != nil { throw StoreError.invalid("Der Eintrag ist abgeschlossen und signiert. Änderungen bitte als Nachtrag.") }
        let e = try entryRow(id)
        var doc = ((try? JSONSerialization.jsonObject(with: Data(((e["draft_json"] as? String) ?? "").utf8))) as? [String: Any]) ?? [:]
        if doc["type"] as? String != "doc" { doc = ["type": "doc", "content": [Any]()] }
        doc["content"] = ((doc["content"] as? [Any]) ?? []) + Store.paragraphs(text)
        let json = String(data: try JSONSerialization.data(withJSONObject: doc), encoding: .utf8)!
        let old = (e["draft_text"] as? String) ?? "", body = old.isEmpty ? text : old + "\n" + text
        try transactionRun {
            try queryRows("UPDATE entry SET draft_json = ?, draft_text = ?, updated = ? WHERE id = ?", [json, body, Store.now(), id])
            try queryRows("UPDATE search SET body = ? WHERE rowid = ?", [body, id])
        }
    }

    /// Volltext eines Eintrags (Titel und Text)
    func entryText(id: Int) throws -> String {
        let e = try entryRow(id)
        return [(e["title"] as? String) ?? "", (e["draft_text"] as? String) ?? ""].filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}
