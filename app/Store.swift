// Laborbuch-Datei: SQLite (Einträge, Arbeitsstand, unveränderliche Revisionen mit Hash-Kette, Volltextsuche) und Anhänge nach SHA-256.
import CryptoKit
import Foundation
import SQLite3

enum StoreError: Error, CustomStringConvertible {
    case sqlite(String), invalid(String)
    var description: String { switch self { case .sqlite(let m), .invalid(let m): return m } }
}

private let TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class Store {
    static let schemaVersion = 12
    static let kinds = ["experiment", "note", "protocol"]
    let root: URL
    private var db: OpaquePointer?
    private var txDepth = 0  // verschachtelte Transaktionen laufen als Savepoints

    init(root: URL) throws {
        self.root = root
        let fm = FileManager.default
        let existed = fm.fileExists(atPath: root.appendingPathComponent("db.sqlite").path)
        try fm.createDirectory(at: root.appendingPathComponent("files"), withIntermediateDirectories: true)
        let meta = root.appendingPathComponent("meta.json")
        if !fm.fileExists(atPath: meta.path) {
            let m: [String: Any] = ["format": 1, "id": UUID().uuidString, "created": Store.now()]
            try JSONSerialization.data(withJSONObject: m, options: [.prettyPrinted]).write(to: meta)
        }
        guard sqlite3_open(root.appendingPathComponent("db.sqlite").path, &db) == SQLITE_OK else {
            throw StoreError.sqlite("Datenbank lässt sich nicht öffnen")
        }
        try exec("""
        PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS entry(
          id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL,
          draft_json TEXT NOT NULL DEFAULT '', draft_text TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS revision(
          id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entry(id), no INTEGER NOT NULL,
          title TEXT NOT NULL, content_json TEXT NOT NULL, created TEXT NOT NULL,
          prev_hash TEXT NOT NULL, hash TEXT NOT NULL, UNIQUE(entry_id, no));
        CREATE TRIGGER IF NOT EXISTS revision_readonly_u BEFORE UPDATE ON revision BEGIN SELECT RAISE(ABORT, 'Revisionen sind unveränderlich'); END;
        CREATE TRIGGER IF NOT EXISTS revision_readonly_d BEFORE DELETE ON revision BEGIN SELECT RAISE(ABORT, 'Revisionen sind unveränderlich'); END;
        CREATE TABLE IF NOT EXISTS attachment(sha256 TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, body, tokenize='unicode61 remove_diacritics 2');
        """)
        try migrate(backup: existed)
    }

    /// Bringt ältere Bücher auf den aktuellen Stand. Vorher wird eine Kopie der Datenbank unter backups/ abgelegt.
    private func migrate(backup: Bool) throws {
        let v = try query("PRAGMA user_version").first?["user_version"] as? Int ?? 0
        if v > Store.schemaVersion { throw StoreError.invalid("Dieses Laborbuch stammt von einer neueren App-Version. Bitte die App aktualisieren.") }
        if v == Store.schemaVersion { return }
        if backup {
            let dir = root.appendingPathComponent("backups")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let stamp = Store.now().replacingOccurrences(of: ":", with: "-")
            try query("VACUUM INTO ?", [dir.appendingPathComponent("db-v\(v)-\(stamp).sqlite").path])
        }
        try transaction {
            if v < 1 {
                try exec("""
                CREATE TABLE project(id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
                ALTER TABLE entry ADD COLUMN project_id INTEGER REFERENCES project(id);
                ALTER TABLE entry ADD COLUMN kind TEXT NOT NULL DEFAULT 'experiment';
                CREATE INDEX entry_project ON entry(project_id);
                """)
            }
            if v < 2 {
                // Tags, Verweise zwischen Einträgen, Dateien je Eintrag; Suche zusätzlich über Tags
                try exec("""
                CREATE TABLE tag(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
                CREATE TABLE entry_tag(entry_id INTEGER NOT NULL REFERENCES entry(id), tag_id INTEGER NOT NULL REFERENCES tag(id), PRIMARY KEY(entry_id, tag_id));
                CREATE TABLE link(from_entry INTEGER NOT NULL REFERENCES entry(id), to_entry INTEGER NOT NULL REFERENCES entry(id), PRIMARY KEY(from_entry, to_entry));
                CREATE INDEX link_to ON link(to_entry);
                CREATE TABLE entry_file(entry_id INTEGER NOT NULL REFERENCES entry(id), sha256 TEXT NOT NULL REFERENCES attachment(sha256), PRIMARY KEY(entry_id, sha256));
                DROP TABLE search;
                CREATE VIRTUAL TABLE search USING fts5(title, body, tags, tokenize='unicode61 remove_diacritics 2');
                INSERT INTO search(rowid, title, body, tags) SELECT id, title, draft_text, '' FROM entry;
                """)
            }
            if v < 3 {
                // Vorlagen mit unveränderlichen Versionen; Läufe (Ausführung eines Protokolls mit Zeitstempeln je Schritt)
                try exec("""
                CREATE TABLE template(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE template_version(template_id INTEGER NOT NULL REFERENCES template(id), version INTEGER NOT NULL, title TEXT NOT NULL,
                  kind TEXT NOT NULL, content_json TEXT NOT NULL, created TEXT NOT NULL, source_entry INTEGER, PRIMARY KEY(template_id, version));
                CREATE TRIGGER template_version_ro_u BEFORE UPDATE ON template_version BEGIN SELECT RAISE(ABORT, 'Vorlagenversionen sind unveränderlich'); END;
                CREATE TRIGGER template_version_ro_d BEFORE DELETE ON template_version BEGIN SELECT RAISE(ABORT, 'Vorlagenversionen sind unveränderlich'); END;
                ALTER TABLE entry ADD COLUMN template_id INTEGER REFERENCES template(id);
                ALTER TABLE entry ADD COLUMN template_version INTEGER;
                CREATE TABLE run(id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entry(id), started TEXT NOT NULL, finished TEXT,
                  status TEXT NOT NULL DEFAULT 'running', steps_json TEXT NOT NULL);
                CREATE INDEX run_entry ON run(entry_id);
                CREATE TABLE run_step(run_id INTEGER NOT NULL REFERENCES run(id), step_no INTEGER NOT NULL, done_at TEXT NOT NULL,
                  note TEXT NOT NULL DEFAULT '', PRIMARY KEY(run_id, step_no));
                """)
            }
            if v < 4 {
                // Signaturen (Autor: Ed25519 über den Revisions-Hash; Zeuge: unterschriebenes PDF mit dem Hash) und Abschluss von Einträgen
                try exec("""
                ALTER TABLE entry ADD COLUMN signed_no INTEGER;
                CREATE TABLE signer(pubkey TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE signature(id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entry(id), rev_no INTEGER NOT NULL,
                  kind TEXT NOT NULL CHECK(kind IN ('author', 'witness')), name TEXT NOT NULL, signed_at TEXT NOT NULL,
                  pubkey TEXT, sig TEXT, file_sha256 TEXT, hash_found INTEGER);
                CREATE INDEX signature_entry ON signature(entry_id);
                CREATE TRIGGER signature_ro_u BEFORE UPDATE ON signature BEGIN SELECT RAISE(ABORT, 'Signaturen sind unveränderlich'); END;
                CREATE TRIGGER signature_ro_d BEFORE DELETE ON signature BEGIN SELECT RAISE(ABORT, 'Signaturen sind unveränderlich'); END;
                """)
            }
            if v < 5 {
                // Texterkennung in Anhängen (durchsuchbar) und verlinkte Rohdaten (bleiben am Ort, nur Prüfsumme im Buch)
                try exec("""
                ALTER TABLE attachment ADD COLUMN ocr_text TEXT;
                ALTER TABLE attachment ADD COLUMN stored TEXT NOT NULL DEFAULT 'copy';
                ALTER TABLE attachment ADD COLUMN path TEXT;
                ALTER TABLE attachment ADD COLUMN mtime REAL;
                DROP TABLE search;
                CREATE VIRTUAL TABLE search USING fts5(title, body, tags, files, tokenize='unicode61 remove_diacritics 2');
                INSERT INTO search(rowid, title, body, tags, files) SELECT e.id, e.title, e.draft_text,
                  COALESCE((SELECT group_concat(t.name, ' ') FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = e.id), ''),
                  COALESCE((SELECT group_concat(a.name, ' ') FROM entry_file f JOIN attachment a ON a.sha256 = f.sha256 WHERE f.entry_id = e.id), '')
                FROM entry e;
                """)
            }
            if v < 6 {
                // Registry: Typen mit Feldern, Objekte mit fortlaufender Nummer je Typ, Verlauf, Verweise aus Einträgen
                try exec("""
                CREATE TABLE rtype(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, prefix TEXT NOT NULL UNIQUE COLLATE NOCASE,
                  icon TEXT NOT NULL DEFAULT '', fields_json TEXT NOT NULL, next_no INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
                CREATE TABLE entity(id INTEGER PRIMARY KEY, type_id INTEGER NOT NULL REFERENCES rtype(id), no INTEGER NOT NULL, name TEXT NOT NULL,
                  fields_json TEXT NOT NULL DEFAULT '{}', created TEXT NOT NULL, updated TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(type_id, no));
                CREATE TABLE entity_history(id INTEGER PRIMARY KEY, entity_id INTEGER NOT NULL REFERENCES entity(id), changed TEXT NOT NULL,
                  name TEXT NOT NULL, fields_json TEXT NOT NULL, author TEXT NOT NULL DEFAULT '');
                CREATE TRIGGER entity_history_ro_u BEFORE UPDATE ON entity_history BEGIN SELECT RAISE(ABORT, 'Verlauf ist unveränderlich'); END;
                CREATE TRIGGER entity_history_ro_d BEFORE DELETE ON entity_history BEGIN SELECT RAISE(ABORT, 'Verlauf ist unveränderlich'); END;
                CREATE TABLE entry_entity(entry_id INTEGER NOT NULL REFERENCES entry(id), entity_id INTEGER NOT NULL REFERENCES entity(id), PRIMARY KEY(entry_id, entity_id));
                CREATE INDEX entry_entity_e ON entry_entity(entity_id);
                CREATE VIRTUAL TABLE entity_search USING fts5(code, name, fields, tokenize='unicode61 remove_diacritics 2');
                """)
                for (name, prefix, icon, fields) in Store.defaultTypes {
                    let json = String(data: try JSONSerialization.data(withJSONObject: fields), encoding: .utf8)!
                    try query("INSERT INTO rtype(name, prefix, icon, fields_json, created) VALUES(?, ?, ?, ?, ?)", [name, prefix, icon, json, Store.now()])
                }
            }
            if v < 7 {
                // Papierkorb: gelöschte Einträge bleiben bis zum endgültigen Löschen erhalten.
                // Revisionen lassen sich nur löschen, wenn der Eintrag im Papierkorb liegt und nicht signiert ist.
                try exec("""
                ALTER TABLE entry ADD COLUMN deleted TEXT;
                DROP TRIGGER IF EXISTS revision_readonly_d;
                CREATE TRIGGER revision_readonly_d BEFORE DELETE ON revision
                  WHEN (SELECT deleted FROM entry WHERE id = OLD.entry_id) IS NULL OR (SELECT signed_no FROM entry WHERE id = OLD.entry_id) IS NOT NULL
                  BEGIN SELECT RAISE(ABORT, 'Revisionen sind unveränderlich'); END;
                """)
            }
            if v < 8 {
                // Bestand: Standorte (Baum, Boxen mit Raster), Chargen, unveränderliche Bewegungen
                try exec("""
                CREATE TABLE location(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES location(id), name TEXT NOT NULL,
                  kind TEXT NOT NULL DEFAULT 'ort', rows INTEGER, cols INTEGER, temp TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE lot(id INTEGER PRIMARY KEY, entity_id INTEGER REFERENCES entity(id), name TEXT NOT NULL, lot_no TEXT NOT NULL DEFAULT '',
                  amount REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL, min_amount REAL, expiry TEXT, location_id INTEGER REFERENCES location(id), position TEXT,
                  ghs TEXT NOT NULL DEFAULT '', sds_url TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '', catalog TEXT NOT NULL DEFAULT '',
                  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE INDEX lot_entity ON lot(entity_id);
                CREATE UNIQUE INDEX lot_position ON lot(location_id, position) WHERE position IS NOT NULL AND status = 'active';
                CREATE TABLE lot_move(id INTEGER PRIMARY KEY, lot_id INTEGER NOT NULL REFERENCES lot(id), at TEXT NOT NULL, delta REAL NOT NULL,
                  amount_after REAL NOT NULL, kind TEXT NOT NULL, entry_id INTEGER REFERENCES entry(id), note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '');
                CREATE INDEX lot_move_entry ON lot_move(entry_id);
                CREATE TRIGGER lot_move_ro_u BEFORE UPDATE ON lot_move BEGIN SELECT RAISE(ABORT, 'Bewegungen sind unveränderlich'); END;
                CREATE TRIGGER lot_move_ro_d BEFORE DELETE ON lot_move BEGIN SELECT RAISE(ABORT, 'Bewegungen sind unveränderlich'); END;
                """)
            }
            if v < 9 {
                // Strukturierte Ergebnisse: Vorlagen und je Eintrag ein Abbild der Ergebniszeilen
                try exec("""
                CREATE TABLE result_schema(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, fields_json TEXT NOT NULL,
                  created TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE result_row(entry_id INTEGER NOT NULL REFERENCES entry(id), schema_id INTEGER NOT NULL REFERENCES result_schema(id),
                  row_no INTEGER NOT NULL, values_json TEXT NOT NULL, PRIMARY KEY(entry_id, row_no));
                CREATE INDEX result_row_schema ON result_row(schema_id);
                """)
                for (name, fields) in Store.defaultResultSchemas {
                    let json = String(data: try JSONSerialization.data(withJSONObject: fields), encoding: .utf8)!
                    try query("INSERT INTO result_schema(name, fields_json, created) VALUES(?, ?, ?)", [name, json, Store.now()])
                }
            }
            if v < 10 {
                // Zellkultur (Kulturen mit unveränderlichen Ereignissen: Passage, Mycoplasma-Test, Einfrieren …) und Gerätebuch (Aufgaben mit Intervall, Protokoll)
                try exec("""
                CREATE TABLE culture(id INTEGER PRIMARY KEY, entity_id INTEGER REFERENCES entity(id), name TEXT NOT NULL, passage INTEGER NOT NULL DEFAULT 0,
                  vessel TEXT NOT NULL DEFAULT '', medium TEXT NOT NULL DEFAULT '', max_passage INTEGER, myco_days INTEGER NOT NULL DEFAULT 90,
                  source_lot INTEGER REFERENCES lot(id), status TEXT NOT NULL DEFAULT 'active', note TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE culture_event(id INTEGER PRIMARY KEY, culture_id INTEGER NOT NULL REFERENCES culture(id), at TEXT NOT NULL, day TEXT NOT NULL,
                  kind TEXT NOT NULL, passage INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '', lot_id INTEGER REFERENCES lot(id),
                  entry_id INTEGER REFERENCES entry(id), note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '');
                CREATE INDEX culture_event_c ON culture_event(culture_id);
                CREATE INDEX culture_event_entry ON culture_event(entry_id);
                CREATE INDEX culture_event_lot ON culture_event(lot_id);
                CREATE TRIGGER culture_event_ro_u BEFORE UPDATE ON culture_event BEGIN SELECT RAISE(ABORT, 'Kulturereignisse sind unveränderlich'); END;
                CREATE TRIGGER culture_event_ro_d BEFORE DELETE ON culture_event BEGIN SELECT RAISE(ABORT, 'Kulturereignisse sind unveränderlich'); END;
                CREATE TABLE device(id INTEGER PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', serial TEXT NOT NULL DEFAULT '',
                  location_id INTEGER REFERENCES location(id), status TEXT NOT NULL DEFAULT 'ok', note TEXT NOT NULL DEFAULT '',
                  archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE device_task(id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES device(id), kind TEXT NOT NULL, title TEXT NOT NULL,
                  interval_days INTEGER NOT NULL, next_due TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
                CREATE INDEX device_task_d ON device_task(device_id);
                CREATE TABLE device_log(id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES device(id), task_id INTEGER REFERENCES device_task(id),
                  at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, result TEXT NOT NULL DEFAULT 'ok', note TEXT NOT NULL DEFAULT '',
                  entry_id INTEGER REFERENCES entry(id), author TEXT NOT NULL DEFAULT '');
                CREATE INDEX device_log_d ON device_log(device_id);
                CREATE TRIGGER device_log_ro_u BEFORE UPDATE ON device_log BEGIN SELECT RAISE(ABORT, 'Geräteprotokoll ist unveränderlich'); END;
                CREATE TRIGGER device_log_ro_d BEFORE DELETE ON device_log BEGIN SELECT RAISE(ABORT, 'Geräteprotokoll ist unveränderlich'); END;
                """)
            }
            if v < 11 {
                // Bestellungen: aus knappen Chargen oder frei; Statusverlauf unveränderlich; Wareneingang legt eine neue Charge an
                try exec("""
                CREATE TABLE purchase(id INTEGER PRIMARY KEY, lot_id INTEGER REFERENCES lot(id), entity_id INTEGER REFERENCES entity(id), name TEXT NOT NULL,
                  amount REAL, unit TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL DEFAULT 1, supplier TEXT NOT NULL DEFAULT '', catalog TEXT NOT NULL DEFAULT '',
                  price TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'offen', new_lot INTEGER REFERENCES lot(id),
                  created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE INDEX purchase_status ON purchase(status);
                CREATE TABLE purchase_log(id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchase(id), at TEXT NOT NULL, status TEXT NOT NULL,
                  note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '');
                CREATE TRIGGER purchase_log_ro_u BEFORE UPDATE ON purchase_log BEGIN SELECT RAISE(ABORT, 'Bestellverlauf ist unveränderlich'); END;
                CREATE TRIGGER purchase_log_ro_d BEFORE DELETE ON purchase_log BEGIN SELECT RAISE(ABORT, 'Bestellverlauf ist unveränderlich'); END;
                """)
            }
            if v < 12 {
                // Sequenz-Anmerkungen je Registry-Objekt und Sequenzfeld: Ring/linear, Features; seq_sha erkennt, wenn die Sequenz danach geändert wurde
                try exec("""
                CREATE TABLE seq_annot(entity_id INTEGER NOT NULL REFERENCES entity(id), field TEXT NOT NULL, circular INTEGER NOT NULL DEFAULT 0,
                  features_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '', seq_sha TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(entity_id, field));
                """)
            }
            try exec("PRAGMA user_version = \(Store.schemaVersion)")
        }
    }

    var name: String { root.deletingPathExtension().lastPathComponent }

    /// Feste ID des Buches (aus meta.json), damit Sicherungen auch nach Umbenennen zugeordnet bleiben
    var bookID: String {
        ((try? JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("meta.json")))) as? [String: Any])?["id"] as? String ?? name
    }

    /// Konsistente Kopie der Datenbank (auch während die App läuft)
    func backupDB(to url: URL) throws { try query("VACUUM INTO ?", [url.path]) }

    deinit { sqlite3_close(db) }

    static func now() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }

    static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    // MARK: SQLite-Helfer
    private func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let m = err.map { String(cString: $0) } ?? "SQL-Fehler"
            sqlite3_free(err)
            throw StoreError.sqlite(m)
        }
    }

    @discardableResult
    private func query(_ sql: String, _ args: [Any?] = []) throws -> [[String: Any]] {
        var st: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK else { throw StoreError.sqlite(String(cString: sqlite3_errmsg(db))) }
        defer { sqlite3_finalize(st) }
        for (i, a) in args.enumerated() {
            let idx = Int32(i + 1)
            switch a {
            case let v as Int: sqlite3_bind_int64(st, idx, Int64(v))
            case let v as Int64: sqlite3_bind_int64(st, idx, v)
            case let v as Double: sqlite3_bind_double(st, idx, v)
            case let v as String: sqlite3_bind_text(st, idx, v, -1, TRANSIENT)
            default: sqlite3_bind_null(st, idx)
            }
        }
        var rows: [[String: Any]] = []
        while true {
            let rc = sqlite3_step(st)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw StoreError.sqlite(String(cString: sqlite3_errmsg(db))) }
            var row: [String: Any] = [:]
            for c in 0..<sqlite3_column_count(st) {
                let name = String(cString: sqlite3_column_name(st, c))
                switch sqlite3_column_type(st, c) {
                case SQLITE_INTEGER: row[name] = Int(sqlite3_column_int64(st, c))
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(st, c)
                case SQLITE_NULL: row[name] = NSNull()
                default: row[name] = String(cString: sqlite3_column_text(st, c))
                }
            }
            rows.append(row)
        }
        return rows
    }

    private func transaction<T>(_ body: () throws -> T) throws -> T {
        let sp = "sp\(txDepth)", outer = txDepth == 0
        try exec(outer ? "BEGIN IMMEDIATE" : "SAVEPOINT \(sp)")
        txDepth += 1
        defer { txDepth -= 1 }
        do { let r = try body(); try exec(outer ? "COMMIT" : "RELEASE \(sp)"); return r }
        catch { try? exec(outer ? "ROLLBACK" : "ROLLBACK TO \(sp); RELEASE \(sp)"); throw error }
    }

    // MARK: Projekte
    func projects() throws -> [[String: Any]] {
        try query("""
        SELECT p.id, p.name, p.color, p.archived, (SELECT COUNT(*) FROM entry e WHERE e.project_id = p.id AND e.deleted IS NULL) AS entries
        FROM project p ORDER BY p.archived, p.name COLLATE NOCASE
        """)
    }

    func createProject(name: String) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw StoreError.invalid("Projektname fehlt") }
        try query("INSERT INTO project(name, created) VALUES(?, ?)", [n, Store.now()])
        return Int(sqlite3_last_insert_rowid(db))
    }

    func updateProject(id: Int, name: String?, archived: Bool?) throws {
        if let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) {
            guard !n.isEmpty else { throw StoreError.invalid("Projektname fehlt") }
            try query("UPDATE project SET name = ? WHERE id = ?", [n, id])
        }
        if let a = archived { try query("UPDATE project SET archived = ? WHERE id = ?", [a ? 1 : 0, id]) }
    }

    private func checkProject(_ p: Int?) throws {
        if let p = p, try query("SELECT 1 FROM project WHERE id = ?", [p]).isEmpty { throw StoreError.invalid("Projekt \(p) gibt es nicht") }
    }

    // MARK: Einträge
    /// project: nil = alle, 0 = ohne Projekt, sonst Projekt-ID; tag: nur Einträge mit diesem Tag
    func list(project: Int? = nil, tag: Int? = nil) throws -> [[String: Any]] {
        var conds: [String] = ["e.deleted IS NULL"], args: [Any?] = []
        if let p = project { if p == 0 { conds.append("e.project_id IS NULL") } else { conds.append("e.project_id = ?"); args.append(p) } }
        if let t = tag { conds.append("e.id IN (SELECT entry_id FROM entry_tag WHERE tag_id = ?)"); args.append(t) }
        return try query("""
        SELECT e.id, e.title, e.updated, e.kind, e.project_id, (SELECT COUNT(*) FROM revision r WHERE r.entry_id = e.id) AS revisions,
          (SELECT group_concat(name, ', ') FROM (SELECT t.name FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = e.id ORDER BY t.name COLLATE NOCASE)) AS tags
        FROM entry e \(conds.isEmpty ? "" : "WHERE " + conds.joined(separator: " AND ")) ORDER BY e.updated DESC
        """, args)
    }

    // MARK: Tags
    func tags() throws -> [[String: Any]] {
        try query("SELECT t.id, t.name, COUNT(et.entry_id) AS entries FROM tag t JOIN entry_tag et ON et.tag_id = t.id JOIN entry e ON e.id = et.entry_id AND e.deleted IS NULL GROUP BY t.id ORDER BY t.name COLLATE NOCASE")
    }

    static func cleanTag(_ s: String) -> String? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix("#") { t.removeFirst() }
        t = String(t.prefix(40)).trimmingCharacters(in: .whitespaces)
        return t.isEmpty || t.contains(",") ? nil : t
    }

    /// Ersetzt die Tags eines Eintrags; neue Tags werden angelegt, ungenutzte gelöscht.
    func setTags(id: Int, names: [String]) throws -> [String] {
        var seen = Set<String>(), clean: [String] = []
        for n in names.compactMap(Store.cleanTag) where seen.insert(n.lowercased()).inserted { clean.append(n) }
        try transaction {
            guard try !query("SELECT 1 FROM entry WHERE id = ?", [id]).isEmpty else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
            try query("DELETE FROM entry_tag WHERE entry_id = ?", [id])
            for n in clean {
                try query("INSERT OR IGNORE INTO tag(name) VALUES(?)", [n])
                try query("INSERT INTO entry_tag(entry_id, tag_id) SELECT ?, id FROM tag WHERE name = ?", [id, n])
            }
            try query("DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM entry_tag)")
            try query("UPDATE search SET tags = ? WHERE rowid = ?", [clean.joined(separator: " "), id])
        }
        return try entryTags(id)
    }

    func entryTags(_ id: Int) throws -> [String] {
        try query("SELECT t.name FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY t.name COLLATE NOCASE", [id])
            .compactMap { $0["name"] as? String }
    }

    // MARK: Vorlagen
    func templates() throws -> [[String: Any]] {
        try query("""
        SELECT t.id, t.name, t.archived, v.version, v.title, v.kind, v.created AS updated
        FROM template t JOIN template_version v ON v.template_id = t.id
        WHERE v.version = (SELECT MAX(version) FROM template_version WHERE template_id = t.id)
        ORDER BY t.archived, t.name COLLATE NOCASE
        """)
    }

    /// Aktuellen Stand eines Eintrags als Vorlage speichern. Gibt es den Namen schon, entsteht eine neue Version;
    /// ist der Inhalt gleich der letzten Version, bleibt alles wie es ist.
    func saveTemplate(name: String, fromEntry id: Int) throws -> [String: Any] {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw StoreError.invalid("Name der Vorlage fehlt") }
        return try transaction {
            guard let e = try query("SELECT title, kind, draft_json FROM entry WHERE id = ?", [id]).first,
                  let json = e["draft_json"] as? String, !json.isEmpty else { throw StoreError.invalid("Der Eintrag ist leer") }
            var tid = try query("SELECT id FROM template WHERE name = ?", [n]).first?["id"] as? Int
            if tid == nil {
                try query("INSERT INTO template(name, created) VALUES(?, ?)", [n, Store.now()])
                tid = Int(sqlite3_last_insert_rowid(db))
            }
            let last = try query("SELECT version, title, kind, content_json FROM template_version WHERE template_id = ? ORDER BY version DESC LIMIT 1", [tid!]).first
            if let l = last, l["content_json"] as? String == json, l["title"] as? String == e["title"] as? String, l["kind"] as? String == e["kind"] as? String {
                return ["id": tid!, "version": l["version"]!, "unchanged": true]
            }
            let ver = (last?["version"] as? Int ?? 0) + 1
            try query("INSERT INTO template_version(template_id, version, title, kind, content_json, created, source_entry) VALUES(?,?,?,?,?,?,?)",
                      [tid!, ver, e["title"], e["kind"], json, Store.now(), id])
            try query("UPDATE template SET archived = 0 WHERE id = ?", [tid!])
            return ["id": tid!, "version": ver, "unchanged": false]
        }
    }

    func templateVersions(id: Int) throws -> [[String: Any]] {
        try query("SELECT version, title, created, source_entry FROM template_version WHERE template_id = ? ORDER BY version DESC", [id])
    }

    func archiveTemplate(id: Int, archived: Bool) throws {
        try query("UPDATE template SET archived = ? WHERE id = ?", [archived ? 1 : 0, id])
    }

    /// Neuer Eintrag aus einer Vorlage (neueste Version, wenn keine angegeben). Vorlage und Version werden am Eintrag vermerkt.
    func createFromTemplate(id: Int, version: Int?, project: Int?) throws -> Int {
        let v = try query("""
        SELECT version, title, kind, content_json FROM template_version WHERE template_id = ? \(version == nil ? "" : "AND version = ?")
        ORDER BY version DESC LIMIT 1
        """, version == nil ? [id] : [id, version!]).first
        guard let tv = v else { throw StoreError.invalid("Vorlage gibt es nicht") }
        let eid = try create(title: tv["title"] as? String ?? "", project: project, kind: tv["kind"] as? String ?? "experiment")
        try query("UPDATE entry SET draft_json = ?, template_id = ?, template_version = ? WHERE id = ?", [tv["content_json"], id, tv["version"], eid])
        return eid
    }

    // MARK: Läufe
    /// Startet einen Lauf mit den Schritten (Text je Schritt) oder liefert den schon laufenden.
    func startRun(entry id: Int, steps: [String]) throws -> Int {
        guard !steps.isEmpty else { throw StoreError.invalid("Keine Schritte gefunden") }
        if let r = try query("SELECT id FROM run WHERE entry_id = ? AND status = 'running'", [id]).first?["id"] as? Int { return r }
        guard try !query("SELECT 1 FROM entry WHERE id = ?", [id]).isEmpty else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        let json = String(data: try JSONSerialization.data(withJSONObject: steps), encoding: .utf8)!
        try query("INSERT INTO run(entry_id, started, steps_json) VALUES(?, ?, ?)", [id, Store.now(), json])
        return Int(sqlite3_last_insert_rowid(db))
    }

    /// Laufender Lauf eines Eintrags mit erledigten Schritten, oder nil
    func activeRun(entry id: Int) throws -> [String: Any]? {
        guard var r = try query("SELECT id, started, steps_json FROM run WHERE entry_id = ? AND status = 'running'", [id]).first else { return nil }
        r["done"] = try query("SELECT step_no, done_at, note FROM run_step WHERE run_id = ? ORDER BY step_no", [r["id"]!])
        return r
    }

    /// Schritt als erledigt vermerken (einmalig; der erste Zeitstempel zählt)
    func completeStep(run: Int, step: Int, note: String) throws -> [String: Any] {
        guard let r = try query("SELECT steps_json, status FROM run WHERE id = ?", [run]).first else { throw StoreError.invalid("Lauf gibt es nicht") }
        guard r["status"] as? String == "running" else { throw StoreError.invalid("Der Lauf ist schon beendet") }
        let count = (try JSONSerialization.jsonObject(with: Data((r["steps_json"] as! String).utf8)) as? [Any])?.count ?? 0
        guard step >= 1, step <= count else { throw StoreError.invalid("Schritt \(step) gibt es nicht") }
        try query("INSERT OR IGNORE INTO run_step(run_id, step_no, done_at, note) VALUES(?, ?, ?, ?)", [run, step, Store.now(), note])
        return try query("SELECT step_no, done_at, note FROM run_step WHERE run_id = ? AND step_no = ?", [run, step]).first!
    }

    func finishRun(run: Int, aborted: Bool) throws -> [String: Any] {
        try query("UPDATE run SET status = ?, finished = ? WHERE id = ? AND status = 'running'", [aborted ? "aborted" : "done", Store.now(), run])
        guard var r = try query("SELECT id, entry_id, started, finished, status, steps_json FROM run WHERE id = ?", [run]).first else { throw StoreError.invalid("Lauf gibt es nicht") }
        r["done"] = try query("SELECT step_no, done_at, note FROM run_step WHERE run_id = ? ORDER BY step_no", [run])
        return r
    }

    // MARK: Verweise
    /// Einträge, die auf diesen Eintrag verweisen
    func backlinks(id: Int) throws -> [[String: Any]] {
        try query("SELECT e.id, e.title, e.kind FROM link l JOIN entry e ON e.id = l.from_entry WHERE l.to_entry = ? AND e.deleted IS NULL ORDER BY e.updated DESC", [id])
    }

    /// Titel aller Einträge, damit Verweise im Text den aktuellen Titel zeigen
    func titles() throws -> [[String: Any]] { try query("SELECT id, title FROM entry") }

    func create(title: String, project: Int? = nil, kind: String = "experiment") throws -> Int {
        guard Store.kinds.contains(kind) else { throw StoreError.invalid("Unbekannte Art: \(kind)") }
        try checkProject(project)
        let t = Store.now()
        return try transaction {
            try query("INSERT INTO entry(title, created, updated, project_id, kind) VALUES(?, ?, ?, ?, ?)", [title, t, t, project, kind])
            let id = Int(sqlite3_last_insert_rowid(db))
            try query("INSERT INTO search(rowid, title, body, tags, files) VALUES(?, ?, '', '', '')", [id, title])
            return id
        }
    }

    /// Projekt und Art eines Eintrags ändern (nicht Teil der Revision, nur Ordnung). project 0 = ohne Projekt.
    func setMeta(id: Int, project: Int?, kind: String?) throws {
        if let p = project {
            try checkProject(p == 0 ? nil : p)
            try query("UPDATE entry SET project_id = ? WHERE id = ?", [p == 0 ? nil : p, id])
        }
        if let k = kind {
            guard Store.kinds.contains(k) else { throw StoreError.invalid("Unbekannte Art: \(k)") }
            try query("UPDATE entry SET kind = ? WHERE id = ?", [k, id])
        }
    }

    func load(id: Int) throws -> [String: Any] {
        guard var e = try query("SELECT id, title, created, updated, draft_json, kind, project_id, template_id, template_version, signed_no, deleted FROM entry WHERE id = ?", [id]).first else {
            throw StoreError.invalid("Eintrag \(id) gibt es nicht")
        }
        e["tags"] = try entryTags(id)
        return e
    }

    func revision(id: Int, no: Int) throws -> [String: Any] {
        guard let r = try query("SELECT no, title, content_json, created, hash FROM revision WHERE entry_id = ? AND no = ?", [id, no]).first else {
            throw StoreError.invalid("Revision \(no) gibt es nicht")
        }
        return r
    }

    /// Arbeitsstand speichern (wird beim Tippen laufend überschrieben). Unveränderliche Revisionen entstehen erst mit snapshot().
    /// links/files: Verweise und Dateien, die im Text vorkommen (vom Editor ermittelt); Unbekanntes wird ignoriert.
    func saveDraft(id: Int, title: String, json: String, text: String, links: [Int] = [], files: [String] = [], entities: [Int] = [], results: [[String: Any]] = []) throws -> [String: Any] {
        if try isTrashed(id) { throw StoreError.invalid("Der Eintrag liegt im Papierkorb. Erst wiederherstellen.") }
        if try isSigned(id) { throw StoreError.invalid("Der Eintrag ist abgeschlossen und signiert. Änderungen bitte als Nachtrag.") }
        let t = Store.now()
        try transaction {
            try query("UPDATE entry SET title = ?, draft_json = ?, draft_text = ?, updated = ? WHERE id = ?", [title, json, text, t, id])
            try query("UPDATE search SET title = ?, body = ? WHERE rowid = ?", [title, text, id])
            try query("DELETE FROM link WHERE from_entry = ?", [id])
            for to in Set(links) where to != id {
                try query("INSERT INTO link(from_entry, to_entry) SELECT ?, id FROM entry WHERE id = ?", [id, to])
            }
            try query("DELETE FROM entry_file WHERE entry_id = ?", [id])
            for sha in Set(files) {
                try query("INSERT INTO entry_file(entry_id, sha256) SELECT ?, sha256 FROM attachment WHERE sha256 = ?", [id, sha])
            }
            try refreshFileText(entry: id)
            try setEntryEntities(entry: id, entities)
            try setEntryResults(entry: id, results)
        }
        return ["updated": t]
    }

    /// Neue Revision anfügen, wenn sich der Arbeitsstand seit der letzten Revision geändert hat.
    @discardableResult
    func snapshot(id: Int) throws -> [String: Any]? {
        try transaction {
            guard let e = try query("SELECT title, draft_json FROM entry WHERE id = ?", [id]).first,
                  let json = e["draft_json"] as? String, let title = e["title"] as? String, !json.isEmpty else { return nil }
            let last = try query("SELECT no, title, content_json, hash FROM revision WHERE entry_id = ? ORDER BY no DESC LIMIT 1", [id]).first
            if let l = last, l["content_json"] as? String == json, l["title"] as? String == title { return nil }
            let no = (last?["no"] as? Int ?? 0) + 1
            let prev = last?["hash"] as? String ?? String(repeating: "0", count: 64)
            let created = Store.now()
            let hash = Store.revisionHash(prev: prev, entry: id, no: no, created: created, title: title, json: json)
            try query("INSERT INTO revision(entry_id, no, title, content_json, created, prev_hash, hash) VALUES(?,?,?,?,?,?,?)",
                      [id, no, title, json, created, prev, hash])
            return ["no": no, "hash": hash, "created": created]
        }
    }

    func snapshotAll() throws { for e in try query("SELECT id FROM entry") { try snapshot(id: e["id"] as! Int) } }

    static func revisionHash(prev: String, entry: Int, no: Int, created: String, title: String, json: String) -> String {
        sha256(Data([prev, String(entry), String(no), created, title, json].joined(separator: "\n").utf8))
    }

    func history(id: Int) throws -> [[String: Any]] {
        try query("SELECT no, title, created, hash FROM revision WHERE entry_id = ? ORDER BY no DESC", [id])
    }

    /// Prüft die Hash-Kette aller Revisionen und alle Signaturen eines Eintrags.
    /// ok = Kette intakt und jede Autor-Signatur gültig; broken = erste fehlerhafte Revision.
    func verify(id: Int) throws -> [String: Any] {
        var prev = String(repeating: "0", count: 64), hashes: [Int: String] = [:], broken: Int?
        let revs = try query("SELECT no, title, content_json, created, prev_hash, hash FROM revision WHERE entry_id = ? ORDER BY no", [id])
        for r in revs {
            let no = r["no"] as! Int
            let h = Store.revisionHash(prev: prev, entry: id, no: no, created: r["created"] as! String,
                                       title: r["title"] as! String, json: r["content_json"] as! String)
            if r["prev_hash"] as? String != prev || r["hash"] as? String != h { broken = no; break }
            hashes[no] = h
            prev = h
        }
        var sigs: [[String: Any]] = [], allValid = true
        for s in try query("SELECT rev_no, kind, name, signed_at, pubkey, sig, file_sha256, hash_found FROM signature WHERE entry_id = ? ORDER BY id", [id]) {
            var out = s
            let no = s["rev_no"] as! Int
            if s["kind"] as? String == "author" {
                var valid = false
                if let h = hashes[no], let pk = Store.unhex(s["pubkey"] as? String ?? ""), let sig = Store.unhex(s["sig"] as? String ?? ""),
                   let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pk) {
                    valid = key.isValidSignature(sig, for: Store.signaturePayload(entry: id, no: no, hash: h, name: s["name"] as! String, at: s["signed_at"] as! String))
                }
                out["valid"] = valid
                out["fingerprint"] = Store.fingerprint(s["pubkey"] as? String ?? "")
                allValid = allValid && valid
            }
            out["sig"] = nil
            sigs.append(out)
        }
        var r: [String: Any] = ["ok": broken == nil && allValid, "chain_ok": broken == nil, "count": revs.count, "signatures": sigs]
        if let b = broken { r["broken"] = b }
        return r
    }

    // MARK: Papierkorb
    func isTrashed(_ id: Int) throws -> Bool { try !query("SELECT 1 FROM entry WHERE id = ? AND deleted IS NOT NULL", [id]).isEmpty }

    /// In den Papierkorb legen. Signierte Einträge bleiben (Nachweis), ebenso solche mit laufendem Lauf.
    func trashEntry(id: Int) throws {
        guard try !query("SELECT 1 FROM entry WHERE id = ?", [id]).isEmpty else { throw StoreError.invalid("Eintrag \(id) gibt es nicht") }
        if try isSigned(id) { throw StoreError.invalid("Signierte Einträge lassen sich nicht löschen. Änderungen bitte als Nachtrag.") }
        if try !query("SELECT 1 FROM run WHERE entry_id = ? AND status = 'running'", [id]).isEmpty { throw StoreError.invalid("Erst den laufenden Lauf beenden.") }
        try query("UPDATE entry SET deleted = ? WHERE id = ?", [Store.now(), id])
    }

    func restoreEntry(id: Int) throws { try query("UPDATE entry SET deleted = NULL WHERE id = ?", [id]) }

    func trash() throws -> [[String: Any]] {
        try query("SELECT id, title, kind, updated, deleted, (SELECT COUNT(*) FROM revision r WHERE r.entry_id = entry.id) AS revisions FROM entry WHERE deleted IS NOT NULL ORDER BY deleted DESC")
    }

    /// Endgültig löschen: nur aus dem Papierkorb und nur unsignierte Einträge. Anhänge bleiben im Buch (sie können mehrfach genutzt sein).
    func purgeEntry(id: Int) throws {
        guard try isTrashed(id) else { throw StoreError.invalid("Nur Einträge aus dem Papierkorb lassen sich endgültig löschen") }
        if try isSigned(id) { throw StoreError.invalid("Signierte Einträge lassen sich nicht löschen") }
        if try hasBookings(id) { throw StoreError.invalid("Auf diesen Eintrag verweisen Buchungen (Bestand, Zellkultur oder Gerätebuch); er bleibt deshalb im Papierkorb.") }
        try transaction {
            for t in ["revision", "entry_file", "entry_tag", "entry_entity", "result_row"] { try query("DELETE FROM \(t) WHERE entry_id = ?", [id]) }
            try query("DELETE FROM link WHERE from_entry = ? OR to_entry = ?", [id, id])
            try query("DELETE FROM run_step WHERE run_id IN (SELECT id FROM run WHERE entry_id = ?)", [id])
            try query("DELETE FROM run WHERE entry_id = ?", [id])
            try query("DELETE FROM search WHERE rowid = ?", [id])
            try query("DELETE FROM entry WHERE id = ?", [id])
            try query("DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM entry_tag)")
        }
    }

    /// Unveränderliche Buchungen, die auf den Eintrag verweisen, verhindern das endgültige Löschen
    func hasBookings(_ id: Int) throws -> Bool {
        try !query("SELECT 1 FROM lot_move WHERE entry_id = ?1 UNION ALL SELECT 1 FROM culture_event WHERE entry_id = ?1 UNION ALL SELECT 1 FROM device_log WHERE entry_id = ?1 LIMIT 1", [id]).isEmpty
    }

    @discardableResult
    func emptyTrash() throws -> Int {
        let ids = try query("SELECT id FROM entry WHERE deleted IS NOT NULL AND signed_no IS NULL").compactMap { $0["id"] as? Int }.filter { try !hasBookings($0) }
        for i in ids { try purgeEntry(id: i) }
        return ids.count
    }

    // MARK: Helfer für Erweiterungen in anderen Dateien
    @discardableResult
    func queryRows(_ sql: String, _ args: [Any?] = []) throws -> [[String: Any]] { try query(sql, args) }
    func transactionRun<T>(_ body: () throws -> T) throws -> T { try transaction(body) }
    func lastID() -> Int { Int(sqlite3_last_insert_rowid(db)) }

    // MARK: Spotlight
    func spotlightRows(id: Int? = nil) throws -> [[String: Any]] {
        try query("""
        SELECT e.id, e.title, e.draft_text, e.updated,
          (SELECT group_concat(t.name, ', ') FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = e.id) AS tags
        FROM entry e WHERE e.deleted IS NULL \(id == nil ? "" : "AND e.id = ?")
        """, id.map { [$0] } ?? [])
    }

    // MARK: Export
    /// Alles außer den Dateiinhalten, als JSON-taugliche Struktur (für data/book.json und den Export der Oberfläche)
    func dump() throws -> [String: Any] {
        let meta = (try? JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("meta.json")))) ?? [:]
        return [
            "format": "laborbuch-export-1", "exported": Store.now(), "book": name, "meta": meta, "schema": Store.schemaVersion,
            "projects": try query("SELECT id, name, archived, created FROM project ORDER BY id"),
            "entries": try query("""
            SELECT e.id, e.title, e.kind, e.created, e.updated, e.project_id, p.name AS project, e.template_id, e.template_version, e.signed_no,
              e.draft_json, e.draft_text,
              (SELECT group_concat(t.name, ', ') FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = e.id) AS tags,
              (SELECT hash FROM revision r WHERE r.entry_id = e.id ORDER BY no DESC LIMIT 1) AS last_hash,
              (SELECT COUNT(*) FROM revision r WHERE r.entry_id = e.id) AS revisions
            FROM entry e LEFT JOIN project p ON p.id = e.project_id ORDER BY e.id
            """),
            "revisions": try query("SELECT entry_id, no, title, created, prev_hash, hash, content_json FROM revision ORDER BY entry_id, no"),
            "signatures": try query("SELECT entry_id, rev_no, kind, name, signed_at, pubkey, sig, file_sha256, hash_found FROM signature ORDER BY id"),
            "signers": try query("SELECT pubkey, name, created FROM signer"),
            "links": try query("SELECT from_entry, to_entry FROM link"),
            "attachments": try query("SELECT sha256, name, mime, size, created, stored, path, ocr_text FROM attachment ORDER BY created"),
            "entry_files": try query("SELECT entry_id, sha256 FROM entry_file"),
            "templates": try query("SELECT t.id, t.name, t.archived, v.version, v.title, v.kind, v.created, v.content_json FROM template t JOIN template_version v ON v.template_id = t.id ORDER BY t.id, v.version"),
            "runs": try query("SELECT id, entry_id, started, finished, status, steps_json FROM run ORDER BY id"),
            "run_steps": try query("SELECT run_id, step_no, done_at, note FROM run_step ORDER BY run_id, step_no"),
            "registry_types": try query("SELECT id, name, prefix, icon, fields_json, archived FROM rtype ORDER BY id"),
            "registry": try query("SELECT e.id, t.prefix || '-' || substr('0000' || e.no, -4) AS code, e.type_id, e.name, e.fields_json, e.created, e.updated, e.archived FROM entity e JOIN rtype t ON t.id = e.type_id ORDER BY e.id"),
            "registry_history": try query("SELECT entity_id, changed, name, fields_json, author FROM entity_history ORDER BY id"),
            "entry_registry": try query("SELECT entry_id, entity_id FROM entry_entity"),
            "result_schemas": try query("SELECT id, name, fields_json FROM result_schema ORDER BY id"),
            "results": try query("SELECT entry_id, schema_id, row_no, values_json FROM result_row ORDER BY entry_id, row_no"),
            "locations": try query("SELECT id, parent_id, name, kind, rows, cols, temp, archived, created FROM location ORDER BY id"),
            "lots": try query("SELECT * FROM lot ORDER BY id"),
            "lot_moves": try query("SELECT * FROM lot_move ORDER BY id"),
            "cultures": try query("SELECT * FROM culture ORDER BY id"),
            "culture_events": try query("SELECT * FROM culture_event ORDER BY id"),
            "devices": try query("SELECT * FROM device ORDER BY id"),
            "device_tasks": try query("SELECT * FROM device_task ORDER BY id"),
            "device_log": try query("SELECT * FROM device_log ORDER BY id"),
            "purchases": try query("SELECT * FROM purchase ORDER BY id"),
            "purchase_log": try query("SELECT * FROM purchase_log ORDER BY id"),
            "sequence_annotations": try query("SELECT * FROM seq_annot ORDER BY entity_id, field"),
        ]
    }

    // MARK: Signaturen
    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
    static func unhex(_ s: String) -> Data? {
        guard s.count % 2 == 0, s.allSatisfy(\.isHexDigit) else { return nil }
        var d = Data(), i = s.startIndex
        while i < s.endIndex { let j = s.index(i, offsetBy: 2); d.append(UInt8(s[i..<j], radix: 16)!); i = j }
        return d
    }
    /// Kurzer, gut vergleichbarer Fingerabdruck eines öffentlichen Schlüssels
    static func fingerprint(_ pubkeyHex: String) -> String {
        let h = sha256(Data(pubkeyHex.utf8)).prefix(16).uppercased()
        return stride(from: 0, to: 16, by: 4).map { String(h.dropFirst($0).prefix(4)) }.joined(separator: "-")
    }
    /// Was signiert wird: Eintrag, Revision, ihr Hash, Name und Zeitpunkt – nichts davon lässt sich nachträglich ändern
    static func signaturePayload(entry: Int, no: Int, hash: String, name: String, at: String) -> Data {
        Data(["laborbuch-signatur-v1", String(entry), String(no), hash, name, at].joined(separator: "\n").utf8)
    }

    func isSigned(_ id: Int) throws -> Bool {
        try !(query("SELECT 1 FROM entry WHERE id = ? AND signed_no IS NOT NULL", [id]).isEmpty)
    }

    /// Eintrag abschließen: aktuellen Stand als Revision sichern, mit dem Schlüssel signieren, danach keine Änderungen mehr.
    func signEntry(id: Int, key: Curve25519.Signing.PrivateKey, name: String) throws -> [String: Any] {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw StoreError.invalid("Name für die Signatur fehlt (Einstellungen)") }
        if try isSigned(id) { throw StoreError.invalid("Der Eintrag ist schon signiert") }
        try snapshot(id: id)
        guard (try verify(id: id))["chain_ok"] as? Bool == true else { throw StoreError.invalid("Die Hash-Kette ist verletzt – nicht signierbar") }
        return try transaction {
            guard let last = try query("SELECT no, hash FROM revision WHERE entry_id = ? ORDER BY no DESC LIMIT 1", [id]).first,
                  let no = last["no"] as? Int, let hash = last["hash"] as? String else { throw StoreError.invalid("Der Eintrag ist leer") }
            let at = Store.now()
            let pub = Store.hex(key.publicKey.rawRepresentation)
            let sig = try key.signature(for: Store.signaturePayload(entry: id, no: no, hash: hash, name: n, at: at))
            try query("INSERT OR IGNORE INTO signer(pubkey, name, created) VALUES(?, ?, ?)", [pub, n, at])
            try query("INSERT INTO signature(entry_id, rev_no, kind, name, signed_at, pubkey, sig) VALUES(?, ?, 'author', ?, ?, ?, ?)",
                      [id, no, n, at, pub, Store.hex(sig)])
            try query("UPDATE entry SET signed_no = ? WHERE id = ?", [no, id])
            return ["no": no, "hash": hash, "signed_at": at, "fingerprint": Store.fingerprint(pub)]
        }
    }

    /// Hash der signierten Revision (für das Zeugen-PDF)
    func signedRevision(id: Int) throws -> [String: Any] {
        guard let r = try query("""
        SELECT r.no, r.hash, r.created, s.name, s.signed_at, s.pubkey FROM entry e JOIN revision r ON r.entry_id = e.id AND r.no = e.signed_no
        JOIN signature s ON s.entry_id = e.id AND s.rev_no = r.no AND s.kind = 'author' WHERE e.id = ?
        """, [id]).first else { throw StoreError.invalid("Der Eintrag ist nicht signiert") }
        var out = r
        out["fingerprint"] = Store.fingerprint(r["pubkey"] as? String ?? "")
        return out
    }

    /// Zeugen-Gegenzeichnung festhalten: unterschriebenes PDF liegt als Anhang vor; hash_found = Hash im PDF gefunden
    func addWitness(id: Int, name: String, file: String, hashFound: Bool) throws -> [String: Any] {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw StoreError.invalid("Name des Zeugen fehlt") }
        let rev = try signedRevision(id: id)
        guard try !query("SELECT 1 FROM attachment WHERE sha256 = ?", [file]).isEmpty else { throw StoreError.invalid("PDF fehlt im Laborbuch") }
        let at = Store.now()
        try query("INSERT INTO signature(entry_id, rev_no, kind, name, signed_at, file_sha256, hash_found) VALUES(?, ?, 'witness', ?, ?, ?, ?)",
                  [id, rev["no"], n, at, file, hashFound ? 1 : 0])
        return ["name": n, "signed_at": at, "hash_found": hashFound]
    }

    func search(_ q: String) throws -> [[String: Any]] {
        // Jedes Wort als Präfix suchen; Anführungszeichen entfernen, damit FTS-Syntax nicht stört
        let terms = q.split(whereSeparator: { $0.isWhitespace }).map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"*" }
        if terms.isEmpty { return [] }
        return try query("""
        SELECT e.id, e.title, e.updated, e.kind, e.project_id, snippet(search, -1, '[', ']', '…', 12) AS snippet,
          (SELECT group_concat(name, ', ') FROM (SELECT t.name FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE et.entry_id = e.id ORDER BY t.name COLLATE NOCASE)) AS tags
        FROM search JOIN entry e ON e.id = search.rowid WHERE search MATCH ? AND e.deleted IS NULL ORDER BY rank LIMIT 50
        """, [terms.joined(separator: " ")])
    }

    // MARK: Anhänge
    func putFile(name: String, mime: String, data: Data) throws -> String {
        let sha = Store.sha256(data)
        let url = fileURL(sha)
        if !FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }
        try query("INSERT OR IGNORE INTO attachment(sha256, name, mime, size, created) VALUES(?,?,?,?,?)",
                  [sha, name, mime, data.count, Store.now()])
        return sha
    }

    /// Suchtext der Dateien eines Eintrags: Dateinamen und erkannter Text
    private func refreshFileText(entry id: Int) throws {
        try query("""
        UPDATE search SET files = COALESCE((SELECT group_concat(a.name || ' ' || COALESCE(a.ocr_text, ''), ' ')
          FROM entry_file f JOIN attachment a ON a.sha256 = f.sha256 WHERE f.entry_id = ?), '') WHERE rowid = ?
        """, [id, id])
    }

    /// Anhänge, deren Text noch nicht erkannt wurde (Bilder und PDFs im Buch)
    func pendingOCR() throws -> [[String: Any]] {
        try query("SELECT sha256, mime FROM attachment WHERE ocr_text IS NULL AND stored = 'copy' AND (mime LIKE 'image/%' OR mime = 'application/pdf')")
    }

    /// Erkannten Text speichern und die Suche aller Einträge mit dieser Datei aktualisieren
    func setOCR(sha: String, text: String) throws {
        try transaction {
            try query("UPDATE attachment SET ocr_text = ? WHERE sha256 = ?", [text, sha])
            for e in try query("SELECT entry_id FROM entry_file WHERE sha256 = ?", [sha]) { try refreshFileText(entry: e["entry_id"] as! Int) }
        }
    }

    func ocrText(_ sha: String) throws -> String? { try query("SELECT ocr_text FROM attachment WHERE sha256 = ?", [sha]).first?["ocr_text"] as? String }

    // MARK: Verlinkte Rohdaten
    /// Prüfsumme einer großen Datei in Blöcken berechnen (ohne sie ganz in den Speicher zu laden)
    static func sha256(fileAt url: URL) throws -> String {
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        var hasher = SHA256()
        while let chunk = try h.read(upToCount: 8 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func fileStat(_ url: URL) -> (size: Int, mtime: Double)? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: url.path), let size = a[.size] as? Int,
              let m = a[.modificationDate] as? Date else { return nil }
        return (size, m.timeIntervalSince1970)
    }

    /// Datei am Ort lassen und nur verlinken (Pfad, Größe, Änderungszeit, Prüfsumme). sha: vorher berechnet (dauert bei großen Dateien)
    func linkFile(url: URL, sha: String, mime: String) throws -> [String: Any] {
        guard let st = Store.fileStat(url) else { throw StoreError.invalid("Datei nicht lesbar: \(url.path)") }
        try query("INSERT OR IGNORE INTO attachment(sha256, name, mime, size, created, stored, path, mtime) VALUES(?,?,?,?,?, 'link', ?, ?)",
                  [sha, url.lastPathComponent, mime, st.size, Store.now(), url.path, st.mtime])
        let a = try query("SELECT sha256, name, mime, size, stored, path FROM attachment WHERE sha256 = ?", [sha]).first!
        return a
    }

    /// Ort der Datei: im Buch oder (bei verlinkten Rohdaten) der ursprüngliche Pfad
    func localURL(_ sha: String) -> URL {
        if let a = try? query("SELECT stored, path FROM attachment WHERE sha256 = ?", [sha]).first, a["stored"] as? String == "link", let p = a["path"] as? String {
            return URL(fileURLWithPath: p)
        }
        return fileURL(sha)
    }

    /// Gespeicherte Angaben einer verlinkten Datei (nil, wenn im Buch gespeichert)
    func linkInfo(_ sha: String) throws -> (path: String, size: Int, mtime: Double)? {
        guard let a = try query("SELECT stored, path, size, mtime FROM attachment WHERE sha256 = ?", [sha]).first,
              a["stored"] as? String == "link", let p = a["path"] as? String else { return nil }
        return (p, a["size"] as? Int ?? -1, a["mtime"] as? Double ?? 0)
    }

    func touchLink(sha: String, mtime: Double) throws { try query("UPDATE attachment SET mtime = ? WHERE sha256 = ?", [mtime, sha]) }

    /// Status aus Pfad und gespeicherten Angaben bestimmen (ohne Datenbank, darf im Hintergrund laufen)
    static func linkStatus(sha: String, path: String, size: Int, mtime: Double) -> (status: String, mtime: Double?) {
        let url = URL(fileURLWithPath: path)
        guard let st = fileStat(url) else { return ("missing", nil) }
        if st.size == size, abs(st.mtime - mtime) < 0.001 { return ("ok", nil) }
        return (try? sha256(fileAt: url)) == sha ? ("ok", st.mtime) : ("changed", nil)
    }

    /// Verlinkte Datei prüfen: ok, changed (Inhalt anders als beim Verlinken) oder missing.
    /// Schnell über Größe und Änderungszeit; nur wenn die sich geändert haben, wird die Prüfsumme neu berechnet.
    func checkLink(sha: String) throws -> [String: Any] {
        guard let a = try query("SELECT stored, path, size, mtime FROM attachment WHERE sha256 = ?", [sha]).first else { throw StoreError.invalid("Datei unbekannt") }
        guard a["stored"] as? String == "link", let p = a["path"] as? String else { return ["status": "ok"] }
        let url = URL(fileURLWithPath: p)
        guard let st = Store.fileStat(url) else { return ["status": "missing", "path": p] }
        if st.size == a["size"] as? Int, abs(st.mtime - (a["mtime"] as? Double ?? 0)) < 0.001 { return ["status": "ok", "path": p] }
        let now = try Store.sha256(fileAt: url)
        if now == sha {
            try query("UPDATE attachment SET mtime = ? WHERE sha256 = ?", [st.mtime, sha])  // nur berührt, Inhalt gleich
            return ["status": "ok", "path": p]
        }
        return ["status": "changed", "path": p, "now": now]
    }

    func fileURL(_ sha: String) -> URL {
        root.appendingPathComponent("files").appendingPathComponent(String(sha.prefix(2))).appendingPathComponent(sha)
    }

    func mime(_ sha: String) -> String {
        (try? query("SELECT mime FROM attachment WHERE sha256 = ?", [sha]).first?["mime"] as? String) ?? "application/octet-stream"
    }
}
