// Selbst-Update: neueste Version bei GitHub suchen, das DMG laden, Prüfsumme, Bundle-ID, Version und Signatur prüfen,
// dann die App austauschen und neu starten. Das Austauschen übernimmt ein kleines Skript, nachdem die App beendet ist.
import Cocoa

enum Updater {
    static let repo = "Fese1000/Laborbuch"
    static let bundleID = "de.felix.laborbuch"
    static var asset: String { "Laborbuch-AppleSilicon.dmg" }  // vorerst nur Apple Silicon

    /// Für Tests: LABORBUCH_UPDATE_API (eigene Release-Beschreibung) und passendes Download-Präfix
    static var api: URL {
        URL(string: ProcessInfo.processInfo.environment["LABORBUCH_UPDATE_API"] ?? "https://api.github.com/repos/\(repo)/releases/latest")!
    }
    static var downloadPrefix: String {
        ProcessInfo.processInfo.environment["LABORBUCH_UPDATE_PREFIX"] ?? "https://github.com/\(repo)/releases/download/"
    }

    static var current: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }

    static func parse(_ v: String) -> [Int]? {
        let s = v.hasPrefix("v") ? String(v.dropFirst()) : v
        let parts = s.split(separator: ".").map { Int($0) }
        return parts.isEmpty || parts.contains(nil) ? nil : parts.compactMap { $0 }
    }

    static func newer(_ a: String, than b: String) -> Bool {
        guard let x = parse(a), let y = parse(b) else { return false }
        for i in 0..<max(x.count, y.count) { let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0; if p != q { return p > q } }
        return false
    }

    static var appBundle: URL { Bundle.main.bundleURL }

    /// Ersetzen nur möglich, wenn die App in einem beschreibbaren Ordner liegt (z. B. /Programme ohne Admin-Sperre)
    static var canInstall: (ok: Bool, reason: String?) {
        let b = appBundle
        guard b.pathExtension == "app" else { return (false, "Keine App-Datei") }
        guard FileManager.default.isWritableFile(atPath: b.deletingLastPathComponent().path), FileManager.default.isWritableFile(atPath: b.path) else {
            return (false, "Keine Schreibrechte für \(b.deletingLastPathComponent().path) – bitte die neue Version manuell laden.")
        }
        return (true, nil)
    }

    struct Release { let version: String; let url: URL; let size: Int; let sha256: String }

    static func check(done: @escaping (Result<Release?, Error>) -> Void) {
        var req = URLRequest(url: api, timeoutInterval: 15)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Laborbuch/\(current)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, err in
            let r: Result<Release?, Error> = Result {
                if let err { throw err }
                guard (resp as? HTTPURLResponse)?.statusCode == 200, let data,
                      let j = try JSONSerialization.jsonObject(with: data) as? [String: Any], let tag = j["tag_name"] as? String,
                      parse(tag) != nil else { throw StoreError.invalid("Unerwartete Antwort vom Update-Server") }
                guard newer(tag, than: current) else { return nil }
                guard let a = (j["assets"] as? [[String: Any]])?.first(where: { $0["name"] as? String == asset }),
                      let u = a["browser_download_url"] as? String, u.hasPrefix(downloadPrefix), let url = URL(string: u),
                      let digest = a["digest"] as? String, digest.hasPrefix("sha256:") else {
                    throw StoreError.invalid("Version \(tag) gefunden, aber ohne passendes, geprüftes Paket für Apple Silicon")
                }
                return Release(version: tag.hasPrefix("v") ? String(tag.dropFirst()) : tag, url: url, size: a["size"] as? Int ?? 0, sha256: String(digest.dropFirst(7)))
            }
            DispatchQueue.main.async { done(r) }
        }.resume()
    }

    /// Laden, prüfen, vorbereiten; danach beendet sich die App und das Skript tauscht sie aus
    static func install(_ rel: Release, progress: @escaping (String) -> Void, done: @escaping (Error?) -> Void) {
        let work = FileManager.default.temporaryDirectory.appendingPathComponent("laborbuch-update-\(UUID().uuidString)")
        progress("download")
        URLSession.shared.downloadTask(with: rel.url) { tmp, resp, err in
            let r: Result<URL, Error> = Result {
                if let err { throw err }
                guard let tmp, (resp as? HTTPURLResponse)?.statusCode == 200 else { throw StoreError.invalid("Download fehlgeschlagen") }
                try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
                let dmg = work.appendingPathComponent("update.dmg")
                try FileManager.default.moveItem(at: tmp, to: dmg)
                guard try Store.sha256(fileAt: dmg) == rel.sha256 else { throw StoreError.invalid("Prüfsumme des Downloads stimmt nicht") }
                DispatchQueue.main.async { progress("install") }
                let mnt = work.appendingPathComponent("mnt"), new = work.appendingPathComponent("new")
                try FileManager.default.createDirectory(at: mnt, withIntermediateDirectories: true)
                try FileManager.default.createDirectory(at: new, withIntermediateDirectories: true)
                try FileExport.run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mnt.path, dmg.path])
                defer { try? FileExport.run("/usr/bin/hdiutil", ["detach", "-force", mnt.path]) }
                let app = new.appendingPathComponent("Laborbuch.app")
                try FileExport.run("/usr/bin/ditto", [mnt.appendingPathComponent("Laborbuch.app").path, app.path])
                let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")) as? [String: Any] ?? [:]
                guard info["CFBundleIdentifier"] as? String == bundleID else { throw StoreError.invalid("Unerwartete App im Update") }
                guard newer(info["CFBundleShortVersionString"] as? String ?? "0", than: current) else { throw StoreError.invalid("Das Update ist nicht neuer") }
                try FileExport.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
                return app
            }
            DispatchQueue.main.async {
                switch r {
                case .failure(let e): try? FileManager.default.removeItem(at: work); done(e)
                case .success(let app):
                    do { try swapAfterQuit(new: app, work: work); progress("restart"); done(nil) }
                    catch { done(error) }
                }
            }
        }.resume()
    }

    /// Skript, das wartet bis die App beendet ist, sie austauscht und neu startet (bei Fehler bleibt die alte)
    static func swapAfterQuit(new: URL, work: URL) throws {
        let old = appBundle.path, pid = ProcessInfo.processInfo.processIdentifier
        let relaunch = ProcessInfo.processInfo.environment["LABORBUCH_NO_RELAUNCH"] == nil ? "open \"$OLD\"" : ":"
        let script = work.appendingPathComponent("swap.sh")
        try """
        #!/bin/sh
        while kill -0 \(pid) 2>/dev/null; do sleep 0.3; done
        OLD="\(old)"; NEW="\(new.path)"
        mv "$OLD" "$OLD.old" && { mv "$NEW" "$OLD" && rm -rf "$OLD.old" || mv "$OLD.old" "$OLD"; }
        \(relaunch)
        rm -rf "\(work.path)"
        """.write(to: script, atomically: true, encoding: .utf8)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = [script.path]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        try p.run()  // läuft nach dem Beenden der App weiter
    }
}
