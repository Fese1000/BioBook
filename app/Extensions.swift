// Erweiterungen: JavaScript-Dateien im Ordner „Erweiterungen“ (Application Support/Laborbuch). Die App liest nur den Text;
// ausgeführt wird er in der Oberfläche in einem abgeschotteten Rahmen (web/extensions.js). Ein- und ausschalten je Datei.
import AppKit

enum Extensions {
    static var testDisabled = Set<String>()  // Testmodus: Einstellungen der App nicht anfassen

    static func folder(test: Bool) -> URL {
        if test, let d = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] { return URL(fileURLWithPath: d).appendingPathComponent("Erweiterungen") }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Laborbuch/Erweiterungen")
    }

    static func disabled(test: Bool) -> Set<String> { test ? testDisabled : Set(UserDefaults.standard.stringArray(forKey: "disabledExtensions") ?? []) }

    /// [{file, code, enabled}] – nur .js-Dateien direkt im Ordner, höchstens 512 KB je Datei
    static func list(test: Bool) throws -> [[String: Any]] {
        let dir = folder(test: test), off = disabled(test: test)
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey]) else { return [] }
        return files.filter { $0.pathExtension == "js" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { u in
            guard ((try? u.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) <= 512_000, let code = try? String(contentsOf: u, encoding: .utf8) else { return nil }
            return ["file": u.lastPathComponent, "code": code, "enabled": !off.contains(u.lastPathComponent)]
        }
    }

    static func setEnabled(_ file: String, _ on: Bool, test: Bool) {
        var off = disabled(test: test)
        if on { off.remove(file) } else { off.insert(file) }
        if test { testDisabled = off } else { UserDefaults.standard.set(Array(off).sorted(), forKey: "disabledExtensions") }
    }

    /// Mitgelieferte Beispiele in den Ordner legen (vorhandene Dateien bleiben unangetastet)
    static func installExamples(test: Bool) throws -> [String] {
        let dir = folder(test: test)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let src = Bundle.main.resourceURL?.appendingPathComponent("Erweiterungen"),
              let files = try? FileManager.default.contentsOfDirectory(at: src, includingPropertiesForKeys: nil) else { return [] }
        var done: [String] = []
        for f in files where f.pathExtension == "js" {
            let dst = dir.appendingPathComponent(f.lastPathComponent)
            if FileManager.default.fileExists(atPath: dst.path) { continue }
            try FileManager.default.copyItem(at: f, to: dst); done.append(f.lastPathComponent)
        }
        return done
    }

    static func openFolder(test: Bool) {
        let dir = folder(test: test)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if !test { NSWorkspace.shared.open(dir) }
    }
}
