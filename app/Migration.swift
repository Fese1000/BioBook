// Übernahme aus der Zeit vor der Umbenennung (Laborbuch → BioBook): Datenordner und Einstellungen.
// Es wird kopiert, nie gelöscht: Die alten Daten bleiben als Rückfall liegen. Die Schlüssel im Schlüsselbund
// werden erst beim ersten Zugriff übernommen (Keys.migrateLegacy, Assistant.key), damit nie ein zweiter Schlüssel entsteht.
import AppKit
import Foundation

enum LegacyMigration {
    static let oldBundleID = "de.felix.laborbuch"
    static let doneKey = "migratedFromLaborbuch"
    /// Gesetzt, wenn nicht kopiert werden konnte: Das Standard-Buch bleibt dann am alten Ort
    static var fallbackBook: URL?
    /// Nur diese Einstellungen werden übernommen (keine Fenster- oder Systemschlüssel)
    static let copiedKeys = ["author", "backupDir", "bookPaths", "disabledExtensions", "lockEnabled", "lockMinutes", "spotlight", "lastBook"]

    /// Pfad aus dem alten Datenordner in den neuen umschreiben; das Standard-Buch bekommt die neue Endung
    static func rewritePath(_ p: String, oldBase: String, newBase: String) -> String {
        guard p == oldBase || p.hasPrefix(oldBase + "/") else { return p }
        let r = newBase + String(p.dropFirst(oldBase.count))
        return r == newBase + "/Standard.laborbuch" ? newBase + "/Standard.biobook" : r
    }

    /// Datenordner kopieren (erst in einen Zwischenordner, dann umbenennen: nie ein halber Zielordner). Gibt true zurück, wenn kopiert wurde.
    @discardableResult
    static func migrateFolder(old: URL, new: URL, fm: FileManager = .default) throws -> Bool {
        guard fm.fileExists(atPath: old.path), !fm.fileExists(atPath: new.path) else { return false }
        let tmp = new.deletingLastPathComponent().appendingPathComponent(new.lastPathComponent + ".migrating")
        try? fm.removeItem(at: tmp)  // Rest eines abgebrochenen Versuchs
        do {
            try fm.copyItem(at: old, to: tmp)
            let oldBook = tmp.appendingPathComponent("Standard.laborbuch"), newBook = tmp.appendingPathComponent("Standard.biobook")
            if fm.fileExists(atPath: oldBook.path), !fm.fileExists(atPath: newBook.path) { try fm.moveItem(at: oldBook, to: newBook) }
            try fm.moveItem(at: tmp, to: new)
        } catch {
            try? fm.removeItem(at: tmp)
            throw error
        }
        return true
    }

    /// Einstellungen aus dem alten Bereich übernehmen, ohne vorhandene zu überschreiben; Pfade zeigen danach in den neuen Ordner
    @discardableResult
    static func migrateDefaults(from old: [String: Any], into d: UserDefaults, oldBase: String, newBase: String) -> Int {
        var n = 0
        for (k, v) in old where copiedKeys.contains(k) || k.hasPrefix("lastBackup:") {
            if d.object(forKey: k) != nil { continue }
            switch v {
            case let s as String: d.set(rewritePath(s, oldBase: oldBase, newBase: newBase), forKey: k)
            case let m as [String: String]: d.set(m.mapValues { rewritePath($0, oldBase: oldBase, newBase: newBase) }, forKey: k)
            default: d.set(v, forKey: k)
            }
            n += 1
        }
        return n
    }

    /// Beim Start vor dem Öffnen des Buchs aufrufen. Testläufe (BIOBOOK_*) fassen nie echte Daten an.
    static func run() {
        let env = ProcessInfo.processInfo.environment
        guard env["BIOBOOK_BOOK"] == nil, env["BIOBOOK_KEYFILE"] == nil, env["BIOBOOK_BACKUPDIR"] == nil else { return }
        let d = UserDefaults.standard
        guard !d.bool(forKey: doneKey) else { return }
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let old = support.appendingPathComponent("Laborbuch"), new = support.appendingPathComponent("BioBook")
        let oldBook = old.appendingPathComponent("Standard.laborbuch")
        if !fm.fileExists(atPath: new.path), !NSRunningApplication.runningApplications(withBundleIdentifier: oldBundleID).isEmpty {
            fallbackBook = oldBook  // Die alte App läuft noch: nicht mitten im Betrieb kopieren; diesmal am alten Ort bleiben
            return
        }
        do { try migrateFolder(old: old, new: new) } catch {
            NSLog("BioBook: Übernahme des Datenordners fehlgeschlagen: \(error)")
            if fm.fileExists(atPath: oldBook.path), !fm.fileExists(atPath: new.path) { fallbackBook = oldBook }
            return  // nicht als erledigt markieren: der nächste Start versucht es erneut
        }
        if let prefs = d.persistentDomain(forName: oldBundleID) { migrateDefaults(from: prefs, into: d, oldBase: old.path, newBase: new.path) }
        d.set(true, forKey: doneKey)
    }
}
