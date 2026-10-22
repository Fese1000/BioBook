// Tests für Store.swift (ohne Xcode): swiftc app/Store.swift tests/main.swift -o /tmp/lb-tests && /tmp/lb-tests
import Foundation
import SQLite3

var failures = 0
func check(_ ok: Bool, _ what: String) { print(ok ? "ok   \(what)" : "FAIL \(what)"); if !ok { failures += 1 } }

let dir = FileManager.default.temporaryDirectory.appendingPathComponent("lb-test-\(UUID().uuidString).laborbuch")
defer { try? FileManager.default.removeItem(at: dir) }
let s = try Store(root: dir)

let id = try s.create(title: "PCR Test")
check(try s.list().count == 1, "Eintrag angelegt")
_ = try s.saveDraft(id: id, title: "PCR Test", json: #"{"type":"doc","content":[]}"#, text: "Taq Polymerase Mastermix")
check((try s.load(id: id))["draft_json"] as? String == #"{"type":"doc","content":[]}"#, "Arbeitsstand gespeichert")
check((try s.search("polym")).count == 1, "Volltextsuche mit Präfix")
check((try s.search("Mastermix \"")).count == 1, "Suche mit Anführungszeichen bricht nicht")
check((try s.search("Zentrifuge")).isEmpty, "Suche ohne Treffer")

let r1 = try s.snapshot(id: id)
check(r1?["no"] as? Int == 1, "Revision 1 angelegt")
check(try s.snapshot(id: id) == nil, "Keine Revision ohne Änderung")
_ = try s.saveDraft(id: id, title: "PCR Test 2", json: #"{"type":"doc","content":[{"type":"paragraph"}]}"#, text: "x")
check((try s.snapshot(id: id))?["no"] as? Int == 2, "Revision 2 nach Änderung")
check((try s.verify(id: id))["ok"] as? Bool == true, "Hash-Kette intakt")

// Manipulation: Trigger umgehen ist nur mit direktem SQL möglich – genau das muss die Prüfung erkennen
var db: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &db)
let blocked = sqlite3_exec(db, "UPDATE revision SET title = 'gefälscht' WHERE no = 1", nil, nil, nil) != SQLITE_OK
check(blocked, "UPDATE auf Revision wird von der Datenbank abgelehnt")
sqlite3_exec(db, "DROP TRIGGER revision_readonly_u; UPDATE revision SET content_json = '{}' WHERE no = 1", nil, nil, nil)
sqlite3_close(db)
let v = try s.verify(id: id)
check(v["ok"] as? Bool == false && v["broken"] as? Int == 1, "Manipulierte Revision 1 wird erkannt")

let png = Data([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
let sha = try s.putFile(name: "a.png", mime: "image/png", data: png)
check(try Data(contentsOf: s.fileURL(sha)) == png && s.mime(sha) == "image/png", "Anhang nach SHA-256 gespeichert")
check(try s.putFile(name: "b.png", mime: "image/png", data: png) == sha, "Gleicher Anhang wird nicht doppelt gespeichert")

// Leistung: 10.000 Einträge, Suche
let words = ["Puffer", "Probe", "Zentrifuge", "Pellet", "Plasmid", "Primer", "Gel", "Bande", "Ausbeute", "Kontrolle"]
var t = Date()
for i in 0..<10_000 {
    let e = try s.create(title: "Experiment \(i)")
    _ = try s.saveDraft(id: e, title: "Experiment \(i)", json: "{}", text: (0..<200).map { words[($0 * 7 + i) % words.count] }.joined(separator: " ") + " Nr\(i)")
}
print(String(format: "info 10.000 Einträge anlegen: %.1f s", Date().timeIntervalSince(t)))
t = Date()
let hits = try s.search("Nr4242")
let ms = Date().timeIntervalSince(t) * 1000
check(hits.count == 1, "Suche findet genau einen Eintrag unter 10.000")
check(ms < 100, String(format: "Suche unter 100 ms (%.1f ms)", ms))
t = Date(); _ = try s.search("zentri"); print(String(format: "info Präfixsuche mit vielen Treffern: %.1f ms", Date().timeIntervalSince(t) * 1000))
t = Date(); _ = try s.list(); print(String(format: "info Liste von 10.000 Einträgen: %.1f ms", Date().timeIntervalSince(t) * 1000))

print(failures == 0 ? "\nAlle Tests bestanden" : "\n\(failures) Test(s) fehlgeschlagen")
exit(failures == 0 ? 0 : 1)
