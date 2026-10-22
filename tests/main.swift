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

// M1: Projekte, Art, alte Revisionen
let p1 = try s.createProject(name: "  Klonierung  ")
check((try s.projects()).first?["name"] as? String == "Klonierung", "Projekt angelegt, Name getrimmt")
check((try? s.createProject(name: "  ")) == nil, "Leerer Projektname wird abgelehnt")
let e2 = try s.create(title: "Gel", project: p1, kind: "protocol")
check((try s.list(project: p1)).map { $0["id"] as! Int } == [e2], "Liste nach Projekt gefiltert")
check((try s.list(project: 0)).map { $0["id"] as! Int } == [id], "Liste „ohne Projekt“")
check((try? s.create(title: "x", project: 999)) == nil, "Unbekanntes Projekt wird abgelehnt")
check((try? s.create(title: "x", kind: "rezept")) == nil, "Unbekannte Art wird abgelehnt")
try s.setMeta(id: e2, project: 0, kind: "note")
let l2 = try s.load(id: e2)
check(l2["project_id"] is NSNull && l2["kind"] as? String == "note", "Projekt entfernt und Art geändert")
try s.updateProject(id: p1, name: "Klonierung alt", archived: true)
check((try s.projects()).first?["archived"] as? Int == 1, "Projekt archiviert")
check((try s.revision(id: id, no: 2))["title"] as? String == "PCR Test 2", "Alte Revision lesbar")

// M2: Tags, Verweise, Dateien je Eintrag
check(try s.setTags(id: id, names: ["#PCR", " Klonierung ", "pcr", "", "a,b"]) == ["Klonierung", "PCR"], "Tags bereinigt, doppelt/leer/mit Komma verworfen")
check((try s.tags()).count == 2, "Tag-Liste")
check((try s.search("klonier")).contains { $0["id"] as? Int == id }, "Suche findet Eintrag über Tag")
let tagId = (try s.tags()).first { $0["name"] as? String == "PCR" }!["id"] as! Int
check((try s.list(tag: tagId)).map { $0["id"] as! Int } == [id], "Liste nach Tag gefiltert")
check((try s.list(tag: tagId)).first?["tags"] as? String == "Klonierung, PCR", "Liste zeigt Tags")
_ = try s.setTags(id: id, names: ["Klonierung"])
check((try s.tags()).count == 1, "Ungenutzter Tag wird gelöscht")
check((try? s.setTags(id: 999, names: ["x"])) == nil, "Tags für unbekannten Eintrag abgelehnt")
_ = try s.saveDraft(id: e2, title: "Gel", json: "{}", text: "siehe PCR", links: [id, id, e2, 999], files: [sha, String(repeating: "a", count: 64)])
let bl = try s.backlinks(id: id)
check(bl.count == 1 && bl[0]["id"] as? Int == e2, "Rückverweis; doppelte, eigene und unbekannte Verweise ignoriert")
check(try s.backlinks(id: e2).isEmpty, "Kein Verweis auf sich selbst")
_ = try s.saveDraft(id: e2, title: "Gel", json: "{}", text: "ohne Verweis")
check(try s.backlinks(id: id).isEmpty, "Verweis entfernt, wenn er aus dem Text verschwindet")
check((try s.titles()).count >= 2, "Titelliste für Verweise")

// M3: Vorlagen mit Versionen, Läufe
let proto = try s.create(title: "PCR-Protokoll", kind: "protocol")
_ = try s.saveDraft(id: proto, title: "PCR-Protokoll", json: #"{"v":1}"#, text: "Schritt 1")
let t1 = try s.saveTemplate(name: " PCR Q5 ", fromEntry: proto)
check(t1["version"] as? Int == 1 && t1["unchanged"] as? Bool == false, "Vorlage Version 1 angelegt")
check((try s.saveTemplate(name: "pcr q5", fromEntry: proto))["unchanged"] as? Bool == true, "Gleicher Inhalt: keine neue Version (Name ohne Groß/Klein)")
_ = try s.saveDraft(id: proto, title: "PCR-Protokoll", json: #"{"v":2}"#, text: "Schritt 1 und 2")
check((try s.saveTemplate(name: "PCR Q5", fromEntry: proto))["version"] as? Int == 2, "Geänderter Inhalt: Version 2")
let tid = t1["id"] as! Int
check((try s.templates()).first?["version"] as? Int == 2, "Vorlagenliste zeigt neueste Version")
check((try s.templateVersions(id: tid)).count == 2, "Beide Versionen erhalten")
let fromT = try s.createFromTemplate(id: tid, version: 1, project: nil)
let ft = try s.load(id: fromT)
check(ft["draft_json"] as? String == #"{"v":1}"# && ft["template_version"] as? Int == 1 && ft["kind"] as? String == "protocol", "Eintrag aus Version 1 mit Vermerk")
check((try s.load(id: try s.createFromTemplate(id: tid, version: nil, project: nil)))["draft_json"] as? String == #"{"v":2}"#, "Ohne Version: neueste")
var tdb: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &tdb)
check(sqlite3_exec(tdb, "UPDATE template_version SET content_json = 'x'", nil, nil, nil) != SQLITE_OK, "Vorlagenversionen sind unveränderlich")
sqlite3_close(tdb)
check((try? s.saveTemplate(name: "", fromEntry: proto)) == nil, "Vorlage ohne Namen abgelehnt")

let run = try s.startRun(entry: fromT, steps: ["Mastermix ansetzen", "5 min inkubieren", "Gel laden"])
check(try s.startRun(entry: fromT, steps: ["x"]) == run, "Laufender Lauf wird wiederverwendet")
let st1 = try s.completeStep(run: run, step: 2, note: "37 °C")
check(st1["note"] as? String == "37 °C", "Schritt erledigt mit Notiz")
_ = try s.completeStep(run: run, step: 2, note: "später")
let doneSteps = (try s.activeRun(entry: fromT))?["done"] as? [[String: Any]] ?? []
check(doneSteps.count == 1 && doneSteps[0]["note"] as? String == "37 °C", "Erster Zeitstempel zählt")
check((try? s.completeStep(run: run, step: 9, note: "")) == nil, "Unbekannter Schritt abgelehnt")
let fin = try s.finishRun(run: run, aborted: false)
check(fin["status"] as? String == "done" && fin["finished"] is String, "Lauf beendet")
check(try s.activeRun(entry: fromT) == nil, "Kein laufender Lauf mehr")
check((try? s.completeStep(run: run, step: 1, note: "")) == nil, "Beendeter Lauf nimmt keine Schritte mehr an")
check((try? s.startRun(entry: fromT, steps: [])) == nil, "Lauf ohne Schritte abgelehnt")

// Migration: ein Buch im Format von M0 (user_version 0, ohne Projekte) wird aktualisiert und vorher gesichert
let old = FileManager.default.temporaryDirectory.appendingPathComponent("lb-m0-\(UUID().uuidString).laborbuch")
defer { try? FileManager.default.removeItem(at: old) }
try FileManager.default.createDirectory(at: old, withIntermediateDirectories: true)
var odb: OpaquePointer?
sqlite3_open(old.appendingPathComponent("db.sqlite").path, &odb)
sqlite3_exec(odb, """
CREATE TABLE entry(id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL,
  draft_json TEXT NOT NULL DEFAULT '', draft_text TEXT NOT NULL DEFAULT '');
INSERT INTO entry(title, created, updated, draft_json) VALUES('Alter Eintrag', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '{"type":"doc"}');
""", nil, nil, nil)
sqlite3_close(odb)
let migrated = try Store(root: old)
let ol = try migrated.list()
check(ol.count == 1 && ol[0]["kind"] as? String == "experiment" && ol[0]["project_id"] is NSNull, "M0-Buch migriert, Eintrag erhalten")
let backups = (try? FileManager.default.contentsOfDirectory(atPath: old.appendingPathComponent("backups").path)) ?? []
check(backups.count == 1 && backups[0].hasPrefix("db-v0-"), "Sicherung vor der Migration angelegt")
_ = try Store(root: old)
check(((try? FileManager.default.contentsOfDirectory(atPath: old.appendingPathComponent("backups").path)) ?? []).count == 1, "Keine zweite Sicherung ohne Migration")

// Ein Buch aus einer neueren App-Version wird nicht angefasst
sqlite3_open(old.appendingPathComponent("db.sqlite").path, &odb)
sqlite3_exec(odb, "PRAGMA user_version = 99", nil, nil, nil)
sqlite3_close(odb)
check((try? Store(root: old)) == nil, "Neueres Buchformat wird abgelehnt")

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
