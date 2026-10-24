// Tests für Store.swift (ohne Xcode): swiftc app/Store.swift app/Registry.swift app/Stock.swift app/Results.swift app/Culture.swift app/Orders.swift app/Sequences.swift app/References.swift app/Agenda.swift app/AutomationStore.swift app/EntryExtras.swift app/EntryManage.swift app/Account.swift app/Planner.swift app/Prefs.swift tests/main.swift -o /tmp/lb-tests && /tmp/lb-tests
import Foundation
import CryptoKit
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

// M4: Signieren, Abschluss, Zeugen

let key = Curve25519.Signing.PrivateKey(), otherKey = Curve25519.Signing.PrivateKey()
let se = try s.create(title: "Western Blot")
check((try? s.signEntry(id: se, key: key, name: "Felix")) == nil, "Leerer Eintrag lässt sich nicht signieren")
_ = try s.saveDraft(id: se, title: "Western Blot", json: #"{"blot":1}"#, text: "Bande bei 55 kDa")
check((try? s.signEntry(id: se, key: key, name: " ")) == nil, "Signatur ohne Namen abgelehnt")
let sg = try s.signEntry(id: se, key: key, name: "Felix Cuntz")
check(sg["no"] as? Int == 1 && (sg["fingerprint"] as? String)?.count == 19, "Signiert: Revision 1, Fingerabdruck")
let vs = try s.verify(id: se)
check(vs["ok"] as? Bool == true && (vs["signatures"] as! [[String: Any]])[0]["valid"] as? Bool == true, "Signatur gültig")
check((try? s.saveDraft(id: se, title: "Western Blot", json: #"{"blot":2}"#, text: "x")) == nil, "Signierter Eintrag ist gesperrt")
check((try? s.signEntry(id: se, key: key, name: "Felix Cuntz")) == nil, "Kein zweites Signieren")
try s.setMeta(id: se, project: 0, kind: "note")
check(true, "Ordnung (Art/Projekt) bleibt änderbar")
check((try s.signedRevision(id: se))["hash"] as? String == sg["hash"] as? String, "Signierte Revision abrufbar")

// Zeugen-PDF als Anhang
let pdfSha = try s.putFile(name: "zeuge.pdf", mime: "application/pdf", data: Data("%PDF-1.4 \(sg["hash"]!)".utf8))
let w = try s.addWitness(id: se, name: "Dr. Zeuge", file: pdfSha, hashFound: true)
check(w["hash_found"] as? Bool == true, "Zeuge vermerkt")
check((try? s.addWitness(id: se, name: "X", file: String(repeating: "b", count: 64), hashFound: false)) == nil, "Zeuge ohne gespeichertes PDF abgelehnt")
check((try? s.addWitness(id: e2, name: "X", file: pdfSha, hashFound: false)) == nil, "Zeuge nur bei signierten Einträgen")
check(((try s.verify(id: se))["signatures"] as! [[String: Any]]).count == 2, "Verlauf zeigt Autor und Zeuge")

// Fälschungen: Signatur mit fremdem Schlüssel, geänderter Name, geänderter Inhalt
var sdb: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &sdb)
check(sqlite3_exec(sdb, "UPDATE signature SET name = 'Jemand' WHERE entry_id = \(se)", nil, nil, nil) != SQLITE_OK, "Signaturen sind unveränderlich")
sqlite3_exec(sdb, "DROP TRIGGER signature_ro_u; UPDATE signature SET name = 'Jemand anderes' WHERE entry_id = \(se) AND kind = 'author'", nil, nil, nil)
sqlite3_close(sdb)
let vf = try s.verify(id: se)
check(vf["ok"] as? Bool == false && vf["chain_ok"] as? Bool == true, "Geänderter Name macht Signatur ungültig")
let se2 = try s.create(title: "Gel")
_ = try s.saveDraft(id: se2, title: "Gel", json: #"{"g":1}"#, text: "")
_ = try s.signEntry(id: se2, key: otherKey, name: "Felix")
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &sdb)
sqlite3_exec(sdb, "DROP TRIGGER IF EXISTS revision_readonly_u; UPDATE revision SET content_json = '{\"g\":2}' WHERE entry_id = \(se2)", nil, nil, nil)
sqlite3_close(sdb)
let vc = try s.verify(id: se2)
check(vc["ok"] as? Bool == false && vc["chain_ok"] as? Bool == false && (vc["signatures"] as! [[String: Any]])[0]["valid"] as? Bool == false, "Geänderter Inhalt: Kette und Signatur ungültig")
let fake = Curve25519.Signing.PrivateKey()
let forged = try fake.signature(for: Store.signaturePayload(entry: se, no: 1, hash: sg["hash"] as! String, name: "Felix Cuntz", at: sg["signed_at"] as! String))
check(!key.publicKey.isValidSignature(forged, for: Store.signaturePayload(entry: se, no: 1, hash: sg["hash"] as! String, name: "Felix Cuntz", at: sg["signed_at"] as! String)), "Fremder Schlüssel erzeugt keine gültige Signatur")

// M5: Texterkennung durchsuchbar, verlinkte Rohdaten
let scan = try s.putFile(name: "protokoll-scan.png", mime: "image/png", data: Data([1, 2, 3, 4]))
check((try s.pendingOCR()).contains { $0["sha256"] as? String == scan }, "Neues Bild wartet auf Texterkennung")
let oe = try s.create(title: "Gescanntes Protokoll")
_ = try s.saveDraft(id: oe, title: "Gescanntes Protokoll", json: "{}", text: "", files: [scan])
check((try s.search("protokoll-scan")).contains { $0["id"] as? Int == oe }, "Suche findet Dateinamen")
try s.setOCR(sha: scan, text: "Lysepuffer RIPA 4 Grad Zentrifuge 13000 rpm")
check((try s.search("lysepuff")).contains { $0["id"] as? Int == oe }, "Suche findet erkannten Text im Bild")
check(!(try s.pendingOCR()).contains { $0["sha256"] as? String == scan }, "Erkanntes Bild wartet nicht mehr")
_ = try s.saveDraft(id: oe, title: "Gescanntes Protokoll", json: "{}", text: "", files: [])
check(!(try s.search("lysepuff")).contains { $0["id"] as? Int == oe }, "Datei entfernt: Text nicht mehr gefunden")

let raw = FileManager.default.temporaryDirectory.appendingPathComponent("lb-raw-\(UUID().uuidString).fcs")
defer { try? FileManager.default.removeItem(at: raw) }
try Data(repeating: 7, count: 3_000_000).write(to: raw)
let rawSha = try Store.sha256(fileAt: raw)
check(rawSha == Store.sha256(try Data(contentsOf: raw)), "Prüfsumme in Blöcken = Prüfsumme am Stück")
let ln = try s.linkFile(url: raw, sha: rawSha, mime: "application/octet-stream")
check(ln["stored"] as? String == "link" && ln["path"] as? String == raw.path, "Rohdatei verlinkt, nicht kopiert")
check(!FileManager.default.fileExists(atPath: s.fileURL(rawSha).path) && s.localURL(rawSha) == raw, "Keine Kopie im Buch, Ort ist der Originalpfad")
check((try s.checkLink(sha: rawSha))["status"] as? String == "ok", "Unveränderte Rohdatei: ok")
try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(60)], ofItemAtPath: raw.path)
check((try s.checkLink(sha: rawSha))["status"] as? String == "ok", "Nur berührt (Zeit geändert, Inhalt gleich): ok")
var bytes = try Data(contentsOf: raw); bytes[1000] = 9; try bytes.write(to: raw)
check((try s.checkLink(sha: rawSha))["status"] as? String == "changed", "Geänderte Rohdatei wird gemeldet")
try FileManager.default.removeItem(at: raw)
check((try s.checkLink(sha: rawSha))["status"] as? String == "missing", "Fehlende Rohdatei wird gemeldet")

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

// M8: Registry
let rtypes = try s.types()
check(rtypes.count == 6 && rtypes.contains { $0["prefix"] as? String == "PL" }, "Sechs Standardtypen angelegt")
let plType = rtypes.first { $0["prefix"] as? String == "PL" }!["id"] as! Int
let pl1 = try s.createEntity(typeId: plType, name: "pUC19", values: ["backbone": "pUC", "resistance": "Ampicillin", "size": "2686", "sequence": "acgt ACGT-tt", "unbekannt": "x"], author: "Felix")
check(pl1["code"] as? String == "PL-0001", "Erstes Plasmid bekommt PL-0001")
let pl1v = (try JSONSerialization.jsonObject(with: Data((pl1["fields_json"] as! String).utf8)) as! [String: String])
check(pl1v["sequence"] == "ACGTACGTTT" && pl1v["unbekannt"] == nil, "Sequenz bereinigt, unbekannte Felder verworfen")
check((try s.createEntity(typeId: plType, name: "pET28a", values: [:], author: "Felix"))["code"] as? String == "PL-0002", "Fortlaufende Nummer")
check((try? s.createEntity(typeId: plType, name: "x", values: ["resistance": "Penicillin"], author: "")) == nil, "Unerlaubte Auswahl abgelehnt")
check((try? s.createEntity(typeId: plType, name: "x", values: ["size": "groß"], author: "")) == nil, "Zahl wird geprüft")
check((try? s.createEntity(typeId: plType, name: "x", values: ["sequence": "ACGTXZ"], author: "")) == nil, "Sequenz wird geprüft")
check((try? s.createEntity(typeId: plType, name: " ", values: [:], author: "")) == nil, "Name ist Pflicht")
let pl1id = pl1["id"] as! Int
_ = try s.updateEntity(id: pl1id, name: "pUC19", values: ["backbone": "pUC", "resistance": "Ampicillin", "size": "2686", "sequence": "ACGTACGTTT", "source": "Addgene"], author: "Felix")
_ = try s.updateEntity(id: pl1id, name: "pUC19", values: ["backbone": "pUC", "resistance": "Ampicillin", "size": "2686", "sequence": "ACGTACGTTT", "source": "Addgene"], author: "Felix")
let pl1hist = (try s.entity(id: pl1id))["history"] as? [[String: Any]] ?? []
check(pl1hist.count == 2, "Änderung im Verlauf, unveränderter Stand nicht doppelt")
var rdb: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &rdb)
check(sqlite3_exec(rdb, "DELETE FROM entity_history", nil, nil, nil) != SQLITE_OK, "Verlauf lässt sich nicht löschen")
sqlite3_close(rdb)
check((try s.entities(typeId: plType, q: "addgene")).map { $0["code"] as! String } == ["PL-0001"], "Suche in Feldern")
check((try s.entities(typeId: nil, q: "PL0002")).first?["name"] as? String == "pET28a", "Suche über die ID (auch ohne Bindestrich)")
let usingEntry = try s.create(title: "Klonierung")
_ = try s.saveDraft(id: usingEntry, title: "Klonierung", json: "{}", text: "", entities: [pl1id, pl1id, 9999])
check(((try s.entity(id: pl1id))["used_in"] as! [[String: Any]]).map { $0["id"] as! Int } == [usingEntry], "Verwendet in: Eintrag, Doppelte und Unbekannte ignoriert")
let myType = try s.saveType(id: nil, name: "Gewebeprobe", prefix: "gp", icon: "🧊", fields: [["key": "organ", "label": "Organ", "type": "text"], ["key": "fixed", "label": "Fixiert", "type": "bool"]])
check((try s.createEntity(typeId: myType, name: "Leber Maus 3", values: ["organ": "Leber", "fixed": "true"], author: ""))["code"] as? String == "GP-0001", "Eigener Typ mit Kürzel in Großbuchstaben")
check((try? s.saveType(id: nil, name: "Doppelt", prefix: "PL", icon: "", fields: [])) == nil, "Kürzel muss eindeutig sein")
check((try? s.saveType(id: plType, name: "Plasmid", prefix: "PX", icon: "", fields: [])) == nil, "Kürzel nicht änderbar, wenn es Objekte gibt")
check((try? s.saveType(id: nil, name: "X", prefix: "XY", icon: "", fields: [["key": "a", "type": "select"]])) == nil, "Auswahlfeld ohne Optionen abgelehnt")
check((try? s.saveType(id: nil, name: "X", prefix: "XZ", icon: "", fields: [["key": "a"], ["key": "a"]])) == nil, "Doppelte Feldschlüssel abgelehnt")

// Papierkorb
let tr = try s.create(title: "Fehlversuch Zentrifuge")
_ = try s.saveDraft(id: tr, title: "Fehlversuch Zentrifuge", json: #"{"x":1}"#, text: "Rotor falsch gewählt", links: [usingEntry], entities: [pl1id])
_ = try s.setTags(id: tr, names: ["einmaltag"])
try s.snapshot(id: tr)
check((try? s.purgeEntry(id: tr)) == nil, "Endgültig löschen nur aus dem Papierkorb")
try s.trashEntry(id: tr)
check(!(try s.list()).contains { $0["id"] as? Int == tr }, "Gelöschter Eintrag fehlt in der Liste")
check(!(try s.search("rotor")).contains { $0["id"] as? Int == tr }, "… und in der Suche")
check(!(try s.backlinks(id: usingEntry)).contains { $0["id"] as? Int == tr }, "… und bei den Rückverweisen")
check(((try s.entity(id: pl1id))["used_in"] as! [[String: Any]]).allSatisfy { $0["id"] as? Int != tr }, "… und bei „Verwendet in“")
check((try s.trash()).map { $0["id"] as! Int } == [tr], "Steht im Papierkorb")
check((try? s.saveDraft(id: tr, title: "x", json: "{}", text: "")) == nil, "Im Papierkorb nicht bearbeitbar")
try s.restoreEntry(id: tr)
check((try s.search("rotor")).contains { $0["id"] as? Int == tr }, "Wiederhergestellt und wieder auffindbar")
check((try? s.trashEntry(id: se)) == nil, "Signierter Eintrag lässt sich nicht löschen")
try s.trashEntry(id: tr)
check(try s.emptyTrash() == 1, "Papierkorb geleert")
let trashLeft = try s.trash()
check((try? s.load(id: tr)) == nil && trashLeft.isEmpty, "Eintrag endgültig weg")
check(!(try s.tags()).contains { $0["name"] as? String == "einmaltag" }, "Ungenutzter Tag mit gelöscht")
var pdb: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &pdb)
var stmt: OpaquePointer?
sqlite3_prepare_v2(pdb, "SELECT COUNT(*) FROM revision WHERE entry_id = \(tr)", -1, &stmt, nil); sqlite3_step(stmt)
check(sqlite3_column_int(stmt, 0) == 0, "Revisionen des gelöschten Eintrags entfernt")
sqlite3_finalize(stmt)
check(sqlite3_exec(pdb, "DELETE FROM revision WHERE entry_id = \(id)", nil, nil, nil) != SQLITE_OK, "Revisionen nicht gelöschter Einträge bleiben geschützt")
sqlite3_close(pdb)
check(((try s.verify(id: id))["count"] as? Int ?? 0) > 0, "Andere Einträge behalten ihre Revisionen")

// M9: Bestand
let room = try s.saveLocation(id: nil, parent: nil, name: "Labor 2.14", kind: "raum", rows: nil, cols: nil, temp: "")
let freezer = try s.saveLocation(id: nil, parent: room, name: "Gefrierschrank −20", kind: "geraet", rows: nil, cols: nil, temp: "−20 °C")
let box = try s.saveLocation(id: nil, parent: freezer, name: "Box Enzyme", kind: "box", rows: 9, cols: 9, temp: "")
check(try s.locationPath(box) == "Labor 2.14 › Gefrierschrank −20 › Box Enzyme", "Standort-Pfad")
check((try? s.saveLocation(id: room, parent: box, name: "Labor", kind: "raum", rows: nil, cols: nil, temp: "")) == nil, "Keine Schleife im Standort-Baum")
check((try? s.saveLocation(id: nil, parent: nil, name: "Box", kind: "box", rows: 0, cols: 9, temp: "")) == nil, "Box braucht ein gültiges Raster")
let chType = (try s.types()).first { $0["prefix"] as? String == "CH" }!["id"] as! Int
let taqE = try s.createEntity(typeId: chType, name: "Taq-Polymerase", values: [:], author: "")
let taq = try s.saveLot(id: nil, values: ["entity": taqE["id"]!, "name": "Taq 5 U/µl", "lot_no": "L123", "amount": "500", "unit": "µl", "min": "100",
                                          "expiry": "2099-12-31", "location": box, "position": "a3", "ghs": ["GHS07", "XYZ"], "sds": "https://example.org/sds.pdf"], author: "Felix")
let taqId = taq["id"] as! Int
check(taq["code"] as? String == Store.lotCode(taqId) && taq["position"] as? String == "A3" && taq["ghs"] as? String == "GHS07", "Charge angelegt, Position und GHS bereinigt")
check((taq["moves"] as! [[String: Any]]).first?["kind"] as? String == "anlegen", "Anlegen ist die erste Bewegung")
check((try? s.saveLot(id: nil, values: ["name": "Andere", "amount": "1", "unit": "ml", "location": box, "position": "A3"], author: "")) == nil, "Belegte Position abgelehnt")
check((try? s.saveLot(id: nil, values: ["name": "X", "amount": "1", "unit": "ml", "location": box, "position": "K1"], author: "")) == nil, "Position außerhalb der Box abgelehnt")
check((try? s.saveLot(id: nil, values: ["name": "X", "amount": "1", "unit": "ml", "location": freezer, "position": "A1"], author: "")) == nil, "Position nur in Boxen")
let used = try s.moveLot(id: taqId, delta: -2, kind: "verbrauch", entry: usingEntry, note: "PCR", author: "Felix")
check(used["amount"] as? Double == 498, "Verbrauch: 500 − 2 = 498 µl")
check((try? s.moveLot(id: taqId, delta: -1000, kind: "verbrauch", entry: nil, note: "", author: "")) == nil, "Nicht mehr verbrauchen als vorhanden")
check((try? s.moveLot(id: taqId, delta: 2, kind: "verbrauch", entry: nil, note: "", author: "")) == nil, "Verbrauch muss positiv angegeben sein")
_ = try s.moveLot(id: taqId, delta: 2, kind: "storno", entry: usingEntry, note: "Storno", author: "Felix")
check((try s.lot(id: taqId))["amount"] as? Double == 500, "Storno bucht zurück")
_ = try s.moveLot(id: taqId, delta: -450, kind: "verbrauch", entry: nil, note: "", author: "")
check(((try s.lot(id: taqId))["warnings"] as! [String]) == ["low"], "Unter Mindestbestand: Warnung")
check((try s.lots(filter: "warnings")).contains { $0["id"] as? Int == taqId }, "Warnungsliste enthält die Charge")
let oldLot = try s.saveLot(id: nil, values: ["name": "Alter Puffer", "amount": "100", "unit": "ml", "expiry": "2020-01-01"], author: "")
check((oldLot["warnings"] as! [String]) == ["expired"], "Abgelaufene Charge wird gemeldet")
let soonDate = Store.isoDay(Date().addingTimeInterval(10 * 86400))
check(((try s.saveLot(id: nil, values: ["name": "Bald", "amount": "1", "unit": "g", "expiry": soonDate], author: ""))["warnings"] as! [String]) == ["soon"], "Bald ablaufend wird gemeldet")
_ = try s.moveLot(id: taqId, delta: -50, kind: "verbrauch", entry: nil, note: "", author: "")
check((try s.lot(id: taqId))["status"] as? String == "empty", "Leer verbraucht: Status leer")
_ = try s.moveLot(id: oldLot["id"] as! Int, delta: 0, kind: "entsorgen", entry: nil, note: "abgelaufen", author: "")
let gone = try s.lot(id: oldLot["id"] as! Int)
let activeLots = try s.lots()
check(gone["status"] as? String == "disposed" && gone["amount"] as? Double == 0 && !activeLots.contains { $0["id"] as? Int == oldLot["id"] as? Int }, "Entsorgt: Menge 0, nicht mehr in der Liste")
check((try s.lots(filter: "entity:\(taqE["id"]!)")).count == 1, "Chargen eines Registry-Objekts")
check((try s.lots(q: "L123")).count == 1, "Suche nach Chargennummer")
var sdb2: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &sdb2)
check(sqlite3_exec(sdb2, "UPDATE lot_move SET delta = 0", nil, nil, nil) != SQLITE_OK, "Bewegungen sind unveränderlich")
sqlite3_close(sdb2)

// M11: Strukturierte Ergebnisse
let schemas = try s.resultSchemas()
check(schemas.count == 3 && schemas.contains { $0["name"] as? String == "Plasmid-Präp" }, "Drei Ergebnisvorlagen angelegt")
let prep = schemas.first { $0["name"] as? String == "Plasmid-Präp" }!["id"] as! Int
let res1 = try s.create(title: "Präp 1"), res2 = try s.create(title: "Präp 2")
_ = try s.saveDraft(id: res1, title: "Präp 1", json: "{}", text: "", results: [["schema": prep, "rows": [["probe": "Klon 1", "konz": "250", "volumen": "50", "ausbeute": 12.5], ["probe": "", "konz": ""]]]])
_ = try s.saveDraft(id: res2, title: "Präp 2", json: "{}", text: "", results: [["schema": prep, "rows": [["probe": "Klon 2", "konz": "310", "volumen": "50", "ausbeute": 15.5]]], ["schema": 9999, "rows": [["x": 1]]]])
let rr = try s.resultRows(schema: prep)
check(rr.count == 2 && rr.map { $0["entry_id"] as! Int } == [res1, res2], "Zeilen über Einträge, leere Zeile und unbekannte Vorlage ignoriert")
_ = try s.saveDraft(id: res1, title: "Präp 1", json: "{}", text: "", results: [])
check((try s.resultRows(schema: prep)).count == 1, "Zeilen werden beim Speichern ersetzt")
try s.trashEntry(id: res2)
check((try s.resultRows(schema: prep)).isEmpty, "Papierkorb zählt nicht mit")
try s.restoreEntry(id: res2)
let futureRows = try s.resultRows(schema: prep, from: "2099-01-01"), pastRows = try s.resultRows(schema: prep, from: "2000-01-01")
check(futureRows.isEmpty && pastRows.count == 1, "Filter nach Zeitraum")
let mySchema = try s.saveResultSchema(id: nil, name: "Zellzählung", fields: [["key": "lebend", "label": "Lebend", "type": "number", "unit": "Zellen/ml"],
    ["key": "tot", "label": "Tot", "type": "number"], ["key": "viab", "label": "Viabilität", "type": "formula", "unit": "%", "expr": "lebend / (lebend + tot) * 100"]])
check(mySchema > 0, "Eigene Vorlage mit Formel")
check((try? s.saveResultSchema(id: nil, name: "Kaputt", fields: [["key": "a", "type": "formula", "expr": "a + b"]])) == nil, "Formel mit unbekanntem Feld abgelehnt")
check((try? s.saveResultSchema(id: nil, name: "Leer", fields: [])) == nil, "Vorlage ohne Felder abgelehnt")

// M12: Zellkultur und Gerätebuch
let zl = try s.types().first { $0["prefix"] as? String == "ZL" }!["id"] as! Int
let hela = try s.createEntity(typeId: zl, name: "HeLa", values: [:], author: "Test")["id"] as! Int
let kultur = try s.saveCulture(id: nil, values: ["name": "HeLa Flasche 1", "entity": hela, "passage": "12", "medium": "DMEM + 10 % FKS", "vessel": "T75", "max_passage": "14"], author: "Test")
let kid = kultur["id"] as! Int
check(try kultur["passage"] as? Int == 12 && kultur["code"] as? String == "KU-\(String(format: "%05d", kid))" && (kultur["warnings"] as! [String]).isEmpty, "Kultur mit Passage 12 angelegt, ohne Warnung")
let pEntry = try s.create(title: "Passage HeLa")
let pas = try s.cultureEvent(id: kid, kind: "passage", values: ["split": "1:10"], entry: pEntry, author: "Test")
let k13 = try s.culture(id: kid)
check(try pas["from"] as? Int == 12 && pas["passage"] as? Int == 13 && k13["passage"] as? Int == 13, "Passage 12 → 13 verbucht")
let ev13 = (k13["events"] as! [[String: Any]]).first!
check(try ev13["kind"] as? String == "passage" && ev13["detail"] as? String == "1:10" && ev13["entry_id"] as? Int == pEntry, "Ereignis mit Split und Verweis auf den Eintrag")
check(try (try? s.cultureEvent(id: kid, kind: "myco", values: ["result": "vielleicht"], entry: nil, author: "Test")) == nil, "Ungültiges Mycoplasma-Ergebnis abgelehnt")
var cdb: OpaquePointer?
sqlite3_open(dir.appendingPathComponent("db.sqlite").path, &cdb)
check(try sqlite3_exec(cdb, "UPDATE culture_event SET passage = 99", nil, nil, nil) != SQLITE_OK, "Kulturereignisse sind unveränderlich")
sqlite3_close(cdb)
_ = try s.cultureEvent(id: kid, kind: "passage", values: [:], entry: nil, author: "Test")
check(try (try s.culture(id: kid))["warnings"] as! [String] == ["passage_high"], "Höchstpassage 14 erreicht wird gemeldet")
let alt = try s.saveCulture(id: nil, values: ["name": "CHO alt", "passage": 3, "day": "2026-01-02", "myco_days": "30"], author: "Test")
check(try (alt["warnings"] as! [String]).contains("myco_due"), "Mycoplasma-Test überfällig (Start vor über 30 Tagen, nie getestet)")
_ = try s.cultureEvent(id: alt["id"] as! Int, kind: "myco", values: ["result": "negativ"], entry: nil, author: "Test")
check(try (try s.culture(id: alt["id"] as! Int))["warnings"] as! [String] == [], "Negativer Test heute: keine Warnung mehr")
_ = try s.cultureEvent(id: alt["id"] as! Int, kind: "myco", values: ["result": "positiv"], entry: nil, author: "Test")
check(try (try s.culture(id: alt["id"] as! Int))["warnings"] as! [String] == ["myco_pos"], "Positiver Test wird gemeldet")
let gefr = try s.saveLocation(id: nil, parent: nil, name: "Stickstofftank", kind: "box", rows: 10, cols: 10, temp: "−196 °C")
let fz = try s.cultureEvent(id: kid, kind: "freeze", values: ["count": "3", "location": gefr, "position": "B2"], entry: nil, author: "Test")
let fzLot = try s.lot(id: fz["lot"] as! Int)
check(try fzLot["amount"] as? Double == 3 && fzLot["unit"] as? String == "Röhrchen" && fzLot["name"] as? String == "HeLa Flasche 1 P14" && fzLot["entity_id"] as? Int == hela && fzLot["position"] as? String == "B2",
      "Einfrieren legt Charge an: 3 Röhrchen P14 im Tank B2")
check(try (try? s.cultureEvent(id: kid, kind: "freeze", values: ["count": "2", "location": gefr, "position": "B2"], entry: nil, author: "Test")) == nil
      && (try s.lots(filter: "location:\(gefr)")).count == 1, "Belegte Position: Einfrieren scheitert ganz (keine halbe Buchung)")
let frozen = try s.frozenStock()
check(try frozen.count == 1 && frozen[0]["passage"] as? Int == 14 && (frozen[0]["location_path"] as? String) == "Stickstofftank", "Einfrierliste mit Passage und Standort")
let thawed = try s.thawCulture(lot: fz["lot"] as! Int, name: "HeLa aufgetaut", entry: nil, author: "Test")
check(try thawed["passage"] as? Int == 14 && thawed["entity_id"] as? Int == hela && thawed["medium"] as? String == "DMEM + 10 % FKS"
      && (try s.lot(id: fz["lot"] as! Int))["amount"] as? Double == 2, "Auftauen: neue Kultur P14, ein Röhrchen weniger")
check(try ((try s.culture(id: thawed["id"] as! Int))["events"] as! [[String: Any]]).first?["kind"] as? String == "thaw", "Ereignis „aufgetaut“ mit Charge")
check(try (try? s.cultureEvent(id: kid, kind: "correct", values: ["passage": "20"], entry: nil, author: "Test")) == nil, "Korrektur ohne Grund abgelehnt")
_ = try s.cultureEvent(id: kid, kind: "correct", values: ["passage": "13", "note": "Falsch gezählt"], entry: nil, author: "Test")
_ = try s.cultureEvent(id: kid, kind: "end", values: [:], entry: nil, author: "Test")
check(try (try s.culture(id: kid))["status"] as? String == "ended" && (try? s.cultureEvent(id: kid, kind: "passage", values: [:], entry: nil, author: "Test")) == nil
      && !(try s.cultures()).contains { $0["id"] as? Int == kid }, "Beendete Kultur: keine Ereignisse mehr, nicht in der aktiven Liste")
try s.trashEntry(id: pEntry)
check(try (try? s.purgeEntry(id: pEntry)) == nil && (try s.emptyTrash()) >= 0 && (try s.trash()).contains { $0["id"] as? Int == pEntry }, "Eintrag mit Buchungen bleibt im Papierkorb (kein endgültiges Löschen)")
try s.restoreEntry(id: pEntry)

let pip = try s.saveDevice(id: nil, values: ["name": "Pipette P200", "model": "Research plus", "serial": "S123"])
let pid = pip["id"] as! Int
check(try (pip["warnings"] as! [String]).isEmpty, "Gerät angelegt")
let withTask = try s.saveDeviceTask(id: nil, device: pid, values: ["kind": "kalibrierung", "interval": "365", "next_due": "2026-01-15"])
check(try withTask["warnings"] as! [String] == ["overdue"] && (try s.careWarnings())["devices"] == 1, "Fällige Kalibrierung wird gemeldet")
let soon = try s.saveDeviceTask(id: nil, device: pid, values: ["kind": "wartung", "interval": "180", "next_due": Store.addDays(Store.isoDay(Date()), 5)])
check(try (soon["tasks"] as! [[String: Any]]).map { $0["state"] as! String } == ["overdue", "due"], "Wartung in 5 Tagen: bald fällig")
let calTask = (soon["tasks"] as! [[String: Any]]).first { $0["kind"] as? String == "kalibrierung" }!["id"] as! Int
let logged = try s.logDevice(id: pid, task: calTask, kind: nil, result: "ok", values: ["note": "Gravimetrisch, 0,3 % Abweichung"], entry: nil, author: "Test")
check(try logged["next_due"] as? String == Store.addDays(Store.isoDay(Date()), 365), "Kalibrierung erledigt: nächste in 365 Tagen")
check(try (try s.device(id: pid))["warnings"] as! [String] == ["due"], "Danach nur noch die bald fällige Wartung")
_ = try s.logDevice(id: pid, task: nil, kind: "stoerung", result: nil, values: ["note": "Kolben klemmt"], entry: nil, author: "Test")
check(try (try s.device(id: pid))["status"] as? String == "defekt" && ((try s.device(id: pid))["warnings"] as! [String]).first == "defect", "Störung: Gerät defekt")
_ = try s.logDevice(id: pid, task: nil, kind: "reparatur", result: nil, values: [:], entry: nil, author: "Test")
let repaired = try s.device(id: pid)
check(try repaired["status"] as? String == "ok" && (repaired["log"] as! [[String: Any]]).count == 3, "Reparatur: wieder einsatzbereit; Protokoll mit 3 Einträgen")
check(try (try? s.logDevice(id: pid, task: nil, kind: "notiz", result: nil, values: [:], entry: nil, author: "Test")) == nil, "Leere Notiz abgelehnt")
let dumpAll = try s.dump()
check(try (dumpAll["cultures"] as! [[String: Any]]).count == 3 && (dumpAll["device_log"] as! [[String: Any]]).count == 3 && (dumpAll["lots"] as! [[String: Any]]).count >= 1, "Export enthält Bestand, Kulturen und Gerätebuch")

// M13: Bestellungen und Wareneingang
let tryp = try s.saveLot(id: nil, values: ["name": "Trypsin-EDTA", "amount": "10", "unit": "ml", "min": "20", "supplier": "Gibco", "catalog": "25300-054", "ghs": ["GHS07"]], author: "Test")
let trypId = tryp["id"] as! Int
check(try (tryp["warnings"] as! [String]).contains("low"), "Trypsin knapp (10 ml, Mindestbestand 20 ml)")
var sugg = try s.purchaseSuggestions()
check(try sugg.contains { $0["lot_id"] as? Int == trypId }, "Knappes Reagenz erscheint als Bestellvorschlag")
let order = try s.createPurchase(values: ["lot": trypId, "amount": "100", "qty": "2", "price": "38,50 €"], author: "Test")
let oid = order["id"] as! Int
check(try order["name"] as? String == "Trypsin-EDTA" && order["catalog"] as? String == "25300-054" && order["status"] as? String == "offen", "Bestellung übernimmt Name, Katalognr. und Lieferant")
check(try !(try s.purchaseSuggestions()).contains { $0["lot_id"] as? Int == trypId }, "Bestelltes verschwindet aus den Vorschlägen")
check(try (try? s.createPurchase(values: ["lot": trypId], author: "Test")) == nil, "Doppelte Bestellung abgelehnt")
_ = try s.setPurchaseStatus(id: oid, status: "bestellt", note: "Bestell-Nr. 4711", author: "Test")
check(try (try? s.setPurchaseStatus(id: oid, status: "geliefert", note: "", author: "Test")) == nil, "„Geliefert“ nur über den Wareneingang")
let rec = try s.receivePurchase(id: oid, values: ["lot_no": "2611A", "expiry": "2027-06-30"], author: "Test")
let newLot = rec["lot"] as! [String: Any]
check(try newLot["amount"] as? Double == 200 && newLot["lot_no"] as? String == "2611A" && newLot["ghs"] as? String == "GHS07" && newLot["min_amount"] as? Double == 20,
      "Wareneingang: neue Charge 2 × 100 ml mit Chargennr., Gefahren und Mindestbestand")
let delivered = try s.purchase(id: oid)
check(try delivered["status"] as? String == "geliefert" && (delivered["log"] as! [[String: Any]]).map { $0["status"] as! String } == ["offen", "bestellt", "geliefert"], "Statusverlauf offen → bestellt → geliefert")
check(try !(try s.lot(id: trypId)["warnings"] as! [String]).contains("low"), "Alte Charge nicht mehr knapp, weil Nachschub da ist")
check(try (try? s.receivePurchase(id: oid, values: [:], author: "Test")) == nil, "Zweiter Eingang abgelehnt")
let free = try s.createPurchase(values: ["name": "Pipettenspitzen 200 µl", "qty": "5", "unit": "Packung"], author: "Test")
_ = try s.setPurchaseStatus(id: free["id"] as! Int, status: "storniert", note: "doch noch da", author: "Test")
check(try (try s.purchases()).isEmpty && (try s.purchases(filter: "all")).count == 2, "Stornierte und gelieferte nur unter „alle“")

// M14: Sequenz-Anmerkungen
let plType2 = try s.types().first { $0["prefix"] as? String == "PL" }!["id"] as! Int
let pl = try s.createEntity(typeId: plType2, name: "pTest", values: ["sequence": "ATGAAACCCGGGTTTAAACCCGGGTTTAAA"], author: "Test")
let plId = pl["id"] as! Int
check(try (try s.seqAnnotation(entity: plId, field: "sequence"))["circular"] as? Bool == false, "Ohne Anmerkung: linear, keine Features")
let ann = try s.setSeqAnnotation(entity: plId, field: "sequence", circular: true, features: [["start": 2, "end": 15, "strand": -1, "type": "CDS", "label": "abc", "parts": [[2, 7], [10, 15]]],
                                                                                          ["start": 28, "end": 3, "strand": 1, "type": "rep_origin", "label": "ori"]], source: "test.gb")
check(try (ann["features"] as! [[String: Any]]).count == 2 && ann["circular"] as? Bool == true, "Features und Ring gespeichert (auch über den Ursprung)")
check(try (try? s.setSeqAnnotation(entity: plId, field: "sequence", circular: false, features: [["start": 28, "end": 3]], source: "")) == nil, "Über den Ursprung nur bei Ringen")
check(try (try? s.setSeqAnnotation(entity: plId, field: "sequence", circular: true, features: [["start": 1, "end": 31]], source: "")) == nil, "Feature außerhalb abgelehnt")
check(try (try? s.seqAnnotation(entity: plId, field: "name")) == nil, "Nur Sequenzfelder")
_ = try s.updateEntity(id: plId, name: "pTest", values: ["sequence": "ATGAAACCCGGGTTTAAACCCGGGTTTAAAG"], author: "Test")
let staleA = try s.seqAnnotation(entity: plId, field: "sequence")
check(try staleA["stale"] as? Bool == true && (staleA["features"] as! [Any]).isEmpty && staleA["length"] as? Int == 31, "Sequenz geändert: Features gelten als veraltet")
check(try (try s.sequenceObjects()).contains { $0["entity"] as? Int == plId && $0["length"] as? Int == 31 }, "Objekte mit Sequenz für die Auswahl")

// M18: Literatur
let sanger: [String: Any] = ["key": "Sanger1977", "title": "DNA sequencing with chain-terminating inhibitors", "authors": [["family": "Sanger", "given": "F."]], "year": "1977", "doi": "10.1073/pnas.74.12.5463"]
let ref1 = try s.saveReference(id: nil, data: sanger, source: "test.bib")
check(try ref1["key"] as? String == "Sanger1977" && ref1["existing"] == nil, "Quelle gespeichert")
let dupe = try s.saveReference(id: nil, data: ["key": "x", "title": "Anders", "doi": "10.1073/PNAS.74.12.5463"], source: "")
check(try dupe["existing"] as? Bool == true && dupe["id"] as? Int == ref1["id"] as? Int, "Gleiche DOI (Groß/klein egal) wird erkannt")
let imp = try s.importReferences([["key": "Sanger1977", "title": "Andere Arbeit", "year": "1977", "authors": [["family": "Sanger"]]], ["title": "Ohne Schlüssel"]], source: "x.ris")
check(try imp["added"] as? Int == 2 && (try s.references()).count == 3, "Import: zwei neue")
check(try (try s.references()).contains { $0["key"] as? String == "Sanger1977a" }, "Schlüssel bleibt eindeutig (Sanger1977a)")
check(try (try? s.saveReference(id: nil, data: ["year": "2000"], source: "")) == nil, "Quelle ohne Titel und Autoren abgelehnt")
let citing = try s.create(title: "Sequenzierung")
let rid = ref1["id"] as! Int
_ = try s.saveDraft(id: citing, title: "Sequenzierung", json: "{\"type\":\"doc\",\"content\":[{\"type\":\"cite\",\"attrs\":{\"short\":\"Sanger et al. 1977\",\"refid\":\(rid)}}]}", text: "")
check(try ((try s.reference(id: rid))["cited_in"] as! [[String: Any]]).count == 1, "Zitiert in: der Eintrag")
check(try (try? s.deleteReference(id: rid)) == nil, "Zitierte Quelle lässt sich nicht löschen")

// M19: Fälligkeiten
let today = Store.isoDay(Date())
let agEntry = try s.create(title: "Planung")
_ = try s.saveDraft(id: agEntry, title: "Planung", json: "{}", text: "", tasks: [["text": "Antikörper bestellen bis morgen", "due": Store.addDays(today, 1), "done": false],
                                                                                 ["text": "Erledigt", "due": today, "done": true], ["text": "kaputtes Datum", "due": "31.02."]])
let ag = try s.agenda(until: Store.addDays(today, 30), today: today)
check(try ag.contains { $0["kind"] as? String == "task" && $0["title"] as? String == "Antikörper bestellen bis morgen" } && !ag.contains { $0["title"] as? String == "Erledigt" }, "Offene Aufgabe mit Datum in der Übersicht, erledigte nicht")
check(try ag.contains { $0["kind"] as? String == "device" } && ag.contains { $0["kind"] as? String == "myco" }, "Geräteaufgaben und Mycoplasma-Tests in der Übersicht")
check(try ag.map { $0["due"] as! String } == ag.map { $0["due"] as! String }.sorted(), "Nach Datum sortiert")
try s.trashEntry(id: agEntry)
check(try !(try s.agenda(until: Store.addDays(today, 30), today: today)).contains { $0["kind"] as? String == "task" && $0["id"] as? Int == agEntry }, "Papierkorb zählt nicht")
try s.restoreEntry(id: agEntry)

// M21: SMILES-Feld für Chemikalien (Migration)
check(try ((try s.types()).first { $0["prefix"] as? String == "CH" }!["fields_json"] as! String).contains("\"smiles\""), "Chemikalie hat ein SMILES-Feld")

// M22: Automatisierung (Store-Teil)
let autoId = try s.newEntry(title: "", text: "Notiz aus Safari\nzweite Zeile\n\nnach Leerzeile")
let autoE = try s.load(id: autoId)
check(try autoE["title"] as? String == "Notiz aus Safari" && (autoE["draft_json"] as! String).contains("nach Leerzeile"), "Neuer Eintrag aus Text: erste Zeile wird Titel")
try s.appendText(entry: autoId, text: "Nachtrag per Kurzbefehl")
check(try (try s.entryText(id: autoId)).hasSuffix("Nachtrag per Kurzbefehl") && (try s.search("Kurzbefehl")).contains { $0["id"] as? Int == autoId }, "Text angehängt und durchsuchbar")
check(try (try? s.appendText(entry: 999_999, text: "x")) == nil, "Unbekannter Eintrag abgelehnt")
let linkTarget = try s.create(title: "Ziel")
_ = try s.saveDraft(id: autoId, title: "Notiz aus Safari", json: "{\"type\":\"doc\",\"content\":[]}", text: "mit Verweis", links: [linkTarget])
try s.appendText(entry: autoId, text: "noch etwas")
check(try (try s.backlinks(id: linkTarget)).contains { $0["id"] as? Int == autoId }, "Anhängen lässt Verweise des Eintrags bestehen")

// M25: Zeitraum der Tagesabschnitte
let lab = try s.create(title: "Nanoreactor Lab Book")
_ = try s.saveDraft(id: lab, title: "Nanoreactor Lab Book", json: "{}", text: "Golden Gate", days: ["2026-10-15", "2026-06-30", "kaputt", "2026-07-01"])
let labRow = try s.list().first { $0["id"] as? Int == lab }!
check(try labRow["day_first"] as? String == "2026-06-30" && labRow["day_last"] as? String == "2026-10-15", "Zeitraum aus den Tagen (ungültige ignoriert)")
check(try (try s.search("Golden")).first { $0["id"] as? Int == lab }?["day_last"] as? String == "2026-10-15", "Suche liefert den Zeitraum mit")

// M26: Protokolle am Eintrag, Metadaten, Verknüpft
let protoGG = try s.create(title: "Golden Gate Assembly", kind: "protocol"), protoTrafo = try s.create(title: "E. coli Transformation", kind: "protocol")
let lb26 = try s.create(title: "Laborbuch 26")
try s.attach(entry: lb26, other: protoGG)
_ = try s.saveDraft(id: lb26, title: "Laborbuch 26", json: "{\"type\":\"doc\",\"content\":[]}", text: "", links: [protoTrafo, protoGG])
let att26 = try s.attachments(entry: lb26)
check(try att26.map { $0["title"] as! String } == ["Golden Gate Assembly", "E. coli Transformation"] && att26.map { $0["explicit"] as! Int } == [1, 0], "Angehängtes und im Text verlinktes Protokoll als Reiter")
check(try (try? s.attach(entry: lb26, other: lb26)) == nil, "Nicht an sich selbst")
try s.detach(entry: lb26, other: protoGG)
check(try (try s.attachments(entry: lb26)).count == 2, "Abhängen: im Text verlinkt bleibt es sichtbar")
let meta26 = try s.setEntryMeta(entry: lb26, fields: [["k": "Organismus", "v": "S. cerevisiae"], ["k": "", "v": ""], ["k": "Stamm", "v": "BY4741"]])
check(try meta26.count == 2 && (try s.load(id: lb26))["meta_json"] as? String == "[{\"k\":\"Organismus\",\"v\":\"S. cerevisiae\"},{\"k\":\"Stamm\",\"v\":\"BY4741\"}]", "Eigene Felder gespeichert, leere Zeilen weg")
check(try (try? s.setEntryMeta(entry: lb26, fields: [["k": "", "v": "ohne Namen"]])) == nil, "Feld ohne Bezeichnung abgelehnt")
check(try (try s.metaKeys()).contains("Organismus"), "Feldbezeichnungen als Vorschläge")
let rel26 = try s.related(entry: lb26)
check(try (rel26["links"] as! [[String: Any]]).count == 2 && (try s.related(entry: protoGG)["backlinks"] as! [[String: Any]]).count == 1, "Verknüpft: Verweise hin und zurück")
let relPCR = try s.related(entry: pEntry)
check(try (relPCR["cultures"] as! [[String: Any]]).first?["code"] as? String == Store.cultureCode(kid), "Verknüpft: Kultur mit Passage aus dem Eintrag")

// M28: Einträge verwalten
try s.setEntryFlags(id: lb26, status: "fehlgeschlagen", pinned: true)
let row28 = try s.list().first { $0["id"] as? Int == lb26 }!
check(try row28["status"] as? String == "fehlgeschlagen" && row28["pinned"] as? Int == 1, "Status und Anheften")
check(try (try? s.setEntryFlags(id: lb26, status: "gelb", pinned: nil)) == nil, "Unbekannter Status abgelehnt")
try s.touchOpened(id: lb26)
check(try (try s.list().first { $0["id"] as? Int == lb26 }!["opened"] as? String) != nil, "Zuletzt geöffnet gemerkt")
_ = try s.setTags(id: lb26, names: ["Hefe"])
let dup = try s.duplicate(id: lb26)
let dupE = try s.load(id: dup), dupRow = try s.list().first { $0["id"] as? Int == dup }!
check(try dupE["title"] as? String == "Laborbuch 26 (Kopie)" && dupE["signed_no"] as? Int == nil && dupRow["revisions"] as? Int == 0 && dupRow["status"] as? String == ""
      && (dupE["tags"] as? [String]) == ["Hefe"] && (dupE["meta_json"] as? String)?.contains("BY4741") == true,
      "Duplikat: Inhalt, Tags, Metadaten; ohne Revisionen, Signatur, Status")
let signedDup = try s.duplicate(id: se)
check(try (try s.load(id: signedDup))["signed_no"] as? Int == nil, "Duplikat eines abgeschlossenen Eintrags ist bearbeitbar")
let ssId = try s.saveSearch(name: "Fehlgeschlagen", query: ["status": "fehlgeschlagen", "q": ""])
check(try (try s.savedSearches()).first { $0["id"] as? Int == ssId }?["query_json"] as? String == "{\"q\":\"\",\"status\":\"fehlgeschlagen\"}", "Gespeicherte Suche")
try s.deleteSavedSearch(id: ssId)
check(try (try s.savedSearches()).isEmpty, "Gespeicherte Suche gelöscht")

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

// Konten: PBKDF2 mit eigenem Salz, nie das Passwort selbst in der Datenbank
do {
    let dirA = FileManager.default.temporaryDirectory.appendingPathComponent("lb-acc-\(UUID().uuidString).laborbuch")
    defer { try? FileManager.default.removeItem(at: dirA) }
    let a = try Store(root: dirA)
    check(try a.accountNames().isEmpty, "Konten: anfangs keins")
    _ = try a.createAccount(name: "  Felix ", password: "geheim-123")
    check(try a.accountNames() == ["Felix"], "Konten: Name ohne Leerzeichen gespeichert")
    check(try a.authenticate(name: "felix", password: "geheim-123"), "Konten: Anmeldung (Name ohne Rücksicht auf Groß-/Kleinschreibung)")
    check(try !a.authenticate(name: "Felix", password: "falsch-1234"), "Konten: falsches Passwort wird abgelehnt")
    check(try !a.authenticate(name: "Niemand", password: "geheim-123"), "Konten: unbekannter Name wird abgelehnt")
    check((try? a.createAccount(name: "FELIX", password: "anderes-pw-1")) == nil, "Konten: Name nur einmal vergeben")
    check((try? a.createAccount(name: "Kurz", password: "1234567")) == nil, "Konten: Passwort unter 8 Zeichen abgelehnt")
    check((try? a.createAccount(name: "  ", password: "geheim-123")) == nil, "Konten: leerer Name abgelehnt")
    let row = try a.queryRows("SELECT * FROM account").first!
    check(!(row["hash"] as! String).contains("geheim") && (row["salt"] as! String).count == 32 && (row["hash"] as! String).count == 64 && row["rounds"] as? Int == Store.kdfRounds,
          "Konten: nur Hash (32 Byte) und Salz (16 Byte) gespeichert")
    _ = try a.createAccount(name: "Anna", password: "geheim-123")
    let salts = try a.queryRows("SELECT salt, hash FROM account")
    check(Set(salts.map { $0["salt"] as! String }).count == 2 && Set(salts.map { $0["hash"] as! String }).count == 2, "Konten: gleiches Passwort ergibt anderes Salz und anderen Hash")
    check((try? a.changePassword(name: "Felix", old: "falsch-1234", new: "neu-passwort-1")) == nil, "Konten: Passwortwechsel braucht das alte Passwort")
    try a.changePassword(name: "Felix", old: "geheim-123", new: "neu-passwort-1")
    check(try a.authenticate(name: "Felix", password: "neu-passwort-1") && !(try a.authenticate(name: "Felix", password: "geheim-123")), "Konten: neues Passwort gilt, altes nicht")
    check(try a.authenticate(name: "Anna", password: "geheim-123"), "Konten: anderes Konto bleibt unberührt")
    check(try (try? a.deleteAccount(name: "Anna", password: "falsch-1234")) == nil && a.accountNames().count == 2, "Konten: Löschen mit falschem Passwort scheitert")
    try a.deleteAccount(name: "Anna", password: "geheim-123")
    check(try a.accountNames() == ["Felix"], "Konten: Löschen mit Passwort")
}

// Kalender-Planung
do {
    let dirP = FileManager.default.temporaryDirectory.appendingPathComponent("lb-plan-\(UUID().uuidString).laborbuch")
    defer { try? FileManager.default.removeItem(at: dirP) }
    let p = try Store(root: dirP)
    let a = try p.savePlan(id: nil, values: ["day": "2026-10-27", "time_from": "14:00", "time_to": "15:30", "title": "Gruppenseminar", "kind": "termin"])
    let b = try p.savePlan(id: nil, values: ["day": "2026-10-26", "day_end": "2026-10-28", "title": "Transfektion HeLa", "kind": "experiment", "note": "Lipofectamin, 24 h"])
    _ = try p.savePlan(id: nil, values: ["day": "2026-10-27", "time_from": "09:00", "title": "Mikroskop buchen"])
    _ = try p.savePlan(id: nil, values: ["day": "2026-11-05", "title": "später"])
    let week = try p.plans(from: "2026-10-26", to: "2026-11-01")
    check(week.count == 3 && !week.contains { $0["title"] as? String == "später" }, "Planung: nur Pläne der Woche")
    check(week.map { $0["title"] as! String } == ["Transfektion HeLa", "Mikroskop buchen", "Gruppenseminar"], "Planung: sortiert nach Tag, dann Uhrzeit")
    check(try p.plans(from: "2026-10-28", to: "2026-10-28").map { $0["id"] as! Int } == [b], "Planung: mehrtägig zählt für den Mittelstag")
    check(try p.plans(from: "2026-10-29", to: "2026-10-31").isEmpty, "Planung: nach dem Ende nicht mehr")
    for bad: [String: Any] in [["day": "2026-10-27", "title": " "], ["day": "27.10.2026", "title": "x"], ["day": "2026-10-27", "day_end": "2026-10-26", "title": "x"],
                               ["day": "2026-10-27", "time_from": "25:00", "title": "x"], ["day": "2026-10-27", "time_from": "15:00", "time_to": "14:00", "title": "x"], ["day": "2026-10-27", "title": "x", "kind": "party"]] {
        check((try? p.savePlan(id: nil, values: bad)) == nil, "Planung: ungültig abgelehnt (\(bad["title"] ?? ""), \(bad["day"] ?? ""))")
    }
    try p.savePlan(id: a, values: ["day": "2026-10-30", "time_from": "10:00", "title": "Gruppenseminar", "kind": "termin"])
    check(try p.plans(from: "2026-10-30", to: "2026-10-30").first?["time_from"] as? String == "10:00", "Planung: Termin verschieben")
    try p.setPlanDone(id: a, done: true)
    check(try p.plans(from: "2026-10-30", to: "2026-10-30").first?["done"] as? Int == 1, "Planung: erledigt")
    let e = try p.entryForPlan(id: b)
    let load = try p.load(id: e)
    let dayFirst = try p.queryRows("SELECT day_first FROM entry WHERE id = ?", [e]).first?["day_first"] as? String
    check(load["title"] as? String == "Transfektion HeLa" && load["kind"] as? String == "experiment" && dayFirst == "2026-10-26", "Planung: Eintrag zum Experiment mit Tagesabschnitt")
    check(try p.entryForPlan(id: b) == e, "Planung: zweiter Aufruf liefert denselben Eintrag")
    check(try p.plans(from: "2026-10-26", to: "2026-10-26").first(where: { $0["id"] as? Int == b })?["entry_title"] as? String == "Transfektion HeLa", "Planung: Titel des Eintrags in der Liste")
    try p.deletePlan(id: b)
    check(try p.plans(from: "2026-10-26", to: "2026-10-26").isEmpty && (try? p.load(id: e)) != nil, "Planung: Löschen lässt den Eintrag stehen")
}

// Planung: Eintrag verlinken; Oberflächen-Einstellungen
do {
    let dirQ = FileManager.default.temporaryDirectory.appendingPathComponent("lb-pref-\(UUID().uuidString).laborbuch")
    defer { try? FileManager.default.removeItem(at: dirQ) }
    let q = try Store(root: dirQ)
    let e1 = try q.create(title: "Ansatz 1")
    let linked = try q.savePlan(id: nil, values: ["day": "2026-11-02", "title": "Mit Verweis", "entry_id": e1])
    check(try q.plans(from: "2026-11-02", to: "2026-11-02").first?["entry_title"] as? String == "Ansatz 1", "Planung: vorhandenen Eintrag verlinken")
    check((try? q.savePlan(id: nil, values: ["day": "2026-11-02", "title": "x", "entry_id": 99999])) == nil, "Planung: Verweis auf fehlenden Eintrag abgelehnt")
    try q.savePlan(id: linked, values: ["day": "2026-11-03", "title": "Mit Verweis"])
    check(try q.plans(from: "2026-11-03", to: "2026-11-03").first?["entry_id"] as? Int == e1, "Planung: ohne Schlüssel bleibt die Verknüpfung")
    try q.savePlan(id: linked, values: ["day": "2026-11-03", "title": "Mit Verweis", "entry_id": NSNull()])
    check(try q.plans(from: "2026-11-03", to: "2026-11-03").first?["entry_id"] as? Int == nil, "Planung: Verknüpfung lösen")
    check(try q.prefs().isEmpty, "Einstellungen: anfangs leer")
    try q.setPref(key: "theme", value: "nord"); try q.setPref(key: "theme", value: "dracula"); try q.setPref(key: "hiddenTabs", value: "orders,dev")
    check(try q.prefs() == ["theme": "dracula", "hiddenTabs": "orders,dev"], "Einstellungen: speichern und überschreiben")
    check((try? q.setPref(key: "irgendwas", value: "x")) == nil, "Einstellungen: unbekannter Schlüssel abgelehnt")
}

print(failures == 0 ? "\nAlle Tests bestanden" : "\n\(failures) Test(s) fehlgeschlagen")
exit(failures == 0 ? 0 : 1)
