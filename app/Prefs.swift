// Oberflächen-Einstellungen, die zum Buch gehören: Farbschema, „Neuer Tab beim Öffnen“, ausgeblendete Reiter der Seitenleiste.
// Bewusst im Buch statt in den App-Einstellungen: Tests fassen so nie die echten Einstellungen an.
import Foundation

extension Store {
    static let prefKeys: Set<String> = ["theme", "newtab", "hiddenTabs"]

    func prefs() throws -> [String: String] {
        var out: [String: String] = [:]
        for r in try queryRows("SELECT key, value FROM pref") { out[r["key"] as! String] = r["value"] as? String ?? "" }
        return out
    }

    func setPref(key: String, value: String) throws {
        guard Store.prefKeys.contains(key) else { throw StoreError.invalid("Unbekannte Einstellung: \(key)") }
        guard value.count <= 4000 else { throw StoreError.invalid("Wert zu lang") }
        try queryRows("INSERT INTO pref(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])
    }
}
