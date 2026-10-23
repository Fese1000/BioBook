// Sequenzen am Registry-Objekt: die Basen stehen im Sequenzfeld, Ring/linear und Features (aus GenBank oder ORF-Suche) hier daneben.
// Ändert sich die Sequenz später, gelten die Features als veraltet (stale) und werden nicht mehr angezeigt, bis sie neu gesetzt sind.
import Foundation

extension Store {
    static let maxFeatures = 2000

    private func sequenceValue(entity: Int, field: String) throws -> String {
        guard let e = try queryRows("SELECT e.fields_json, t.fields_json AS tf FROM entity e JOIN rtype t ON t.id = e.type_id WHERE e.id = ?", [entity]).first else {
            throw StoreError.invalid("Objekt gibt es nicht")
        }
        let tf = (try JSONSerialization.jsonObject(with: Data((e["tf"] as! String).utf8)) as? [[String: Any]]) ?? []
        guard tf.contains(where: { $0["key"] as? String == field && $0["type"] as? String == "sequence" }) else { throw StoreError.invalid("\(field) ist kein Sequenzfeld") }
        let vals = (try JSONSerialization.jsonObject(with: Data((e["fields_json"] as! String).utf8)) as? [String: Any]) ?? [:]
        return (vals[field] as? String) ?? ""
    }

    /// Anmerkung lesen; ohne Eintrag: linear, keine Features
    func seqAnnotation(entity: Int, field: String) throws -> [String: Any] {
        let seq = try sequenceValue(entity: entity, field: field)
        guard let a = try queryRows("SELECT * FROM seq_annot WHERE entity_id = ? AND field = ?", [entity, field]).first else {
            return ["circular": false, "features": [Any](), "stale": false, "length": seq.count]
        }
        let stale = a["seq_sha"] as? String != Store.sha256(Data(seq.utf8))
        let feats = (try? JSONSerialization.jsonObject(with: Data((a["features_json"] as! String).utf8))) ?? []
        return ["circular": (a["circular"] as? Int) == 1, "features": stale ? [Any]() : feats, "stale": stale && !((feats as? [Any])?.isEmpty ?? true),
                "source": a["source"] ?? "", "length": seq.count]
    }

    /// Ring/linear und Features setzen (gilt für die aktuelle Sequenz); Features werden geprüft und auf die Länge begrenzt
    func setSeqAnnotation(entity: Int, field: String, circular: Bool, features raw: [[String: Any]], source: String) throws -> [String: Any] {
        let seq = try sequenceValue(entity: entity, field: field), n = seq.count
        guard raw.count <= Store.maxFeatures else { throw StoreError.invalid("Höchstens \(Store.maxFeatures) Features") }
        let feats: [[String: Any]] = try raw.map { f in
            guard let a = f["start"] as? Int, let b = f["end"] as? Int, (1...max(n, 1)).contains(a), (1...max(n, 1)).contains(b) else {
                throw StoreError.invalid("Feature außerhalb der Sequenz (1–\(n))")
            }
            if a > b && !circular { throw StoreError.invalid("Feature über den Ursprung geht nur bei ringförmigen Sequenzen") }
            var out: [String: Any] = ["start": a, "end": b, "strand": (f["strand"] as? Int) == -1 ? -1 : 1,
                                      "type": String(((f["type"] as? String) ?? "misc_feature").prefix(30)), "label": String(((f["label"] as? String) ?? "").prefix(60))]
            if let parts = f["parts"] as? [[Int]], parts.count > 1, parts.allSatisfy({ $0.count == 2 && (1...n).contains($0[0]) && (1...n).contains($0[1]) }) { out["parts"] = parts }
            if let c = f["color"] as? String, c.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil { out["color"] = c }
            return out
        }
        let json = String(data: try JSONSerialization.data(withJSONObject: feats), encoding: .utf8)!
        try queryRows("""
        INSERT INTO seq_annot(entity_id, field, circular, features_json, source, seq_sha, updated) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(entity_id, field) DO UPDATE SET circular = excluded.circular, features_json = excluded.features_json, source = excluded.source,
          seq_sha = excluded.seq_sha, updated = excluded.updated
        """, [entity, field, circular ? 1 : 0, json, String(source.prefix(200)), Store.sha256(Data(seq.utf8)), Store.now()])
        return try seqAnnotation(entity: entity, field: field)
    }

    /// Alle Objekte mit Sequenz (für die Auswahl im Sequenz-Block)
    func sequenceObjects() throws -> [[String: Any]] {
        var out: [[String: Any]] = []
        for t in try types() {
            let tf = (try JSONSerialization.jsonObject(with: Data((t["fields_json"] as! String).utf8)) as? [[String: Any]]) ?? []
            let keys = tf.filter { $0["type"] as? String == "sequence" }.compactMap { $0["key"] as? String }
            if keys.isEmpty { continue }
            for e in try queryRows("SELECT id, no, name, fields_json FROM entity WHERE type_id = ? AND archived = 0 ORDER BY no", [t["id"]]) {
                let vals = (try JSONSerialization.jsonObject(with: Data((e["fields_json"] as! String).utf8)) as? [String: Any]) ?? [:]
                for k in keys {
                    guard let s = vals[k] as? String, !s.isEmpty else { continue }
                    let label = tf.first { $0["key"] as? String == k }?["label"] as? String ?? k
                    out.append(["entity": e["id"]!, "field": k, "field_label": label, "code": Store.code(prefix: t["prefix"] as! String, no: e["no"] as! Int),
                                "name": e["name"]!, "length": s.count, "icon": t["icon"] ?? ""])
                }
            }
        }
        return out
    }
}
