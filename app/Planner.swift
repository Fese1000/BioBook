// Kalender-Planung: Termine und geplante Experimente an einem Tag (oder über mehrere Tage), mit Uhrzeit und Notiz.
// Zu einem Plan lässt sich ein Eintrag anlegen, der gleich den passenden Tagesabschnitt hat; der Plan merkt sich den Eintrag.
import Foundation

extension Store {
    static let planKinds = ["termin", "experiment"]

    private static func isDay(_ s: String) -> Bool { s.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil }
    private static func isTime(_ s: String) -> Bool { s.isEmpty || s.range(of: "^([01]\\d|2[0-3]):[0-5]\\d$", options: .regularExpression) != nil }

    /// Pläne, die den Zeitraum berühren (Mehrtägiges zählt für jeden Tag), mit Titel des verknüpften Eintrags
    func plans(from: String, to: String) throws -> [[String: Any]] {
        try queryRows("""
        SELECT p.*, e.title AS entry_title FROM plan p LEFT JOIN entry e ON e.id = p.entry_id AND e.deleted IS NULL
        WHERE p.day <= ?2 AND (CASE WHEN p.day_end = '' THEN p.day ELSE p.day_end END) >= ?1
        ORDER BY p.day, CASE WHEN p.time_from = '' THEN '99:99' ELSE p.time_from END, p.id
        """, [from, to])
    }

    @discardableResult
    func savePlan(id: Int?, values v: [String: Any]) throws -> Int {
        func s(_ k: String) -> String { (v[k] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        let day = s("day"), end = s("day_end") == day ? "" : s("day_end"), from = s("time_from"), to = s("time_to"), title = s("title")
        let kind = s("kind").isEmpty ? "termin" : s("kind")
        guard !title.isEmpty else { throw StoreError.invalid("Bitte einen Titel angeben") }
        guard Store.isDay(day) else { throw StoreError.invalid("Das Datum fehlt oder ist ungültig") }
        guard end.isEmpty || (Store.isDay(end) && end > day) else { throw StoreError.invalid("Das Ende muss nach dem ersten Tag liegen") }
        guard Store.isTime(from), Store.isTime(to) else { throw StoreError.invalid("Uhrzeit bitte als HH:MM") }
        guard to.isEmpty || from.isEmpty || !end.isEmpty || to >= from else { throw StoreError.invalid("Das Ende der Uhrzeit liegt vor dem Beginn") }
        guard Store.planKinds.contains(kind) else { throw StoreError.invalid("Art muss Termin oder Experiment sein") }
        let args: [Any?] = [day, end, from, to, title, kind, s("note"), v["done"] as? Bool == true ? 1 : 0]
        if let id {
            guard try queryRows("SELECT 1 FROM plan WHERE id = ?", [id]).first != nil else { throw StoreError.invalid("Den Plan gibt es nicht") }
            try queryRows("UPDATE plan SET day = ?, day_end = ?, time_from = ?, time_to = ?, title = ?, kind = ?, note = ?, done = ? WHERE id = ?", args + [id])
            return id
        }
        try queryRows("INSERT INTO plan(day, day_end, time_from, time_to, title, kind, note, done, created) VALUES(?,?,?,?,?,?,?,?,?)", args + [Store.now()])
        return try queryRows("SELECT last_insert_rowid() AS id").first!["id"] as! Int
    }

    func deletePlan(id: Int) throws { try queryRows("DELETE FROM plan WHERE id = ?", [id]) }

    func setPlanDone(id: Int, done: Bool) throws { try queryRows("UPDATE plan SET done = ? WHERE id = ?", [done ? 1 : 0, id]) }

    /// Eintrag zum Plan: Titel wie der Plan, Tagesabschnitt am Starttag; gibt es schon einen, wird er zurückgegeben
    func entryForPlan(id: Int) throws -> Int {
        guard let p = try queryRows("SELECT * FROM plan WHERE id = ?", [id]).first else { throw StoreError.invalid("Den Plan gibt es nicht") }
        if let e = p["entry_id"] as? Int, try queryRows("SELECT 1 FROM entry WHERE id = ? AND deleted IS NULL", [e]).first != nil { return e }
        let title = p["title"] as! String, day = p["day"] as! String, note = (p["note"] as? String) ?? ""
        let kind = (p["kind"] as? String) == "termin" ? "note" : "experiment"
        return try transactionRun {
            let eid = try create(title: title, kind: kind)
            let body: [[String: Any]] = note.isEmpty ? [["type": "paragraph"]] : Store.paragraphs(note)
            let doc: [String: Any] = ["type": "doc", "content": [["type": "day", "attrs": ["date": day], "content": body]]]
            let json = String(data: try JSONSerialization.data(withJSONObject: doc), encoding: .utf8)!
            _ = try saveDraft(id: eid, title: title, json: json, text: note, days: [day])
            try queryRows("UPDATE plan SET entry_id = ? WHERE id = ?", [eid, id])
            return eid
        }
    }
}
