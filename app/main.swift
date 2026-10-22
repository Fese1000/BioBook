// Dünne Swift-Schicht: Fenster, WebView, Schema lab:// für Oberfläche und Anhänge, Brücke JS ↔ Swift.
import Cocoa
import PDFKit
import UniformTypeIdentifiers
import WebKit

/// Liefert die Oberfläche (lab://app/…) und Anhänge (lab://files/<sha256>) aus, ohne file:// freizugeben.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let web: URL
    let store: () -> Store?
    init(web: URL, store: @escaping () -> Store?) { self.web = web; self.store = store }

    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var file: URL?, mime = "application/octet-stream"
        // Anhänge: lab://files/<sha> (Bilder im Text) und lab://app/files/<sha> (gleicher Ursprung wie die Oberfläche, für fetch)
        let filesPath = url.host == "app" && url.path.hasPrefix("/files/")
        if url.host == "app" && !filesPath {
            let rel = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
            let f = web.appendingPathComponent(rel).standardizedFileURL
            if f.path.hasPrefix(web.standardizedFileURL.path + "/") { file = f }
            mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "png": "image/png"][f.pathExtension] ?? mime
        } else if url.host == "files" || filesPath, let s = store() {
            let sha = url.lastPathComponent
            if sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil { file = s.localURL(sha); mime = s.mime(sha) }
        }
        // verlinkte Rohdaten können riesig sein: nicht über die Oberfläche ausliefern (Öffnen geht direkt)
        if let f = file, let sz = (try? FileManager.default.attributesOfItem(atPath: f.path))?[.size] as? Int, sz > 60_000_000 {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 413, httpVersion: nil, headerFields: nil)!)
            task.didFinish(); return
        }
        guard let f = file, let data = try? Data(contentsOf: f) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            task.didFinish(); return
        }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                        headerFields: ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache"])!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var store: Store?
    var scheme: SchemeHandler!
    var locker: Locker!
    var pendingOpen: URL?
    let ocrQueue = DispatchQueue(label: "de.felix.laborbuch.ocr", qos: .utility)
    var ocrRunning = false
    let testMode = CommandLine.arguments.contains("--selftest") || CommandLine.arguments.contains("--perftest")  // per Doppelklick im Finder übergeben, bevor das Fenster steht

    func applicationDidFinishLaunching(_ n: Notification) {
        let start = pendingOpen ?? Self.lastBook() ?? Self.defaultBook()
        do { store = try Store(root: start) } catch {
            // Letztes Buch fehlt oder ist kaputt: auf das Standard-Buch ausweichen statt die App zu beenden
            do { store = try Store(root: Self.defaultBook()) } catch { fail("Laborbuch lässt sich nicht öffnen: \(error)") }
            alert("„\(start.lastPathComponent)“ lässt sich nicht öffnen", "\(error)")
        }
        remember()
        buildMenu()
        let cfg = WKWebViewConfiguration()
        let res = Bundle.main.resourceURL!.appendingPathComponent("web")
        scheme = SchemeHandler(web: res, store: { [weak self] in self?.store })
        cfg.setURLSchemeHandler(scheme, forURLScheme: "lab")
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "lab")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        updateTitle()
        window.minSize = NSSize(width: 760, height: 480)
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("LaborbuchMain")
        if !window.setFrameUsingName("LaborbuchMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        scheduleOCR()
        if !testMode {
            autoBackup()
            Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in self?.autoBackup() }
        }
        locker = Locker(window: window, disabled: testMode)
        locker.lockIfEnabled()
        web.load(URLRequest(url: URL(string: "lab://app/index.html")!))
    }

    // MARK: Laborbücher – ein Buch ist ein Ordner-Paket „Name.laborbuch“
    static func defaultBook() -> URL {
        if let p = ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] { return URL(fileURLWithPath: p) }  // für Tests
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Laborbuch/Standard.laborbuch")
    }

    static func lastBook() -> URL? {
        if ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] != nil { return nil }
        guard let p = UserDefaults.standard.string(forKey: "lastBook"), FileManager.default.fileExists(atPath: p) else { return nil }
        return URL(fileURLWithPath: p)
    }

    func remember() {
        guard let s = store, ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] == nil else { return }
        UserDefaults.standard.set(s.root.path, forKey: "lastBook")
        NSDocumentController.shared.noteNewRecentDocumentURL(s.root)
    }

    func updateTitle() { window?.title = store.map { "\($0.name) – Laborbuch" } ?? "Laborbuch" }

    /// Wechselt das Buch: offenen Stand sichern, neues Buch öffnen, Oberfläche neu laden.
    func switchBook(to url: URL) {
        guard url.pathExtension == "laborbuch" else { return alert("Kein Laborbuch", "Bitte einen Ordner mit der Endung .laborbuch wählen.") }
        if url.standardizedFileURL == store?.root.standardizedFileURL { return }
        let open = { [self] in
            do {
                let s = try Store(root: url)
                try? store?.snapshotAll()
                store = s
                remember(); updateTitle()
                web.reload()
                scheduleOCR()
            } catch { alert("„\(url.lastPathComponent)“ lässt sich nicht öffnen", "\(error)") }
        }
        if web == nil { pendingOpen = url; return }
        web.evaluateJavaScript("app.flush()") { _, _ in open() }
    }

    @objc func newBook() {
        let p = NSSavePanel()
        p.title = "Neues Laborbuch"
        p.nameFieldStringValue = "Neues Laborbuch.laborbuch"
        p.allowedContentTypes = [Self.bookType]
        guard p.runModal() == .OK, var url = p.url else { return }
        if url.pathExtension != "laborbuch" { url.appendPathExtension("laborbuch") }
        if FileManager.default.fileExists(atPath: url.path) { return alert("Gibt es schon", "„\(url.lastPathComponent)“ existiert bereits. Zum Öffnen ⌘O verwenden.") }
        switchBook(to: url)
    }

    @objc func openBook() {
        let p = NSOpenPanel()
        p.title = "Laborbuch öffnen"
        p.allowedContentTypes = [Self.bookType]
        p.canChooseDirectories = false  // das Paket erscheint dank Dokumenttyp als eine Datei
        if p.runModal() == .OK, let url = p.url { switchBook(to: url) }
    }

    @objc func revealBook() { if let s = store { NSWorkspace.shared.activateFileViewerSelecting([s.root]) } }

    static let bookType = UTType("de.felix.laborbuch.book") ?? .package

    func application(_ app: NSApplication, open urls: [URL]) {
        if let u = urls.first(where: { $0.pathExtension == "laborbuch" }) { switchBook(to: u) }
    }

    func alert(_ title: String, _ text: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
    }

    /// `--perftest` / `--selftest`: Test in der echten WebView ausführen, Ergebnis ausgeben, beenden (Abnahme ohne Bedienung).
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        let args = CommandLine.arguments
        let js = args.contains("--perftest") ? "await app.perfTest(); return window.perfResult.join('\\n')"
            : args.contains("--selftest") ? "await new Promise(r => setTimeout(r, 300)); return (await app.selfTest()).join('\\n')" : nil
        guard let js else { return }
        w.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
            switch r {
            case .success(let v): print(v as? String ?? "")
            case .failure(let e): print("Fehler: \(e)")
            }
            fflush(stdout)
            NSApp.terminate(nil)
        }
    }

    func fail(_ msg: String) {
        let a = NSAlert(); a.messageText = "Laborbuch"; a.informativeText = msg; a.runModal(); NSApp.terminate(nil)
    }

    // MARK: Brücke – feste Befehlsliste, jede Eingabe wird geprüft
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let msg = m.body as? [String: Any], let cmd = msg["cmd"] as? String, let s = store else { return replyHandler(nil, "Ungültige Anfrage") }
        let a = msg["args"] as? [String: Any] ?? [:]
        func int(_ k: String) throws -> Int { guard let v = a[k] as? Int else { throw StoreError.invalid("\(k) fehlt") }; return v }
        func str(_ k: String) throws -> String { guard let v = a[k] as? String else { throw StoreError.invalid("\(k) fehlt") }; return v }
        do {
            switch cmd {
            case "book": replyHandler(["name": s.name, "path": s.root.path, "kinds": Store.kinds], nil)
            case "projects": replyHandler(try s.projects(), nil)
            case "createProject": replyHandler(try s.createProject(name: try str("name")), nil)
            case "updateProject":
                try s.updateProject(id: try int("id"), name: a["name"] as? String, archived: a["archived"] as? Bool)
                replyHandler(true, nil)
            case "list": replyHandler(try s.list(project: a["project"] as? Int, tag: a["tag"] as? Int), nil)
            case "templates": replyHandler(try s.templates(), nil)
            case "saveTemplate": replyHandler(try s.saveTemplate(name: try str("name"), fromEntry: try int("entry")), nil)
            case "templateVersions": replyHandler(try s.templateVersions(id: try int("id")), nil)
            case "archiveTemplate": try s.archiveTemplate(id: try int("id"), archived: a["archived"] as? Bool ?? true); replyHandler(true, nil)
            case "createFromTemplate": replyHandler(try s.createFromTemplate(id: try int("id"), version: a["version"] as? Int, project: a["project"] as? Int), nil)
            case "startRun": replyHandler(try s.startRun(entry: try int("entry"), steps: a["steps"] as? [String] ?? []), nil)
            case "activeRun": replyHandler(try s.activeRun(entry: try int("entry")) ?? NSNull(), nil)
            case "completeStep": replyHandler(try s.completeStep(run: try int("run"), step: try int("step"), note: (a["note"] as? String) ?? ""), nil)
            case "finishRun": replyHandler(try s.finishRun(run: try int("run"), aborted: a["aborted"] as? Bool ?? false), nil)
            case "settings":
                replyHandler(["author": Settings.author, "lockEnabled": Settings.lockEnabled, "lockMinutes": Settings.lockMinutes,
                              "fingerprint": Keys.fingerprint() ?? NSNull(), "backupDir": Backup.dir(for: s).path,
                              "lastBackup": Backup.last(for: s).map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()], nil)
            case "setSettings":
                if let n = a["author"] as? String { Settings.author = n }
                if let l = a["lockEnabled"] as? Bool { Settings.lockEnabled = l }
                if let m = a["lockMinutes"] as? Int { Settings.lockMinutes = m }
                replyHandler(true, nil)
            case "lockNow": locker.lock(); replyHandler(true, nil)
            case "signEntry":
                if testMode && ProcessInfo.processInfo.environment["LABORBUCH_KEYFILE"] == nil { throw StoreError.invalid("Tests brauchen LABORBUCH_KEYFILE (nie den echten Schlüsselbund)") }
                let key = try Keys.signingKey()
                replyHandler(try s.signEntry(id: try int("id"), key: key, name: Settings.author), nil)
            case "signedRevision": replyHandler(try s.signedRevision(id: try int("id")), nil)
            case "witnessPDF":
                let id = try int("id"), html = try str("html")
                let hash = try s.signedRevision(id: id)["hash"] as! String
                guard html.contains(hash) else { throw StoreError.invalid("Das PDF muss den Hash der signierten Revision enthalten") }
                WitnessPDF.make(html: html, hash: hash, scheme: scheme) { [weak self] r in
                    switch r {
                    case .failure(let e): replyHandler(nil, "\(e)")
                    case .success(let data): self?.savePDF(data, name: (a["name"] as? String) ?? "Zeugen-PDF", reply: replyHandler)
                    }
                }
            case "attachWitness":
                let id = try int("id"), name = try str("name")
                let hash = try s.signedRevision(id: id)["hash"] as! String
                guard let url = pickPDF(testPath: a["testPath"] as? String) else { return replyHandler(NSNull(), nil) }
                let data = try Data(contentsOf: url)
                guard data.count <= 50_000_000 else { throw StoreError.invalid("PDF ist größer als 50 MB") }
                let found = WitnessPDF.containsHash(data, hash: hash)
                let sha = try s.putFile(name: url.lastPathComponent, mime: "application/pdf", data: data)
                var w = try s.addWitness(id: id, name: name, file: sha, hashFound: found)
                scheduleOCR()
                w["sha256"] = sha
                replyHandler(w, nil)
            case "linkFiles":
                // Rohdaten am Ort lassen: Prüfsumme im Hintergrund berechnen (große Dateien), dann verlinken
                let urls: [URL]
                if let t = a["testPaths"] as? [String], ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] != nil { urls = t.map { URL(fileURLWithPath: $0) } }
                else {
                    let p = NSOpenPanel()
                    p.title = "Rohdaten verlinken (bleiben am Ort, nur die Prüfsumme kommt ins Laborbuch)"
                    p.allowsMultipleSelection = true; p.canChooseDirectories = false
                    guard p.runModal() == .OK else { return replyHandler([], nil) }
                    urls = p.urls
                }
                let root = s.root
                ocrQueue.async {
                    let hashed = urls.map { u in (u, try? Store.sha256(fileAt: u)) }
                    DispatchQueue.main.async {
                        guard let s = self.store, s.root == root else { return replyHandler(nil, "Laborbuch gewechselt") }
                        do {
                            replyHandler(try hashed.map { u, sha in
                                guard let sha else { throw StoreError.invalid("Nicht lesbar: \(u.path)") }
                                let mime = UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                                return try s.linkFile(url: u, sha: sha, mime: mime)
                            }, nil)
                        } catch { replyHandler(nil, "\(error)") }
                    }
                }
            case "checkLinks":
                // Status je verlinkter Datei; Prüfsummen nur neu, wenn Größe oder Zeit abweichen (im Hintergrund)
                let infos = try (a["shas"] as? [String] ?? []).compactMap { sha in try s.linkInfo(sha).map { (sha, $0) } }
                let root = s.root
                ocrQueue.async {
                    let res = infos.map { sha, i in (sha, Store.linkStatus(sha: sha, path: i.path, size: i.size, mtime: i.mtime), i.path) }
                    DispatchQueue.main.async {
                        guard let s = self.store, s.root == root else { return replyHandler([:], nil) }
                        var out: [String: Any] = [:]
                        for (sha, st, path) in res {
                            if let m = st.mtime { try? s.touchLink(sha: sha, mtime: m) }
                            out[sha] = ["status": st.status, "path": path]
                        }
                        replyHandler(out, nil)
                    }
                }
            case "ocrText": replyHandler(try s.ocrText(try str("sha256")) ?? NSNull(), nil)
            // Nur im Testmodus mit LABORBUCH_TESTOUT: Dateien anlegen/ändern und eine iPhone-Übernahme nachstellen
            case "testWriteText", "testWriteBase64", "testReadText", "testList":
                guard testMode, let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] else { throw StoreError.invalid("Nur im Testmodus") }
                let base = URL(fileURLWithPath: dir)
                if cmd == "testList" { return replyHandler(FileManager.default.enumerator(atPath: base.path)?.allObjects as? [String] ?? [], nil) }
                let url = try FileExport.safe(try str(cmd == "testReadText" ? "path" : "name"), in: base)
                if cmd == "testReadText" { return replyHandler(try String(contentsOf: url, encoding: .utf8), nil) }
                let data = cmd == "testWriteText" ? Data(try str("text").utf8) : Data(base64Encoded: try str("base64")) ?? Data()
                try data.write(to: url)
                replyHandler(url.path, nil)
            case "testWriteFile", "testModifyFile", "testReceive":
                guard testMode, let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] else { throw StoreError.invalid("Nur im Testmodus") }
                if cmd == "testReceive" {
                    let pb = NSPasteboard(name: NSPasteboard.Name("laborbuch-test-\(UUID().uuidString)"))
                    let img = NSImage(size: NSSize(width: 64, height: 48)); img.lockFocus(); NSColor.systemTeal.setFill(); NSRect(x: 0, y: 0, width: 64, height: 48).fill(); img.unlockFocus()
                    pb.clearContents(); pb.writeObjects([img])
                    replyHandler(readSelection(from: pb), nil)
                } else {
                    let url = URL(fileURLWithPath: dir).appendingPathComponent(URL(fileURLWithPath: try str("name")).lastPathComponent)
                    if cmd == "testWriteFile" { try Data(repeating: 42, count: try int("bytes")).write(to: url) }
                    else { var d = try Data(contentsOf: url); d[0] = d[0] &+ 1; try d.write(to: url) }
                    replyHandler(url.path, nil)
                }
            case "backupNow": autoBackup(force: true, reply: replyHandler)
            case "chooseBackupDir":
                let p = NSOpenPanel()
                p.title = "Ordner für Sicherungen (z. B. externe Platte oder iCloud Drive)"; p.prompt = "Wählen"
                p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true
                guard p.runModal() == .OK, let u = p.url else { return replyHandler(NSNull(), nil) }
                UserDefaults.standard.set(u.path, forKey: "backupDir")
                replyHandler(u.path, nil)
            case "exportData": replyHandler(try s.dump(), nil)
            case "exportWrite": exportWrite(a, s, reply: replyHandler)
            case "entryPDF":
                let html = try str("html"), pdfa = a["pdfa"] as? Bool ?? false
                if pdfa && FileExport.ghostscript == nil { throw ExportError.tool("Für PDF/A wird Ghostscript gebraucht (im Terminal: brew install ghostscript). Normales PDF geht ohne.") }
                WitnessPDF.make(html: html, hash: (a["hash"] as? String) ?? "", scheme: scheme) { [weak self] r in
                    switch r {
                    case .failure(let e): replyHandler(nil, "\(e)")
                    case .success(let data):
                        do { self?.savePDF(pdfa ? try FileExport.pdfA(data) : data, name: (a["name"] as? String) ?? "Eintrag.pdf", reply: replyHandler) }
                        catch { replyHandler(nil, "\(error)") }
                    }
                }
            case "importPick": importPick(a, s, reply: replyHandler)
            case "notify":
                // Timer abgelaufen: Ton und Dock-Symbol hüpfen lassen, auch wenn die App im Hintergrund ist
                NSSound(named: "Glass")?.play()
                NSApp.requestUserAttention(.criticalRequest)
                replyHandler(true, nil)
            case "tags": replyHandler(try s.tags(), nil)
            case "setTags": replyHandler(try s.setTags(id: try int("id"), names: a["names"] as? [String] ?? []), nil)
            case "backlinks": replyHandler(try s.backlinks(id: try int("id")), nil)
            case "titles": replyHandler(try s.titles(), nil)
            case "openFile":
                // Anhänge liegen nach Prüfsumme ohne Endung; zum Öffnen eine Kopie mit Originalnamen anlegen
                let sha = try str("sha256")
                guard sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw StoreError.invalid("Ungültige Datei") }
                if try s.linkInfo(sha) != nil {  // verlinkte Rohdaten: Original öffnen, nicht kopieren
                    let u = s.localURL(sha)
                    guard FileManager.default.fileExists(atPath: u.path) else { throw StoreError.invalid("Die verlinkte Datei fehlt: \(u.path)") }
                    NSWorkspace.shared.open(u); return replyHandler(true, nil)
                }
                let src = s.fileURL(sha)
                guard FileManager.default.fileExists(atPath: src.path) else { throw StoreError.invalid("Datei fehlt im Laborbuch") }
                var name = URL(fileURLWithPath: (a["name"] as? String) ?? "Anhang").lastPathComponent
                if name.isEmpty || name.hasPrefix(".") { name = "Anhang" + name }
                let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Laborbuch/\(sha.prefix(16))")
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let dst = dir.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: dst)
                try FileManager.default.copyItem(at: src, to: dst)
                try? FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: dst.path)  // Kopie schreibgeschützt: Original bleibt unverändert
                NSWorkspace.shared.open(dst)
                replyHandler(true, nil)
            case "create": replyHandler(try s.create(title: (a["title"] as? String) ?? "", project: a["project"] as? Int,
                                                     kind: (a["kind"] as? String) ?? "experiment"), nil)
            case "setMeta":
                try s.setMeta(id: try int("id"), project: a["project"] as? Int, kind: a["kind"] as? String)
                replyHandler(true, nil)
            case "load": replyHandler(try s.load(id: try int("id")), nil)
            case "revision": replyHandler(try s.revision(id: try int("id"), no: try int("no")), nil)
            case "save": replyHandler(try s.saveDraft(id: try int("id"), title: try str("title"), json: try str("json"), text: try str("text"),
                                                      links: a["links"] as? [Int] ?? [], files: a["files"] as? [String] ?? []), nil)
            case "snapshot": replyHandler(try s.snapshot(id: try int("id")) ?? NSNull(), nil)
            case "history": replyHandler(try s.history(id: try int("id")), nil)
            case "verify": replyHandler(try s.verify(id: try int("id")), nil)
            case "search": replyHandler(try s.search(try str("q")), nil)
            case "putFile":
                let b64 = try str("base64")
                guard b64.utf8.count <= 70_000_000 else { throw StoreError.invalid("Datei zu groß (max. 50 MB). Große Rohdaten werden ab M5 verlinkt statt kopiert.") }
                guard let data = Data(base64Encoded: b64) else { throw StoreError.invalid("Datei unlesbar") }
                let mime = try str("mime")
                guard mime.range(of: "^[a-z]+/[a-z0-9.+-]+$", options: .regularExpression) != nil else { throw StoreError.invalid("Dateityp ungültig") }
                replyHandler(["sha256": try s.putFile(name: try str("name"), mime: mime, data: data)], nil)
                scheduleOCR()
            default: replyHandler(nil, "Unbekannter Befehl: \(cmd)")
            }
        } catch { replyHandler(nil, "\(error)") }
    }

    // MARK: Fotos und Scans vom iPhone (Kamera-Übernahme)
    @objc func validRequestor(forSendType sendType: NSPasteboard.PasteboardType?, returnType: NSPasteboard.PasteboardType?) -> Any? {
        guard sendType == nil, let r = returnType, !(locker?.locked ?? true), store != nil else { return nil }
        return NSImage.imageTypes.contains(r.rawValue) || r == .pdf ? self : nil
    }

    /// Bild oder gescanntes PDF übernehmen: als Anhang speichern und an der Schreibmarke einfügen
    @objc func readSelection(from pboard: NSPasteboard) -> Bool {
        guard let s = store else { return false }
        let stamp = FileExport.stamp(seconds: true)
        var item: [String: Any]?
        do {
            if let pdf = pboard.data(forType: .pdf) {
                let sha = try s.putFile(name: "Scan \(stamp).pdf", mime: "application/pdf", data: pdf)
                item = ["kind": "file", "sha256": sha, "name": "Scan \(stamp).pdf", "mime": "application/pdf", "size": pdf.count]
            } else if let img = NSImage(pasteboard: pboard), let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) {
                let sha = try s.putFile(name: "Foto \(stamp).jpg", mime: "image/jpeg", data: jpg)
                item = ["kind": "image", "sha256": sha, "name": "Foto \(stamp).jpg"]
            }
        } catch { alert("Übernahme fehlgeschlagen", "\(error)"); return false }
        guard let item, let json = try? JSONSerialization.data(withJSONObject: item), let js = String(data: json, encoding: .utf8) else { return false }
        web.evaluateJavaScript("app.insertReceived(\(js))")
        scheduleOCR()
        return true
    }

    // MARK: Texterkennung im Hintergrund
    /// Arbeitet alle Bilder und PDFs ohne erkannten Text nacheinander ab. Die Datenbank wird nur im Hauptthread angefasst.
    func scheduleOCR() {
        guard !ocrRunning, let s = store, let next = (try? s.pendingOCR())?.first,
              let sha = next["sha256"] as? String, let mime = next["mime"] as? String else { return }
        ocrRunning = true
        let url = s.localURL(sha), root = s.root
        ocrQueue.async {
            let text = OCR.recognize(url: url, mime: mime)
            DispatchQueue.main.async {
                self.ocrRunning = false
                guard let s = self.store, s.root == root else { return }  // Buch inzwischen gewechselt
                try? s.setOCR(sha: sha, text: text)
                self.web.evaluateJavaScript("app.ocrDone && app.ocrDone('\(sha)')")
                self.scheduleOCR()
            }
        }
    }

    // MARK: Sicherung
    func autoBackup(force: Bool = false, reply: ((Any?, String?) -> Void)? = nil) {
        guard let s = store else { return }
        Backup.run(s, force: force, queue: ocrQueue) { r in
            switch r {
            case .success(let info): reply?(info, nil)
            case .failure(let e): reply?(nil, "\(e)"); if reply == nil { NSLog("Laborbuch: Sicherung fehlgeschlagen: \(e)") }
            }
        }
    }

    @objc func backupNow() { web.evaluateJavaScript("app.backupNow()") }

    // MARK: Export und Import
    func exportTarget(_ a: [String: Any]) -> URL? {
        if let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"], testMode { return URL(fileURLWithPath: dir) }
        let p = NSOpenPanel()
        p.title = "Ordner für den Export wählen"; p.prompt = "Exportieren"
        p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true
        return p.runModal() == .OK ? p.url : nil
    }

    /// Schreibt den Export-Ordner: Texte von der Oberfläche, Dateikopien, data/book.json und das .eln-Archiv
    func exportWrite(_ a: [String: Any], _ s: Store, reply: @escaping (Any?, String?) -> Void) {
        guard let parent = exportTarget(a) else { return reply(NSNull(), nil) }
        let dir = parent.appendingPathComponent("\(s.name) – Export \(FileExport.stamp())")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for t in a["texts"] as? [[String: String]] ?? [] { try FileExport.write(t["text"] ?? "", to: try FileExport.safe(t["path"] ?? "", in: dir)) }
            for c in a["copies"] as? [[String: String]] ?? [] {
                guard let sha = c["sha"], sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { continue }
                try FileExport.copy(s.fileURL(sha), to: try FileExport.safe(c["path"] ?? "", in: dir))
            }
            let dump = try JSONSerialization.data(withJSONObject: try s.dump(), options: [.prettyPrinted, .sortedKeys])
            try FileManager.default.createDirectory(at: dir.appendingPathComponent("data"), withIntermediateDirectories: true)
            try dump.write(to: dir.appendingPathComponent("data/book.json"))
            if let eln = a["eln"] as? [String: Any], let folder = eln["folder"] as? String, let meta = eln["metadata"] as? String {
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("laborbuch-eln-\(UUID().uuidString)")
                defer { try? FileManager.default.removeItem(at: tmp) }
                let root = try FileExport.safe(folder, in: tmp)
                try FileExport.write(meta, to: root.appendingPathComponent("ro-crate-metadata.json"))
                for c in eln["copies"] as? [[String: String]] ?? [] {
                    guard let sha = c["sha"], sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { continue }
                    try FileExport.copy(s.fileURL(sha), to: try FileExport.safe(c["path"] ?? "", in: root))
                }
                try FileExport.zipELN(folder: root, to: dir.appendingPathComponent("\(s.name).eln"))
            }
            if !testMode { NSWorkspace.shared.activateFileViewerSelecting([dir]) }
            reply(["path": dir.path], nil)
        } catch { reply(nil, "\(error)") }
    }

    /// Dateien zum Import wählen und lesen. Antwort: Liste von Einträgen für die Oberfläche (die baut daraus die Einträge)
    func importPick(_ a: [String: Any], _ s: Store, reply: @escaping (Any?, String?) -> Void) {
        let urls: [URL]
        if let t = a["testPaths"] as? [String], testMode { urls = t.map { URL(fileURLWithPath: $0) } }
        else {
            let p = NSOpenPanel()
            p.title = "Importieren: .eln (eLabFTW u. a.), Markdown, Word, RTF, ODT, HTML, PDF oder Bilder (Scans)"
            p.allowsMultipleSelection = true; p.canChooseDirectories = false
            guard p.runModal() == .OK else { return reply([], nil) }
            urls = p.urls
        }
        var items: [[String: Any]] = [], scans: [(Int, URL, String)] = []
        do {
            for u in urls {
                let ext = u.pathExtension.lowercased(), title = u.deletingPathExtension().lastPathComponent
                switch ext {
                case "eln", "zip": items += try readELN(u, s)
                case "md", "markdown", "txt": items.append(["kind": "markdown", "title": title, "text": try String(contentsOf: u, encoding: .utf8), "source": u.lastPathComponent])
                case "html", "htm": items.append(["kind": "html", "title": title, "html": try String(contentsOf: u, encoding: .utf8), "source": u.lastPathComponent])
                case "docx", "doc", "rtf", "odt", "rtfd": items.append(["kind": "html", "title": title, "html": try FileExport.documentHTML(u), "source": u.lastPathComponent])
                case "pdf", "png", "jpg", "jpeg", "heic", "tif", "tiff":
                    let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
                    let data = try Data(contentsOf: u)
                    guard data.count <= 50_000_000 else { throw StoreError.invalid("\(u.lastPathComponent) ist größer als 50 MB") }
                    let sha = try s.putFile(name: u.lastPathComponent, mime: mime, data: data)
                    scans.append((items.count, s.fileURL(sha), mime))
                    items.append(["kind": "scan", "title": title, "source": u.lastPathComponent,
                                  "file": ["sha256": sha, "name": u.lastPathComponent, "mime": mime, "size": data.count]])
                default: throw StoreError.invalid("Dateityp nicht unterstützt: \(u.lastPathComponent)")
                }
            }
        } catch { return reply(nil, "\(error)") }
        // Scans: Text sofort erkennen (im Hintergrund), damit er im neuen Eintrag steht
        let root = s.root
        ocrQueue.async {
            let texts = scans.map { ($0.0, $0.2 == "application/pdf" || $0.2.hasPrefix("image/") ? OCR.recognize(url: $0.1, mime: $0.2) : "") }
            DispatchQueue.main.async {
                guard let s = self.store, s.root == root else { return reply(nil, "Laborbuch gewechselt") }
                for (i, t) in texts {
                    items[i]["text"] = t
                    if let sha = (items[i]["file"] as? [String: Any])?["sha256"] as? String { try? s.setOCR(sha: sha, text: t) }
                }
                reply(items, nil)
            }
        }
    }

    /// .eln (RO-Crate): jeder Datensatz unter dem Wurzelordner wird ein Eintrag; Dateien kommen als Anhänge ins Buch
    func readELN(_ zip: URL, _ s: Store) throws -> [[String: Any]] {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("laborbuch-import-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tmp) }
        try FileExport.unzip(zip, to: tmp)
        guard let metaURL = FileManager.default.enumerator(at: tmp, includingPropertiesForKeys: nil)?
                .compactMap({ $0 as? URL }).first(where: { $0.lastPathComponent == "ro-crate-metadata.json" }) else {
            throw StoreError.invalid("\(zip.lastPathComponent): keine ro-crate-metadata.json – kein .eln-Archiv?")
        }
        let base = metaURL.deletingLastPathComponent().standardizedFileURL
        guard let json = try JSONSerialization.jsonObject(with: Data(contentsOf: metaURL)) as? [String: Any],
              let graph = json["@graph"] as? [[String: Any]] else { throw StoreError.invalid("ro-crate-metadata.json ist unlesbar") }
        let byId = Dictionary(graph.compactMap { n in (n["@id"] as? String).map { ($0, n) } }, uniquingKeysWith: { a, _ in a })
        let ids: (Any?) -> [String] = { v in
            if let d = v as? [String: Any], let i = d["@id"] as? String { return [i] }
            return (v as? [[String: Any]])?.compactMap { $0["@id"] as? String } ?? []
        }
        let isType = { (n: [String: Any], t: String) in (n["@type"] as? String) == t || ((n["@type"] as? [String])?.contains(t) ?? false) }
        let rootDS = byId["./"] ?? graph.first { isType($0, "Dataset") }
        let parts = ids(rootDS?["hasPart"]).compactMap { byId[$0] }.filter { isType($0, "Dataset") }
        return try parts.map { ds in
            var files: [[String: Any]] = []
            for fid in ids(ds["hasPart"]) {
                guard let f = byId[fid], isType(f, "File") else { continue }
                let url = base.appendingPathComponent(fid.removingPercentEncoding ?? fid).standardizedFileURL
                guard url.path.hasPrefix(base.path + "/"), let data = try? Data(contentsOf: url), data.count <= 50_000_000 else { continue }  // nichts außerhalb des Archivs
                let name = (f["name"] as? String) ?? url.lastPathComponent
                let declared = (f["encodingFormat"] as? String)?.components(separatedBy: ";")[0].trimmingCharacters(in: .whitespaces)
                let mime = declared.flatMap { $0.range(of: "^[a-z]+/[a-z0-9.+-]+$", options: .regularExpression) != nil ? $0 : nil }
                    ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                files.append(["sha256": try s.putFile(name: name, mime: mime, data: data), "name": name, "mime": mime, "size": data.count])
            }
            let kw = ds["keywords"]
            let tags = (kw as? String)?.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } ?? (kw as? [String]) ?? []
            return ["kind": "eln", "title": (ds["name"] as? String) ?? "Ohne Titel", "html": (ds["text"] as? String) ?? (ds["description"] as? String) ?? "",
                    "tags": tags, "created": (ds["dateCreated"] as? String) ?? "", "source": zip.lastPathComponent, "files": files]
        }
    }

    // MARK: Zeugen-PDF speichern und wieder einlesen
    /// In Tests (LABORBUCH_TESTOUT) ohne Dialog in einen Ordner schreiben
    func savePDF(_ data: Data, name: String, reply: @escaping (Any?, String?) -> Void) {
        let safe = URL(fileURLWithPath: name).lastPathComponent.replacingOccurrences(of: ":", with: "-")
        if let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] {
            let url = URL(fileURLWithPath: dir).appendingPathComponent(safe)
            do { try data.write(to: url); reply(["path": url.path, "bytes": data.count, "pages": PDFDocument(data: data)?.pageCount ?? 0], nil) } catch { reply(nil, "\(error)") }
            return
        }
        let p = NSSavePanel()
        p.nameFieldStringValue = safe
        p.allowedContentTypes = [.pdf]
        p.beginSheetModal(for: window) { r in
            guard r == .OK, let url = p.url else { return reply(NSNull(), nil) }
            do { try data.write(to: url); reply(["path": url.path, "bytes": data.count], nil) } catch { reply(nil, "\(error)") }
        }
    }

    func pickPDF(testPath: String?) -> URL? {
        if let t = testPath, ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] != nil { return URL(fileURLWithPath: t) }
        let p = NSOpenPanel()
        p.title = "Unterschriebenes Zeugen-PDF wählen"
        p.allowedContentTypes = [.pdf]
        return p.runModal() == .OK ? p.url : nil
    }

    // MARK: Menü
    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [(String, Selector?, String)]) {
            let item = NSMenuItem(); main.addItem(item)
            let m = NSMenu(title: title); item.submenu = m
            for (t, sel, key) in items {
                if t == "-" { m.addItem(.separator()); continue }
                if key == "IMPORT" {  // macOS füllt das Untermenü (Foto aufnehmen, Dokumente scannen, Skizze)
                    let i = NSMenuItem(title: t, action: nil, keyEquivalent: "")
                    i.identifier = NSMenuItem.importFromDeviceIdentifier
                    m.addItem(i); continue
                }
                let i = NSMenuItem(title: t, action: sel, keyEquivalent: key)
                if ["Z", "N", "I", "E"].contains(key) { i.keyEquivalentModifierMask = [.command, .shift] }
                m.addItem(i)
            }
        }
        add("Laborbuch", [("Einstellungen …", #selector(showSettings), ","), ("Jetzt sperren", #selector(lockNow), "l"), ("-", nil, ""),
                          ("Laborbuch beenden", #selector(NSApplication.terminate(_:)), "q")])
        add("Ablage", [("Neuer Eintrag", #selector(newEntry), "n"), ("Revision sichern", #selector(snapshotNow), "s"), ("-", nil, ""),
                       ("Neues Laborbuch …", #selector(newBook), "N"), ("Laborbuch öffnen …", #selector(openBook), "o"),
                       ("Im Finder zeigen", #selector(revealBook), ""), ("-", nil, ""),
                       ("Vom iPhone oder iPad importieren", nil, "IMPORT"), ("Importieren …", #selector(importFiles), "I"),
                       ("Laborbuch exportieren …", #selector(exportBook), "E"), ("Eintrag als PDF …", #selector(entryPDF), "p"),
                       ("Eintrag als PDF/A …", #selector(entryPDFA), ""), ("Jetzt sichern", #selector(backupNow), ""), ("-", nil, ""),
                       ("Schließen", #selector(NSWindow.performClose(_:)), "w")])
        add("Bearbeiten", [("Widerrufen", Selector(("undo:")), "z"), ("Wiederholen", Selector(("redo:")), "Z"), ("-", nil, ""),
                           ("Ausschneiden", #selector(NSText.cut(_:)), "x"), ("Kopieren", #selector(NSText.copy(_:)), "c"),
                           ("Einsetzen", #selector(NSText.paste(_:)), "v"), ("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
                           ("-", nil, ""), ("Suchen", #selector(focusSearch), "f")])
        add("Test", [("Leistungstest (5.000 Wörter, 20 Bilder)", #selector(perfTest), "")])
        add("Fenster", [("Minimieren", #selector(NSWindow.performMiniaturize(_:)), "m")])
        NSApp.mainMenu = main
    }
    // Gesperrt: nur Beenden und Sperren bleiben im Menü aktiv
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        !(locker?.locked ?? false) || item.action == #selector(NSApplication.terminate(_:)) || item.action == #selector(lockNow)
    }
    @objc func importFiles() { web.evaluateJavaScript("app.importFiles()") }
    @objc func exportBook() { web.evaluateJavaScript("app.exportBook()") }
    @objc func entryPDF() { web.evaluateJavaScript("app.exportEntryPDF(false)") }
    @objc func entryPDFA() { web.evaluateJavaScript("app.exportEntryPDF(true)") }
    @objc func showSettings() { if !locker.locked { web.evaluateJavaScript("app.settings()") } }
    @objc func lockNow() { locker.lock() }
    @objc func newEntry() { web.evaluateJavaScript("app.newEntry()") }
    @objc func snapshotNow() { web.evaluateJavaScript("app.snapshot()") }
    @objc func focusSearch() { web.evaluateJavaScript("app.focusSearch()") }
    @objc func perfTest() { web.evaluateJavaScript("app.perfTest()") }

    // MARK: Lebenszyklus – vor dem Beenden letzten Stand speichern und Revisionen sichern
    func windowWillClose(_ n: Notification) { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        web.evaluateJavaScript("app.flush()") { _, _ in
            try? self.store?.snapshotAll()
            app.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: WebView – Dialoge und externe Links
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Abbrechen")
        done(a.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = m; a.runModal(); done()
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = p
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Abbrechen")
        a.window.initialFirstResponder = field
        done(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.scheme == "http" || u.scheme == "https" { NSWorkspace.shared.open(u); return decisionHandler(.cancel) }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
