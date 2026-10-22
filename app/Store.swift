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
    let root: URL
    private var db: OpaquePointer?

    init(root: URL) throws {
        self.root = root
        let fm = FileManager.default
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
    }

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
        try exec("BEGIN IMMEDIATE")
        do { let r = try body(); try exec("COMMIT"); return r } catch { try? exec("ROLLBACK"); throw error }
    }

    // MARK: Einträge
    func list() throws -> [[String: Any]] {
        try query("""
        SELECT e.id, e.title, e.updated, (SELECT COUNT(*) FROM revision r WHERE r.entry_id = e.id) AS revisions
        FROM entry e ORDER BY e.updated DESC
        """)
    }

    func create(title: String) throws -> Int {
        let t = Store.now()
        return try transaction {
            try query("INSERT INTO entry(title, created, updated) VALUES(?, ?, ?)", [title, t, t])
            let id = Int(sqlite3_last_insert_rowid(db))
            try query("INSERT INTO search(rowid, title, body) VALUES(?, ?, '')", [id, title])
            return id
        }
    }

    func load(id: Int) throws -> [String: Any] {
        guard let e = try query("SELECT id, title, created, updated, draft_json FROM entry WHERE id = ?", [id]).first else {
            throw StoreError.invalid("Eintrag \(id) gibt es nicht")
        }
        return e
    }

    /// Arbeitsstand speichern (wird beim Tippen laufend überschrieben). Unveränderliche Revisionen entstehen erst mit snapshot().
    func saveDraft(id: Int, title: String, json: String, text: String) throws -> [String: Any] {
        let t = Store.now()
        try transaction {
            try query("UPDATE entry SET title = ?, draft_json = ?, draft_text = ?, updated = ? WHERE id = ?", [title, json, text, t, id])
            try query("UPDATE search SET title = ?, body = ? WHERE rowid = ?", [title, text, id])
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

    /// Prüft die Hash-Kette aller Revisionen eines Eintrags; gibt die erste fehlerhafte Revision zurück.
    func verify(id: Int) throws -> [String: Any] {
        var prev = String(repeating: "0", count: 64)
        let revs = try query("SELECT no, title, content_json, created, prev_hash, hash FROM revision WHERE entry_id = ? ORDER BY no", [id])
        for r in revs {
            let no = r["no"] as! Int
            let h = Store.revisionHash(prev: prev, entry: id, no: no, created: r["created"] as! String,
                                       title: r["title"] as! String, json: r["content_json"] as! String)
            if r["prev_hash"] as? String != prev || r["hash"] as? String != h { return ["ok": false, "broken": no, "count": revs.count] }
            prev = h
        }
        return ["ok": true, "count": revs.count]
    }

    func search(_ q: String) throws -> [[String: Any]] {
        // Jedes Wort als Präfix suchen; Anführungszeichen entfernen, damit FTS-Syntax nicht stört
        let terms = q.split(whereSeparator: { $0.isWhitespace }).map { "\"\($0.replacingOccurrences(of: "\"", with: ""))\"*" }
        if terms.isEmpty { return [] }
        return try query("""
        SELECT e.id, e.title, e.updated, snippet(search, 1, '[', ']', '…', 12) AS snippet
        FROM search JOIN entry e ON e.id = search.rowid WHERE search MATCH ? ORDER BY rank LIMIT 50
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

    func fileURL(_ sha: String) -> URL {
        root.appendingPathComponent("files").appendingPathComponent(String(sha.prefix(2))).appendingPathComponent(sha)
    }

    func mime(_ sha: String) -> String {
        (try? query("SELECT mime FROM attachment WHERE sha256 = ?", [sha]).first?["mime"] as? String) ?? "application/octet-stream"
    }
}
