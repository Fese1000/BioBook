// Automatische Sicherung: täglich eine Kopie der Datenbank (die letzten 14 bleiben) und alle neuen Anhänge.
// Anhänge werden nie gelöscht und nur einmal kopiert, weil sie nach ihrer Prüfsumme benannt sind.
import Foundation

enum Backup {
    static let keep = 14
    static let interval: TimeInterval = 24 * 3600

    /// Sicherungsordner: Einstellung, sonst Application Support; für Tests BIOBOOK_BACKUPDIR
    static func baseDir() -> URL {
        if let t = ProcessInfo.processInfo.environment["BIOBOOK_BACKUPDIR"] { return URL(fileURLWithPath: t) }
        if let p = UserDefaults.standard.string(forKey: "backupDir") { return URL(fileURLWithPath: p) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("BioBook/Sicherungen")
    }

    static func dir(for s: Store) -> URL { baseDir().appendingPathComponent("\(s.name) (\(s.bookID.prefix(8)))") }

    static func last(for s: Store) -> Date? { UserDefaults.standard.object(forKey: "lastBackup:\(s.bookID)") as? Date }

    /// Fällig, wenn die letzte Sicherung älter als ein Tag ist (oder force). Datenbank im Hauptthread, Dateien im Hintergrund.
    static func run(_ s: Store, force: Bool, queue: DispatchQueue, done: @escaping (Result<[String: Any], Error>) -> Void) {
        if !force, let l = last(for: s), Date().timeIntervalSince(l) < interval { return done(.success(["skipped": true])) }
        let dir = dir(for: s), fm = FileManager.default
        let stamp = FileExport.stamp()
        let db = dir.appendingPathComponent("db-\(stamp).sqlite")
        do {
            try fm.createDirectory(at: dir.appendingPathComponent("files"), withIntermediateDirectories: true)
            if fm.fileExists(atPath: db.path) { try fm.removeItem(at: db) }
            try s.backupDB(to: db)
            let meta = s.root.appendingPathComponent("meta.json"), metaDst = dir.appendingPathComponent("meta.json")
            if !fm.fileExists(atPath: metaDst.path) { try fm.copyItem(at: meta, to: metaDst) }
        } catch { return done(.failure(error)) }
        let src = s.root.appendingPathComponent("files"), bookID = s.bookID
        queue.async {
            let r = Result { try copyFiles(from: src, to: dir) }
            DispatchQueue.main.async {
                switch r {
                case .failure(let e): done(.failure(e))
                case .success(let (copied, kept)):
                    // in Tests nichts in die Einstellungen der App schreiben
                    if ProcessInfo.processInfo.environment["BIOBOOK_BACKUPDIR"] == nil { UserDefaults.standard.set(Date(), forKey: "lastBackup:\(bookID)") }
                    done(.success(["dir": dir.path, "db": db.lastPathComponent, "copied": copied, "kept": kept]))
                }
            }
        }
    }

    /// Neue Anhänge kopieren und alte Datenbank-Kopien löschen; gibt (kopiert, behalten) zurück
    private static func copyFiles(from src: URL, to dir: URL) throws -> (Int, Int) {
        let fm = FileManager.default
        var copied = 0
        let en = fm.enumerator(at: src, includingPropertiesForKeys: [.isRegularFileKey])
        while let f = en?.nextObject() as? URL {
            guard (try? f.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            let rel = String(f.path.dropFirst(src.path.count + 1))
            let dst = dir.appendingPathComponent("files").appendingPathComponent(rel)
            if fm.fileExists(atPath: dst.path) { continue }
            try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: f, to: dst)
            copied += 1
        }
        let dbs = try fm.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix("db-") && $0.hasSuffix(".sqlite") }.sorted()
        for old in dbs.dropLast(keep) { try? fm.removeItem(at: dir.appendingPathComponent(old)) }
        return (copied, min(dbs.count, keep))
    }
}
