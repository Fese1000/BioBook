// Bestellungen: Vorschläge aus knappen oder leeren Chargen, Bestellliste mit Status (offen → bestellt → geliefert, oder storniert),
// unveränderlicher Statusverlauf. Der Wareneingang legt eine neue Charge an und übernimmt die Stammdaten der alten.
import Foundation

extension Store {
    static let purchaseStatus = ["offen", "bestellt", "geliefert", "storniert"]

    private func purchaseRow(_ id: Int) throws -> [String: Any] {
        guard let p = try queryRows("SELECT * FROM purchase WHERE id = ?", [id]).first else { throw StoreError.invalid("Bestellung gibt es nicht") }
        return p
    }

    private func logPurchase(_ id: Int, _ status: String, note: String, author: String) throws {
        try queryRows("INSERT INTO purchase_log(purchase_id, at, status, note, author) VALUES(?,?,?,?,?)", [id, Store.now(), status, note, author])
    }

    /// Offene Bestellung (offen oder bestellt) für dieselbe Art Ware: gleiches Objekt, sonst gleicher Name
    private func openPurchase(entity: Int?, name: String) throws -> Int? {
        try queryRows("""
        SELECT id FROM purchase WHERE status IN ('offen', 'bestellt')
          AND (CASE WHEN ?1 IS NULL THEN entity_id IS NULL AND lower(name) = lower(?2) ELSE entity_id = ?1 END) LIMIT 1
        """, [entity, name]).first?["id"] as? Int
    }

    /// Vorschläge: knappe oder leere Chargen (Summe gleichartiger Chargen ≤ Mindestbestand), für die nichts bestellt ist; je Art nur einmal
    func purchaseSuggestions() throws -> [[String: Any]] {
        var seen = Set<String>(), out: [[String: Any]] = []
        let cand = try queryRows("SELECT * FROM lot WHERE min_amount IS NOT NULL AND status IN ('active', 'empty') ORDER BY name COLLATE NOCASE, id DESC")
        for l in cand {
            let key = "\(l["entity_id"] as? Int ?? -1)|\((l["name"] as! String).lowercased())|\(l["unit"]!)"
            guard !seen.contains(key), let m = Store.number(l["min_amount"]) else { continue }
            seen.insert(key)
            let total = try stockTotal(l)
            guard total <= m, try openPurchase(entity: l["entity_id"] as? Int, name: l["name"] as! String) == nil else { continue }
            out.append(["lot_id": l["id"]!, "code": Store.lotCode(l["id"] as! Int), "name": l["name"]!, "unit": l["unit"]!, "total": total, "min": m,
                        "supplier": l["supplier"]!, "catalog": l["catalog"]!, "entity_id": l["entity_id"] ?? NSNull()])
        }
        return out
    }

    /// Bestellung anlegen; mit lot werden Name, Objekt, Einheit, Lieferant und Katalognummer aus der Charge übernommen
    func createPurchase(values a: [String: Any], author: String) throws -> [String: Any] {
        var v = a
        if let lotId = a["lot"] as? Int {
            guard let l = try queryRows("SELECT * FROM lot WHERE id = ?", [lotId]).first else { throw StoreError.invalid("Charge gibt es nicht") }
            for (k, src) in [("name", "name"), ("unit", "unit"), ("supplier", "supplier"), ("catalog", "catalog")] where ((v[k] as? String) ?? "").isEmpty { v[k] = l[src] }
            if v["entity"] == nil, let e = l["entity_id"] as? Int { v["entity"] = e }
        }
        let name = ((v["name"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { throw StoreError.invalid("Was soll bestellt werden?") }
        let entity = v["entity"] as? Int
        if let e = entity, try queryRows("SELECT 1 FROM entity WHERE id = ?", [e]).isEmpty { throw StoreError.invalid("Registry-Objekt gibt es nicht") }
        let amount = Store.number(v["amount"])
        if let x = amount, !(x > 0) { throw StoreError.invalid("Menge muss größer als 0 sein") }
        let qty = Store.number(v["qty"]).map { Int($0) } ?? 1
        guard qty >= 1, qty <= 1000 else { throw StoreError.invalid("Anzahl: 1–1000") }
        if a["force"] as? Bool != true, let other = try openPurchase(entity: entity, name: name) {
            throw StoreError.invalid("„\(name)“ steht schon auf der Bestellliste (Nr. \(other))")
        }
        let txt = { (k: String) in ((v[k] as? String) ?? "").trimmingCharacters(in: .whitespaces) }
        let now = Store.now()
        let id: Int = try transactionRun {
            try queryRows("""
            INSERT INTO purchase(lot_id, entity_id, name, amount, unit, qty, supplier, catalog, price, note, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """, [a["lot"] as? Int, entity, name, amount, txt("unit"), qty, txt("supplier"), txt("catalog"), txt("price"), txt("note"), now, now])
            let nid = lastID()
            try logPurchase(nid, "offen", note: "", author: author)
            return nid
        }
        return try purchase(id: id)
    }

    func purchase(id: Int) throws -> [String: Any] {
        var p = try purchaseRow(id)
        p["log"] = try queryRows("SELECT at, status, note, author FROM purchase_log WHERE purchase_id = ? ORDER BY id", [id])
        if let n = p["new_lot"] as? Int { p["new_lot_code"] = Store.lotCode(n) }
        if let l = p["lot_id"] as? Int { p["lot_code"] = Store.lotCode(l) }
        return p
    }

    /// Bestellliste; filter: open (offen und bestellt) | all
    func purchases(filter: String = "open") throws -> [[String: Any]] {
        try queryRows("""
        SELECT p.*, (SELECT at FROM purchase_log g WHERE g.purchase_id = p.id AND g.status = p.status ORDER BY g.id DESC LIMIT 1) AS status_at,
          CASE WHEN p.new_lot IS NULL THEN NULL ELSE printf('BS-%05d', p.new_lot) END AS new_lot_code
        FROM purchase p \(filter == "all" ? "" : "WHERE p.status IN ('offen', 'bestellt')")
        ORDER BY CASE p.status WHEN 'offen' THEN 0 WHEN 'bestellt' THEN 1 WHEN 'geliefert' THEN 2 ELSE 3 END, p.updated DESC
        """)
    }

    /// Status setzen: offen → bestellt; offen/bestellt → storniert; zurück auf offen nur aus bestellt. Geliefert nur über den Wareneingang.
    func setPurchaseStatus(id: Int, status: String, note: String, author: String) throws -> [String: Any] {
        let allowed: [String: Set<String>] = ["offen": ["bestellt", "storniert"], "bestellt": ["offen", "storniert"]]
        try transactionRun {
            let p = try purchaseRow(id), from = p["status"] as! String
            guard allowed[from]?.contains(status) == true else { throw StoreError.invalid("Von „\(from)“ geht es nicht nach „\(status)“") }
            try queryRows("UPDATE purchase SET status = ?, updated = ? WHERE id = ?", [status, Store.now(), id])
            try logPurchase(id, status, note: note.trimmingCharacters(in: .whitespaces), author: author)
        }
        return try purchase(id: id)
    }

    /// Wareneingang: neue Charge anlegen (Stammdaten aus der alten Charge, Menge/Chargennr./Ablauf/Standort aus values), Bestellung „geliefert“
    func receivePurchase(id: Int, values a: [String: Any], author: String) throws -> [String: Any] {
        try transactionRun {
            let p = try purchaseRow(id)
            guard ["offen", "bestellt"].contains(p["status"] as! String) else { throw StoreError.invalid("Die Bestellung ist schon \(p["status"]!)") }
            var lv: [String: Any] = ["name": p["name"]!, "unit": p["unit"] as? String ?? "", "supplier": p["supplier"]!, "catalog": p["catalog"]!]
            if let old = (p["lot_id"] as? Int).flatMap({ try? queryRows("SELECT * FROM lot WHERE id = ?", [$0]).first }) {
                lv["ghs"] = old["ghs"]; lv["sds"] = old["sds_url"]
                if let m = old["min_amount"] { lv["min"] = m }
            }
            if let e = p["entity_id"] as? Int { lv["entity"] = e }
            for k in ["amount", "unit", "lot_no", "expiry", "location", "position", "note"] { if let v = a[k], !(v is NSNull), !"\(v)".isEmpty { lv[k] = v } }
            if lv["amount"] == nil, let amt = Store.number(p["amount"]) { lv["amount"] = amt * Double(p["qty"] as? Int ?? 1) }
            guard Store.number(lv["amount"]) != nil else { throw StoreError.invalid("Gelieferte Menge fehlt") }
            let lot = try saveLot(id: nil, values: lv, author: author)
            let newId = lot["id"] as! Int
            try queryRows("UPDATE purchase SET status = 'geliefert', new_lot = ?, updated = ? WHERE id = ?", [newId, Store.now(), id])
            try logPurchase(id, "geliefert", note: "Neue Charge \(Store.lotCode(newId))", author: author)
            return ["purchase": try purchase(id: id), "lot": lot]
        }
    }

    /// Für die Seitenleiste: Vorschläge (knapp, nicht bestellt) und offene Bestellungen
    func purchaseCounts() throws -> [String: Int] {
        ["suggestions": try purchaseSuggestions().count,
         "open": (try queryRows("SELECT COUNT(*) AS n FROM purchase WHERE status IN ('offen', 'bestellt')").first?["n"] as? Int) ?? 0]
    }
}
