// Fälligkeiten über das ganze Buch: Aufgaben mit Datum aus Einträgen, Geräteaufgaben, Mycoplasma-Tests, Ablauf von Chargen.
import Foundation

extension Store {
    /// Aufgaben eines Eintrags ersetzen (beim Speichern); tasks: [{text, due (JJJJ-MM-TT), done}]
    func setEntryTasks(entry id: Int, _ tasks: [[String: Any]]) throws {
        try queryRows("DELETE FROM entry_task WHERE entry_id = ?", [id])
        for (i, t) in tasks.enumerated() {
            guard let due = (try? Store.day(t["due"])) ?? nil, let text = t["text"] as? String else { continue }  // ungültiges Datum: Aufgabe ohne Termin
            try queryRows("INSERT INTO entry_task(entry_id, idx, text, due, done) VALUES(?,?,?,?,?)", [id, i, String(text.prefix(300)), due, (t["done"] as? Bool) == true ? 1 : 0])
        }
    }

    /// Alles Fällige bis einschließlich until (Überfälliges immer): {kind, due, title, sub, t (Ziel), id, uid}
    func agenda(until: String, today: String) throws -> [[String: Any]] {
        var out: [[String: Any]] = []
        let book = bookID
        for r in try queryRows("""
        SELECT t.entry_id, t.idx, t.text, t.due, e.title FROM entry_task t JOIN entry e ON e.id = t.entry_id
        WHERE t.done = 0 AND e.deleted IS NULL AND t.due <= ? ORDER BY t.due
        """, [until]) {
            out.append(["kind": "task", "due": r["due"]!, "title": r["text"]!, "sub": r["title"] ?? "", "t": "entry", "id": r["entry_id"]!, "uid": "\(book)-task-\(r["entry_id"]!)-\(r["idx"]!)"])
        }
        for r in try queryRows("""
        SELECT t.id, t.title, t.next_due, d.id AS device, d.name FROM device_task t JOIN device d ON d.id = t.device_id
        WHERE t.archived = 0 AND d.archived = 0 AND t.next_due <= ? ORDER BY t.next_due
        """, [until]) {
            out.append(["kind": "device", "due": r["next_due"]!, "title": "\(r["title"]!): \(r["name"]!)", "sub": "Gerät", "t": "device", "id": r["device"]!, "uid": "\(book)-devtask-\(r["id"]!)"])
        }
        for c in try cultures(filter: "active") {
            let since = ((c["last_myco"] as? [String: Any])?["day"] as? String) ?? (c["start_day"] as! String)
            let due = Store.addDays(since, (c["myco_days"] as? Int) ?? 90)
            if due <= until {
                out.append(["kind": "myco", "due": due, "title": "Mycoplasma-Test: \(c["name"]!)", "sub": "\(c["code"]!) · P\(c["passage"]!)", "t": "culture", "id": c["id"]!, "uid": "\(book)-myco-\(c["id"]!)-\(due)"])
            }
        }
        for l in try queryRows("SELECT id, name, expiry, lot_no FROM lot WHERE status = 'active' AND expiry IS NOT NULL AND expiry <= ? ORDER BY expiry", [until]) {
            out.append(["kind": "expiry", "due": l["expiry"]!, "title": "Läuft ab: \(l["name"]!)", "sub": "\(Store.lotCode(l["id"] as! Int))\((l["lot_no"] as? String).map { $0.isEmpty ? "" : " · Ch. \($0)" } ?? "")",
                       "t": "lot", "id": l["id"]!, "uid": "\(book)-lot-\(l["id"]!)"])
        }
        return out.sorted { ($0["due"] as! String) < ($1["due"] as! String) }
    }
}
