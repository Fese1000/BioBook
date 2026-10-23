// Zellkultur: Kulturen mit Passagenzahl; jede Änderung ist ein unveränderliches Ereignis (Passage, Mediumwechsel, Mycoplasma-Test,
// Einfrieren als Charge im Bestand, Auftauen aus einer Charge, Korrektur, Beenden).
// Gerätebuch: Geräte mit wiederkehrenden Aufgaben (Wartung, Kalibrierung …) und unveränderlichem Protokoll; fällige Aufgaben werden gemeldet.
import Foundation

extension Store {
    static let cultureEventKinds = ["passage", "medium", "myco", "freeze", "note", "correct", "end"]
    static let mycoResults = ["negativ", "positiv", "unklar"]
    static let deviceTaskKinds = ["wartung", "kalibrierung", "pruefung", "reinigung"]
    static let deviceLogKinds = deviceTaskKinds + ["stoerung", "reparatur", "notiz"]
    static let dueSoonDays = 14

    static func cultureCode(_ id: Int) -> String { "KU-\(String(format: "%05d", id))" }
    static func deviceCode(_ id: Int) -> String { "GE-\(String(format: "%05d", id))" }

    static func addDays(_ day: String, _ n: Int) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        guard let d = f.date(from: day), let r = Calendar.current.date(byAdding: .day, value: n, to: d) else { return day }
        return f.string(from: r)
    }

    /// Tag als JJJJ-MM-TT; leer → nil
    static func day(_ v: Any?, _ what: String = "Datum") throws -> String? {
        guard let s = (v as? String)?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        guard s.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { throw StoreError.invalid("\(what) als JJJJ-MM-TT") }
        return s
    }

    private static func int(_ v: Any?) -> Int? { number(v).flatMap { $0.isFinite && $0 == $0.rounded() ? Int($0) : nil } }
    private static func text(_ v: Any?) -> String { ((v as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    // MARK: Kulturen
    private func cultureRow(_ id: Int) throws -> [String: Any] {
        guard let c = try queryRows("SELECT * FROM culture WHERE id = ?", [id]).first else { throw StoreError.invalid("Kultur gibt es nicht") }
        return c
    }

    /// Warnungen: myco_due (letzter Test bzw. Start länger als myco_days her), myco_pos (letzter Test positiv), passage_high (≥ Höchstpassage)
    static func cultureWarnings(_ c: [String: Any], lastMyco: [String: Any]?, startDay: String, today: String) -> [String] {
        guard c["status"] as? String == "active" else { return [] }
        var w: [String] = []
        if lastMyco?["detail"] as? String == "positiv" { w.append("myco_pos") }
        let since = (lastMyco?["day"] as? String) ?? startDay, days = (c["myco_days"] as? Int) ?? 90
        if addDays(since, days) < today { w.append("myco_due") }
        if let m = c["max_passage"] as? Int, let p = c["passage"] as? Int, p >= m { w.append("passage_high") }
        return w
    }

    private func decorateCulture(_ c: [String: Any]) throws -> [String: Any] {
        var c = c
        let id = c["id"] as! Int
        c["code"] = Store.cultureCode(id)
        let lastMyco = try queryRows("SELECT day, detail FROM culture_event WHERE culture_id = ? AND kind = 'myco' ORDER BY day DESC, id DESC LIMIT 1", [id]).first
        let start = try queryRows("SELECT day FROM culture_event WHERE culture_id = ? ORDER BY id LIMIT 1", [id]).first?["day"] as? String ?? String((c["created"] as! String).prefix(10))
        c["last_myco"] = lastMyco ?? NSNull()
        c["start_day"] = start
        c["last_day"] = try queryRows("SELECT max(day) AS d FROM culture_event WHERE culture_id = ?", [id]).first?["d"] ?? NSNull()
        c["warnings"] = Store.cultureWarnings(c, lastMyco: lastMyco, startDay: start, today: Store.isoDay(Date()))
        if let e = c["entity_id"] as? Int, let ent = try queryRows("SELECT e.no, e.name, t.prefix FROM entity e JOIN rtype t ON t.id = e.type_id WHERE e.id = ?", [e]).first {
            c["entity_code"] = Store.code(prefix: ent["prefix"] as! String, no: ent["no"] as! Int)
            c["entity_name"] = ent["name"]
        }
        return c
    }

    /// Kulturen; filter: active | all | warnings | entity:<id>
    func cultures(filter: String = "active", q: String = "") throws -> [[String: Any]] {
        var conds: [String] = [], args: [Any?] = []
        if filter != "all" { conds.append("c.status = 'active'") }
        if filter.hasPrefix("entity:"), let e = Int(filter.dropFirst(7)) { conds.append("c.entity_id = ?"); args.append(e) }
        let t = q.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { conds.append("(c.name LIKE ? OR c.medium LIKE ? OR printf('KU-%05d', c.id) LIKE ?)"); args += Array(repeating: "%\(t)%", count: 3) }
        let rows = try queryRows("SELECT * FROM culture c \(conds.isEmpty ? "" : "WHERE " + conds.joined(separator: " AND ")) ORDER BY c.status, c.name COLLATE NOCASE, c.id", args).map(decorateCulture)
        return filter == "warnings" ? rows.filter { !($0["warnings"] as! [String]).isEmpty } : rows
    }

    func culture(id: Int) throws -> [String: Any] {
        var c = try decorateCulture(try cultureRow(id))
        c["events"] = try queryRows("""
        SELECT ev.id, ev.at, ev.day, ev.kind, ev.passage, ev.detail, ev.lot_id, ev.entry_id, ev.note, ev.author, e.title AS entry_title,
          CASE WHEN ev.lot_id IS NULL THEN NULL ELSE printf('BS-%05d', ev.lot_id) END AS lot_code
        FROM culture_event ev LEFT JOIN entry e ON e.id = ev.entry_id WHERE ev.culture_id = ? ORDER BY ev.id DESC
        """, [id])
        return c
    }

    private func insertCultureEvent(_ cid: Int, day: String, kind: String, passage: Int, detail: String = "", lot: Int? = nil, entry: Int?, note: String, author: String) throws -> Int {
        try queryRows("INSERT INTO culture_event(culture_id, at, day, kind, passage, detail, lot_id, entry_id, note, author) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      [cid, Store.now(), day, kind, passage, detail, lot, entry, note, author])
        return lastID()
    }

    private func checkEntry(_ entry: Int?) throws {
        if let e = entry, try queryRows("SELECT 1 FROM entry WHERE id = ?", [e]).isEmpty { throw StoreError.invalid("Eintrag gibt es nicht") }
    }

    /// Kultur anlegen (mit Startpassage, Ereignis „start“) oder Stammdaten ändern (die Passage ändert sich nur über Ereignisse)
    func saveCulture(id: Int?, values a: [String: Any], author: String) throws -> [String: Any] {
        let name = Store.text(a["name"])
        guard !name.isEmpty else { throw StoreError.invalid("Name der Kultur fehlt") }
        let entity = a["entity"] as? Int
        if let e = entity, try queryRows("SELECT 1 FROM entity WHERE id = ?", [e]).isEmpty { throw StoreError.invalid("Registry-Objekt gibt es nicht") }
        let maxP = Store.int(a["max_passage"]), maxGiven = a["max_passage"] is Int || a["max_passage"] is Double || !Store.text(a["max_passage"]).isEmpty
        if maxGiven, (maxP ?? 0) < 1 { throw StoreError.invalid("Höchstpassage: ganze Zahl ≥ 1") }
        let myco = Store.int(a["myco_days"]) ?? 90
        guard (1...3650).contains(myco) else { throw StoreError.invalid("Mycoplasma-Intervall: 1–3650 Tage") }
        let fields: [Any?] = [entity, name, Store.text(a["vessel"]), Store.text(a["medium"]), maxP, myco, Store.text(a["note"])]
        let now = Store.now()
        let cid: Int = try transactionRun {
            if let id {
                _ = try cultureRow(id)
                try queryRows("UPDATE culture SET entity_id = ?, name = ?, vessel = ?, medium = ?, max_passage = ?, myco_days = ?, note = ?, updated = ? WHERE id = ?", fields + [now, id])
                return id
            }
            let p = Store.int(a["passage"]) ?? 0
            guard p >= 0, p < 10_000 else { throw StoreError.invalid("Passage: ganze Zahl ≥ 0") }
            let start = try Store.day(a["day"], "Startdatum") ?? Store.isoDay(Date())
            try checkEntry(a["entry"] as? Int)
            try queryRows("INSERT INTO culture(entity_id, name, vessel, medium, max_passage, myco_days, note, passage, source_lot, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                          fields + [p, a["source_lot"] as? Int, now, now])
            let nid = lastID()
            _ = try insertCultureEvent(nid, day: start, kind: (a["source_lot"] as? Int) == nil ? "start" : "thaw", passage: p,
                                       detail: (a["source_lot"] as? Int).map(Store.lotCode) ?? "", lot: a["source_lot"] as? Int, entry: a["entry"] as? Int, note: "", author: author)
            return nid
        }
        return try culture(id: cid)
    }

    /// Ereignis buchen. values: day, note, split (Passage), vessel, result (Mycoplasma), count/location/position (Einfrieren), passage (Korrektur)
    func cultureEvent(id: Int, kind: String, values a: [String: Any], entry: Int?, author: String) throws -> [String: Any] {
        guard Store.cultureEventKinds.contains(kind) else { throw StoreError.invalid("Unbekanntes Ereignis") }
        try checkEntry(entry)
        let day = try Store.day(a["day"]) ?? Store.isoDay(Date()), note = Store.text(a["note"])
        return try transactionRun {
            let c = try cultureRow(id)
            guard c["status"] as? String == "active" else { throw StoreError.invalid("Die Kultur ist beendet") }
            let before = c["passage"] as! Int
            var p = before, detail = "", lot: Int? = nil, status = "active", vessel = c["vessel"] as! String
            switch kind {
            case "passage":
                p += 1
                detail = Store.text(a["split"])
                if !Store.text(a["vessel"]).isEmpty { vessel = Store.text(a["vessel"]) }
            case "myco":
                detail = Store.text(a["result"])
                guard Store.mycoResults.contains(detail) else { throw StoreError.invalid("Mycoplasma-Ergebnis: negativ, positiv oder unklar") }
            case "freeze":
                guard let n = Store.int(a["count"]), (1...500).contains(n) else { throw StoreError.invalid("Anzahl Röhrchen: 1–500") }
                var lv: [String: Any] = ["name": "\(c["name"]!) P\(p)", "unit": "Röhrchen", "amount": Double(n),
                                         "note": "Eingefroren aus \(Store.cultureCode(id)) am \(day)\(note.isEmpty ? "" : " – \(note)")"]
                for k in ["location", "position"] { if let v = a[k] { lv[k] = v } }
                if let e = c["entity_id"] as? Int { lv["entity"] = e }
                lot = try saveLot(id: nil, values: lv, author: author)["id"] as? Int
                detail = "\(n) Röhrchen"
            case "correct":
                guard let np = Store.int(a["passage"]), np >= 0 else { throw StoreError.invalid("Neue Passage: ganze Zahl ≥ 0") }
                guard !note.isEmpty else { throw StoreError.invalid("Grund der Korrektur fehlt") }
                p = np; detail = "P\(before) → P\(np)"
            case "end": status = "ended"
            default: break
            }
            try queryRows("UPDATE culture SET passage = ?, status = ?, vessel = ?, updated = ? WHERE id = ?", [p, status, vessel, Store.now(), id])
            let ev = try insertCultureEvent(id, day: day, kind: kind, passage: p, detail: detail, lot: lot, entry: entry, note: note, author: author)
            return ["event": ev, "from": before, "passage": p, "detail": detail, "lot": lot ?? NSNull(), "day": day,
                    "code": Store.cultureCode(id), "name": c["name"]!]
        }
    }

    /// Eingefrorene Röhrchen (Chargen aus „Einfrieren“, noch vorhanden) mit Kultur und Passage
    func frozenStock() throws -> [[String: Any]] {
        try queryRows("""
        SELECT l.id AS lot_id, printf('BS-%05d', l.id) AS lot_code, l.amount, l.location_id, l.position, ev.day, ev.passage,
          c.id AS culture_id, c.name AS culture_name, printf('KU-%05d', c.id) AS culture_code
        FROM culture_event ev JOIN lot l ON l.id = ev.lot_id JOIN culture c ON c.id = ev.culture_id
        WHERE ev.kind = 'freeze' AND l.status = 'active' ORDER BY c.name COLLATE NOCASE, ev.day
        """).map { r in var r = r; r["location_path"] = try locationPath(r["location_id"] as? Int); return r }
    }

    /// Auftauen: ein Röhrchen aus der Charge abbuchen und eine neue Kultur mit der eingefrorenen Passage anlegen
    func thawCulture(lot lotId: Int, name: String?, entry: Int?, author: String) throws -> [String: Any] {
        try transactionRun {
            let l = try lot(id: lotId)
            guard l["status"] as? String == "active" else { throw StoreError.invalid("Die Charge ist leer oder entsorgt") }
            let src = try queryRows("SELECT c.*, ev.passage AS frozen_passage FROM culture_event ev JOIN culture c ON c.id = ev.culture_id WHERE ev.lot_id = ? AND ev.kind = 'freeze'", [lotId]).first
            _ = try moveLot(id: lotId, delta: -1, kind: "verbrauch", entry: entry, note: "Aufgetaut", author: author)
            var v: [String: Any] = ["name": Store.text(name).isEmpty ? ((src?["name"] as? String) ?? (l["name"] as! String)) : Store.text(name),
                                    "passage": (src?["frozen_passage"] as? Int) ?? 0, "source_lot": lotId, "myco_days": (src?["myco_days"] as? Int) ?? 90,
                                    "medium": (src?["medium"] as? String) ?? "", "vessel": (src?["vessel"] as? String) ?? ""]
            if let e = (src?["entity_id"] as? Int) ?? (l["entity_id"] as? Int) { v["entity"] = e }
            if let m = src?["max_passage"] as? Int { v["max_passage"] = m }
            if let e = entry { v["entry"] = e }
            return try saveCulture(id: nil, values: v, author: author)
        }
    }

    // MARK: Geräte
    private func deviceRow(_ id: Int) throws -> [String: Any] {
        guard let d = try queryRows("SELECT * FROM device WHERE id = ?", [id]).first else { throw StoreError.invalid("Gerät gibt es nicht") }
        return d
    }

    /// Fälligkeit einer Aufgabe: overdue (vor heute), due (in den nächsten 14 Tagen), sonst leer
    static func taskState(_ nextDue: String, today: String) -> String {
        nextDue < today ? "overdue" : nextDue <= addDays(today, dueSoonDays) ? "due" : ""
    }

    private func decorateDevice(_ d: [String: Any]) throws -> [String: Any] {
        var d = d
        let id = d["id"] as! Int, today = Store.isoDay(Date())
        d["code"] = Store.deviceCode(id)
        d["location_path"] = try locationPath(d["location_id"] as? Int)
        let tasks = try queryRows("SELECT * FROM device_task WHERE device_id = ? AND archived = 0 ORDER BY next_due", [id]).map { t in
            var t = t; t["state"] = Store.taskState(t["next_due"] as! String, today: today); return t
        }
        d["tasks"] = tasks
        d["next_due"] = tasks.first?["next_due"] ?? NSNull()
        var w = Set(tasks.compactMap { ($0["state"] as? String).flatMap { $0.isEmpty ? nil : $0 } })
        if d["status"] as? String == "defekt" { w.insert("defect") }
        d["warnings"] = ["defect", "overdue", "due"].filter(w.contains)
        return d
    }

    /// Geräte; filter: all | warnings
    func devices(filter: String = "all", q: String = "") throws -> [[String: Any]] {
        var conds = ["d.archived = 0"], args: [Any?] = []
        let t = q.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { conds.append("(d.name LIKE ? OR d.model LIKE ? OR d.serial LIKE ? OR printf('GE-%05d', d.id) LIKE ?)"); args += Array(repeating: "%\(t)%", count: 4) }
        let rows = try queryRows("SELECT * FROM device d WHERE \(conds.joined(separator: " AND ")) ORDER BY d.name COLLATE NOCASE", args).map(decorateDevice)
        return filter == "warnings" ? rows.filter { !($0["warnings"] as! [String]).isEmpty } : rows
    }

    func device(id: Int) throws -> [String: Any] {
        var d = try decorateDevice(try deviceRow(id))
        d["log"] = try queryRows("""
        SELECT g.id, g.at, g.day, g.kind, g.result, g.note, g.task_id, g.entry_id, g.author, t.title AS task_title, e.title AS entry_title
        FROM device_log g LEFT JOIN device_task t ON t.id = g.task_id LEFT JOIN entry e ON e.id = g.entry_id WHERE g.device_id = ? ORDER BY g.day DESC, g.id DESC
        """, [id])
        return d
    }

    func saveDevice(id: Int?, values a: [String: Any]) throws -> [String: Any] {
        let name = Store.text(a["name"])
        guard !name.isEmpty else { throw StoreError.invalid("Name des Geräts fehlt") }
        let loc = a["location"] as? Int
        if let l = loc, try queryRows("SELECT 1 FROM location WHERE id = ?", [l]).isEmpty { throw StoreError.invalid("Standort gibt es nicht") }
        let fields: [Any?] = [name, Store.text(a["model"]), Store.text(a["serial"]), loc, Store.text(a["note"])], now = Store.now()
        if let id {
            _ = try deviceRow(id)
            try queryRows("UPDATE device SET name = ?, model = ?, serial = ?, location_id = ?, note = ?, updated = ? WHERE id = ?", fields + [now, id])
            return try device(id: id)
        }
        try queryRows("INSERT INTO device(name, model, serial, location_id, note, created, updated) VALUES(?,?,?,?,?,?,?)", fields + [now, now])
        return try device(id: lastID())
    }

    /// Wiederkehrende Aufgabe anlegen oder ändern; erste Fälligkeit: angegeben oder heute + Intervall
    func saveDeviceTask(id: Int?, device: Int, values a: [String: Any]) throws -> [String: Any] {
        _ = try deviceRow(device)
        let kind = Store.text(a["kind"])
        guard Store.deviceTaskKinds.contains(kind) else { throw StoreError.invalid("Art der Aufgabe unbekannt") }
        guard let iv = Store.int(a["interval"]), (1...3650).contains(iv) else { throw StoreError.invalid("Intervall: 1–3650 Tage") }
        let title = Store.text(a["title"]).isEmpty ? ["wartung": "Wartung", "kalibrierung": "Kalibrierung", "pruefung": "Prüfung", "reinigung": "Reinigung"][kind]! : Store.text(a["title"])
        let due = try Store.day(a["next_due"], "Nächste Fälligkeit") ?? Store.addDays(Store.isoDay(Date()), iv)
        if let id {
            try queryRows("UPDATE device_task SET kind = ?, title = ?, interval_days = ?, next_due = ? WHERE id = ? AND device_id = ?", [kind, title, iv, due, id, device])
        } else {
            try queryRows("INSERT INTO device_task(device_id, kind, title, interval_days, next_due, created) VALUES(?,?,?,?,?,?)", [device, kind, title, iv, due, Store.now()])
        }
        return try self.device(id: device)
    }

    func archiveDeviceTask(id: Int) throws { try queryRows("UPDATE device_task SET archived = 1 WHERE id = ?", [id]) }

    /// Protokolleintrag. Mit Aufgabe: Art kommt von der Aufgabe, nächste Fälligkeit = Tag + Intervall.
    /// Ergebnis „defekt“ oder Störung setzt das Gerät auf defekt; Reparatur oder ein Ergebnis „ok“ nach Störung macht es wieder einsatzbereit.
    func logDevice(id: Int, task: Int?, kind k: String?, result r: String?, values a: [String: Any], entry: Int?, author: String) throws -> [String: Any] {
        try checkEntry(entry)
        let day = try Store.day(a["day"]) ?? Store.isoDay(Date()), note = Store.text(a["note"])
        return try transactionRun {
            let d = try deviceRow(id)
            var kind = k ?? "", t: [String: Any]? = nil
            if let task {
                guard let row = try queryRows("SELECT * FROM device_task WHERE id = ? AND device_id = ?", [task, id]).first else { throw StoreError.invalid("Aufgabe gibt es nicht") }
                t = row; kind = row["kind"] as! String
            }
            guard Store.deviceLogKinds.contains(kind) else { throw StoreError.invalid("Art des Protokolleintrags unbekannt") }
            let result = r ?? (kind == "stoerung" ? "defekt" : "ok")
            guard ["ok", "abweichung", "defekt"].contains(result) else { throw StoreError.invalid("Ergebnis: ok, abweichung oder defekt") }
            if kind == "notiz" && note.isEmpty { throw StoreError.invalid("Notiz fehlt") }
            var nextDue: String? = nil
            if let t {
                nextDue = Store.addDays(day, t["interval_days"] as! Int)
                try queryRows("UPDATE device_task SET next_due = ? WHERE id = ?", [nextDue, t["id"]])
            }
            let status = result == "defekt" ? "defekt" : (kind == "reparatur" || (t != nil && result == "ok")) ? "ok" : (d["status"] as! String)
            try queryRows("UPDATE device SET status = ?, updated = ? WHERE id = ?", [status, Store.now(), id])
            try queryRows("INSERT INTO device_log(device_id, task_id, at, day, kind, result, note, entry_id, author) VALUES(?,?,?,?,?,?,?,?,?)",
                          [id, task, Store.now(), day, kind, result, note, entry, author])
            return ["log": lastID(), "next_due": nextDue ?? NSNull(), "status": status, "kind": kind, "result": result]
        }
    }

    /// Für die Seitenleiste: Kulturen und Geräte mit Warnungen
    func careWarnings() throws -> [String: Int] {
        ["cultures": try cultures(filter: "warnings").count, "devices": try devices(filter: "warnings").count]
    }
}
