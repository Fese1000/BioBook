// Bestand: Standorte als Baum (Raum › Gerät › Regal › Box mit Raster), Chargen mit Menge, Ablauf, Mindestbestand,
// Gefahren (GHS) und Sicherheitsdatenblatt. Jede Mengenänderung ist eine unveränderliche Bewegung (Anlegen, Verbrauch, Korrektur, …).
import Foundation

extension Store {
    static let locationKinds = ["raum", "geraet", "regal", "box", "ort"]
    static let ghsCodes = (1...9).map { "GHS0\($0)" }
    static let soonDays = 30

    static func lotCode(_ id: Int) -> String { "BS-\(String(format: "%05d", id))" }

    // MARK: Standorte
    func locations() throws -> [[String: Any]] {
        try queryRows("""
        SELECT l.id, l.parent_id, l.name, l.kind, l.rows, l.cols, l.temp, l.archived,
          (SELECT COUNT(*) FROM lot WHERE lot.location_id = l.id AND lot.status = 'active') AS lots
        FROM location l ORDER BY l.name COLLATE NOCASE
        """)
    }

    /// Pfad wie „Labor 2 › Gefrierschrank −80 › Regal 3 › Box A“
    func locationPath(_ id: Int?) throws -> String {
        var parts: [String] = [], cur = id, guardCount = 0
        while let c = cur, guardCount < 20, let r = try queryRows("SELECT name, parent_id FROM location WHERE id = ?", [c]).first {
            parts.insert(r["name"] as! String, at: 0); cur = r["parent_id"] as? Int; guardCount += 1
        }
        return parts.joined(separator: " › ")
    }

    func saveLocation(id: Int?, parent: Int?, name: String, kind: String, rows: Int?, cols: Int?, temp: String) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Name des Standorts fehlt") }
        guard Store.locationKinds.contains(kind) else { throw StoreError.invalid("Unbekannte Art des Standorts") }
        if kind == "box" {
            guard let r = rows, let c = cols, (1...26).contains(r), (1...48).contains(c) else { throw StoreError.invalid("Box: 1–26 Reihen (A–Z) und 1–48 Spalten") }
        }
        if let p = parent {
            guard try !queryRows("SELECT 1 FROM location WHERE id = ?", [p]).isEmpty else { throw StoreError.invalid("Übergeordneter Standort fehlt") }
            // keine Schleifen: der neue Elternteil darf nicht unterhalb dieses Standorts liegen
            var cur: Int? = p
            while let c = cur { if c == id { throw StoreError.invalid("Ein Standort kann nicht in sich selbst liegen") }; cur = try queryRows("SELECT parent_id FROM location WHERE id = ?", [c]).first?["parent_id"] as? Int }
        }
        let r = kind == "box" ? rows : nil, c = kind == "box" ? cols : nil
        if let id {
            try queryRows("UPDATE location SET parent_id = ?, name = ?, kind = ?, rows = ?, cols = ?, temp = ? WHERE id = ?", [parent, n, kind, r, c, temp, id])
            return id
        }
        try queryRows("INSERT INTO location(parent_id, name, kind, rows, cols, temp, created) VALUES(?,?,?,?,?,?,?)", [parent, n, kind, r, c, temp, Store.now()])
        return lastID()
    }

    /// Position in einer Box prüfen: „A3“ = Reihe A, Spalte 3
    func checkPosition(location: Int?, position: String?) throws -> String? {
        guard let pos = position?.trimmingCharacters(in: .whitespaces).uppercased(), !pos.isEmpty else { return nil }
        guard let loc = location, let l = try queryRows("SELECT kind, rows, cols FROM location WHERE id = ?", [loc]).first else {
            throw StoreError.invalid("Eine Position gibt es nur in einer Box")
        }
        guard l["kind"] as? String == "box", let rows = l["rows"] as? Int, let cols = l["cols"] as? Int,
              let m = pos.range(of: "^[A-Z][0-9]{1,2}$", options: .regularExpression), m == pos.startIndex..<pos.endIndex else {
            throw StoreError.invalid("Position wie A3 angeben (nur in Boxen)")
        }
        let r = Int(pos.unicodeScalars.first!.value) - 64, c = Int(pos.dropFirst())!
        guard r >= 1, r <= rows, c >= 1, c <= cols else { throw StoreError.invalid("Position \(pos) liegt außerhalb der Box (\(rows) × \(cols))") }
        return pos
    }

    // MARK: Chargen
    private func lotRow(_ id: Int) throws -> [String: Any] {
        guard let l = try queryRows("SELECT * FROM lot WHERE id = ?", [id]).first else { throw StoreError.invalid("Charge gibt es nicht") }
        return l
    }

    static func cleanGHS(_ v: Any?) -> String {
        let list = (v as? [String]) ?? ((v as? String)?.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) } ?? [])
        return ghsCodes.filter { list.contains($0) }.joined(separator: ",")
    }

    /// Charge anlegen oder Stammdaten ändern (Menge ändert sich nur über Bewegungen)
    func saveLot(id: Int?, values a: [String: Any], author: String) throws -> [String: Any] {
        let name = ((a["name"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { throw StoreError.invalid("Bezeichnung fehlt") }
        let unit = ((a["unit"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        guard !unit.isEmpty, unit.count <= 12 else { throw StoreError.invalid("Einheit fehlt") }
        let entity = a["entity"] as? Int
        if let e = entity, try queryRows("SELECT 1 FROM entity WHERE id = ?", [e]).isEmpty { throw StoreError.invalid("Registry-Objekt gibt es nicht") }
        let loc = a["location"] as? Int
        if let l = loc, try queryRows("SELECT 1 FROM location WHERE id = ?", [l]).isEmpty { throw StoreError.invalid("Standort gibt es nicht") }
        let pos = try checkPosition(location: loc, position: a["position"] as? String)
        if let p = pos, let l = loc, let other = try queryRows("SELECT id, name FROM lot WHERE location_id = ? AND position = ? AND status = 'active' AND id != ?", [l, p, id ?? -1]).first {
            throw StoreError.invalid("Position \(p) ist schon belegt (\(other["name"]!))")
        }
        let expiry = ((a["expiry"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        if !expiry.isEmpty, expiry.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) == nil { throw StoreError.invalid("Ablaufdatum als JJJJ-MM-TT") }
        let minAmt = Store.number(a["min"])
        if let m = minAmt, m < 0 { throw StoreError.invalid("Mindestbestand darf nicht negativ sein") }
        let sds = ((a["sds"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        if !sds.isEmpty, !(sds.hasPrefix("https://") || sds.hasPrefix("http://")) { throw StoreError.invalid("Sicherheitsdatenblatt: Link mit https://") }
        let fields: [Any?] = [entity, name, (a["lot_no"] as? String) ?? "", unit, minAmt, expiry.isEmpty ? nil : expiry, loc, pos,
                              Store.cleanGHS(a["ghs"]), sds, (a["supplier"] as? String) ?? "", (a["catalog"] as? String) ?? "", (a["note"] as? String) ?? ""]
        let now = Store.now()
        let lotId: Int = try transactionRun {
            if let id {
                _ = try lotRow(id)
                try queryRows("""
                UPDATE lot SET entity_id = ?, name = ?, lot_no = ?, unit = ?, min_amount = ?, expiry = ?, location_id = ?, position = ?,
                  ghs = ?, sds_url = ?, supplier = ?, catalog = ?, note = ?, updated = ? WHERE id = ?
                """, fields + [now, id])
                return id
            }
            guard let start = Store.number(a["amount"]), start >= 0 else { throw StoreError.invalid("Anfangsmenge fehlt") }
            try queryRows("""
            INSERT INTO lot(entity_id, name, lot_no, unit, min_amount, expiry, location_id, position, ghs, sds_url, supplier, catalog, note, amount, created, updated)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, fields + [start, now, now])
            let nid = lastID()
            try queryRows("INSERT INTO lot_move(lot_id, at, delta, amount_after, kind, author) VALUES(?, ?, ?, ?, 'anlegen', ?)", [nid, now, start, start, author])
            return nid
        }
        return try lot(id: lotId)
    }

    static func number(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        guard let s = (v as? String)?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        return Double(s.replacingOccurrences(of: ",", with: "."))
    }

    /// Menge ändern: Verbrauch (delta < 0), Korrektur, Entsorgen. Nie unter null; Verbrauch kann einem Eintrag zugeordnet sein.
    func moveLot(id: Int, delta: Double, kind: String, entry: Int?, note: String, author: String) throws -> [String: Any] {
        guard ["verbrauch", "korrektur", "storno", "entsorgen", "zugang"].contains(kind) else { throw StoreError.invalid("Unbekannte Buchung") }
        guard delta.isFinite, delta != 0 || kind == "entsorgen" else { throw StoreError.invalid("Menge fehlt") }
        if kind == "verbrauch" && delta >= 0 { throw StoreError.invalid("Verbrauch muss eine positive Menge sein") }
        if let e = entry, try queryRows("SELECT 1 FROM entry WHERE id = ?", [e]).isEmpty { throw StoreError.invalid("Eintrag gibt es nicht") }
        return try transactionRun {
            let l = try lotRow(id)
            guard l["status"] as? String != "disposed" else { throw StoreError.invalid("Die Charge ist entsorgt") }
            let before = l["amount"] as? Double ?? Double(l["amount"] as? Int ?? 0)
            let d = kind == "entsorgen" ? -before : delta
            let after = ((before + d) * 1e9).rounded() / 1e9  // Rundungsreste vermeiden
            guard after >= -1e-9 else { throw StoreError.invalid("Nicht genug vorhanden: \(Store.fmt(before)) \(l["unit"]!) übrig") }
            let status = kind == "entsorgen" ? "disposed" : after <= 1e-9 ? "empty" : "active"
            let now = Store.now()
            try queryRows("UPDATE lot SET amount = ?, status = ?, updated = ?, position = CASE WHEN ? = 'disposed' THEN NULL ELSE position END WHERE id = ?",
                          [max(0, after), status, now, status, id])
            try queryRows("INSERT INTO lot_move(lot_id, at, delta, amount_after, kind, entry_id, note, author) VALUES(?,?,?,?,?,?,?,?)",
                          [id, now, d, max(0, after), kind, entry, note, author])
            return ["move": lastID(), "amount": max(0, after), "status": status, "at": now, "unit": l["unit"]!, "code": Store.lotCode(id), "name": l["name"]!]
        }
    }

    static func fmt(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.4g", v).replacingOccurrences(of: ".", with: ",") }

    /// Warnstufe: expired, soon (≤ 30 Tage), low (≤ Mindestbestand), empty, ok
    static func warnings(_ l: [String: Any], today: String) -> [String] {
        var w: [String] = []
        let amount = (l["amount"] as? Double) ?? Double(l["amount"] as? Int ?? 0)
        if l["status"] as? String == "empty" { w.append("empty") }
        if let m = Store.number(l["min_amount"]), amount <= m, l["status"] as? String == "active" { w.append("low") }
        if let e = l["expiry"] as? String, l["status"] as? String == "active" {
            if e < today { w.append("expired") }
            else if let soon = Calendar.current.date(byAdding: .day, value: soonDays, to: Date()), e <= isoDay(soon) { w.append("soon") }
        }
        return w
    }

    static func isoDay(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; return f.string(from: d) }

    private func decorate(_ l: [String: Any]) throws -> [String: Any] {
        var l = l
        let id = l["id"] as! Int
        l["code"] = Store.lotCode(id)
        l["warnings"] = Store.warnings(l, today: Store.isoDay(Date()))
        l["location_path"] = try locationPath(l["location_id"] as? Int)
        if let e = l["entity_id"] as? Int, let ent = try queryRows("SELECT e.no, e.name, t.prefix FROM entity e JOIN rtype t ON t.id = e.type_id WHERE e.id = ?", [e]).first {
            l["entity_code"] = Store.code(prefix: ent["prefix"] as! String, no: ent["no"] as! Int)
            l["entity_name"] = ent["name"]
        }
        return l
    }

    /// Chargen; filter: all | warnings | entity:<id> | location:<id>; q: Textsuche
    func lots(filter: String = "all", q: String = "", includeGone: Bool = false) throws -> [[String: Any]] {
        var conds: [String] = includeGone ? [] : ["l.status != 'disposed'"], args: [Any?] = []
        if filter.hasPrefix("entity:"), let e = Int(filter.dropFirst(7)) { conds.append("l.entity_id = ?"); args.append(e) }
        if filter.hasPrefix("location:"), let e = Int(filter.dropFirst(9)) { conds.append("l.location_id = ?"); args.append(e) }
        let t = q.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty {
            conds.append("(l.name LIKE ? OR l.lot_no LIKE ? OR l.supplier LIKE ? OR l.catalog LIKE ? OR printf('BS-%05d', l.id) LIKE ?)")
            args += Array(repeating: "%\(t)%", count: 5)
        }
        let rows = try queryRows("SELECT * FROM lot l \(conds.isEmpty ? "" : "WHERE " + conds.joined(separator: " AND ")) ORDER BY l.name COLLATE NOCASE, l.id", args).map(decorate)
        return filter == "warnings" ? rows.filter { !($0["warnings"] as! [String]).isEmpty } : rows
    }

    func lot(id: Int) throws -> [String: Any] {
        var l = try decorate(try lotRow(id))
        l["moves"] = try queryRows("""
        SELECT m.id, m.at, m.delta, m.amount_after, m.kind, m.entry_id, m.note, m.author, e.title AS entry_title
        FROM lot_move m LEFT JOIN entry e ON e.id = m.entry_id WHERE m.lot_id = ? ORDER BY m.id DESC
        """, [id])
        return l
    }

    func warningCount() throws -> Int { try lots(filter: "warnings").count }
}
