// Dünne Swift-Schicht: Fenster, WebView, Schema lab:// für Oberfläche und Anhänge, Brücke JS ↔ Swift.
import Cocoa
import CoreSpotlight
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

/// Ein Fenster (oder Tab) mit eigener Oberfläche; alle zeigen dasselbe Laborbuch
final class DocWindow {
    let window: NSWindow
    let web: WKWebView
    var flushed = false  // vor dem Schließen gespeichert
    init(window: NSWindow, web: WKWebView) { self.window = window; self.web = web }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
    var docs: [DocWindow] = []
    /// Fenster, auf das sich Menübefehle beziehen
    var current: DocWindow? { docs.first { $0.window.isKeyWindow } ?? docs.first { $0.window.isMainWindow } ?? docs.first }
    var window: NSWindow! { current?.window }
    var web: WKWebView! { current?.web }
    var store: Store?
    var scheme: SchemeHandler!
    var locker: Locker!
    var pendingOpen: URL?  // per Doppelklick im Finder übergeben, bevor das Fenster steht
    let ocrQueue = DispatchQueue(label: "de.felix.laborbuch.ocr", qos: .utility)
    var ocrRunning = false
    var testStarted = false
    var pendingRelease: Updater.Release?
    let testMode = ["--selftest", "--perftest", "--updatetest"].contains { CommandLine.arguments.contains($0) }

    func applicationDidFinishLaunching(_ n: Notification) {
        let start = pendingOpen ?? Self.lastBook() ?? Self.defaultBook()
        do { store = try Store(root: start) } catch {
            // Letztes Buch fehlt oder ist kaputt: auf das Standard-Buch ausweichen statt die App zu beenden
            do { store = try Store(root: Self.defaultBook()) } catch { fail("Laborbuch lässt sich nicht öffnen: \(error)") }
            alert("„\(start.lastPathComponent)“ lässt sich nicht öffnen", "\(error)")
        }
        remember()
        buildMenu()
        scheme = SchemeHandler(web: Bundle.main.resourceURL!.appendingPathComponent("web"), store: { [weak self] in self?.store })
        let first = makeDoc(entry: nil)
        first.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        scheduleOCR()
        if !testMode {
            autoBackup()
            Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in self?.autoBackup() }
        }
        locker = Locker(windows: { [weak self] in self?.docs.map(\.window) ?? [] }, disabled: testMode)
        locker.lockIfEnabled()
    }

    // MARK: Fenster und Tabs
    /// Neues Fenster; entry: diesen Eintrag statt des neuesten öffnen
    @discardableResult
    func makeDoc(entry: Int?) -> DocWindow {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(scheme, forURLScheme: "lab")
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "lab")
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.navigationDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.minSize = NSSize(width: 760, height: 480)
        w.contentView = web
        w.delegate = self
        w.isReleasedWhenClosed = false
        w.tabbingIdentifier = "laborbuch"
        if docs.isEmpty {
            w.setFrameAutosaveName("LaborbuchMain")
            if !w.setFrameUsingName("LaborbuchMain") { w.center() }
        } else if let last = current?.window {
            w.setFrame(last.frame, display: false)
            w.setFrameTopLeftPoint(w.cascadeTopLeft(from: NSPoint(x: last.frame.minX, y: last.frame.maxY)))
        }
        let d = DocWindow(window: w, web: web)
        docs.append(d)
        updateTitle()
        web.load(URLRequest(url: URL(string: "lab://app/index.html" + (entry.map { "?entry=\($0)" } ?? ""))!))
        if locker?.locked == true { locker.lockWindow(w) }
        return d
    }

    @objc func newWindow() { makeDoc(entry: nil).window.makeKeyAndOrderFront(nil) }

    @objc func newTab() { openTab(entry: nil) }

    func openTab(entry: Int?) {
        let host = current?.window
        let d = makeDoc(entry: entry)
        if let host { host.addTabbedWindow(d.window, ordered: .above) }
        d.window.makeKeyAndOrderFront(nil)
    }

    /// Nach dem Speichern in einem Fenster die anderen informieren (gleicher Eintrag dort offen?)
    func broadcast(except sender: WKWebView?, _ js: String) {
        for d in docs where d.web !== sender { d.web.evaluateJavaScript(js) }
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
        if let s = store { try? QuickLookWriter.write(s) }
        guard let s = store, ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] == nil else { return }
        UserDefaults.standard.set(s.root.path, forKey: "lastBook")
        var paths = UserDefaults.standard.dictionary(forKey: "bookPaths") as? [String: String] ?? [:]
        paths[s.bookID] = s.root.path  // damit ein Treffer aus Spotlight das richtige Buch findet
        UserDefaults.standard.set(paths, forKey: "bookPaths")
        NSDocumentController.shared.noteNewRecentDocumentURL(s.root)
        Spotlight.reindex(s)
    }

    /// Klick auf einen Spotlight-Treffer
    func application(_ app: NSApplication, continue activity: NSUserActivity, restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        guard activity.activityType == CSSearchableItemActionType,
              let ident = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String, let t = Spotlight.parse(ident) else { return false }
        if store?.bookID == t.book { web.evaluateJavaScript("app.openEntry(\(t.entry))"); return true }
        guard let path = (UserDefaults.standard.dictionary(forKey: "bookPaths") as? [String: String])?[t.book] else {
            alert("Laborbuch nicht gefunden", "Das Buch zu diesem Treffer ist auf diesem Mac nicht bekannt."); return true
        }
        switchBook(to: URL(fileURLWithPath: path), entry: t.entry)
        return true
    }

    func updateTitle() { for d in docs { d.window.title = store.map { "\($0.name) – Laborbuch" } ?? "Laborbuch" } }

    /// Alle Fenster speichern lassen, dann weiter
    func flushAll(_ then: @escaping () -> Void) {
        let g = DispatchGroup()
        for d in docs { g.enter(); d.web.evaluateJavaScript("app.flush()") { _, _ in g.leave() } }
        g.notify(queue: .main, execute: then)
    }

    /// Wechselt das Buch: offenen Stand sichern, neues Buch öffnen, Oberfläche neu laden.
    func switchBook(to url: URL, entry: Int? = nil) {
        guard url.pathExtension == "laborbuch" else { return alert("Kein Laborbuch", "Bitte einen Ordner mit der Endung .laborbuch wählen.") }
        if url.standardizedFileURL == store?.root.standardizedFileURL { return }
        let open = { [self] in
            do {
                let s = try Store(root: url)
                try? store?.snapshotAll()
                store = s
                remember(); updateTitle()
                for (i, d) in docs.enumerated() { d.web.load(URLRequest(url: URL(string: "lab://app/index.html" + (i == 0 && entry != nil ? "?entry=\(entry!)" : ""))!)) }
                scheduleOCR()
            } catch { alert("„\(url.lastPathComponent)“ lässt sich nicht öffnen", "\(error)") }
        }
        if docs.isEmpty { pendingOpen = url; return }
        flushAll(open)
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
        if let u = urls.first(where: { $0.scheme == "laborbuch" }) { return openScanned(u.absoluteString) }  // Link vom Etikett
        if let u = urls.first(where: { $0.pathExtension == "laborbuch" }) { switchBook(to: u) }
    }

    /// Gescannten Code öffnen; gehört er zu einem anderen bekannten Buch, wird erst gewechselt
    func openScanned(_ code: String) {
        guard let t = QR.target(code) else { return alert("Unbekannter Code", code) }
        if let b = t["book"] as? String, !b.isEmpty, b != store?.bookID {
            guard let path = (UserDefaults.standard.dictionary(forKey: "bookPaths") as? [String: String])?[b] else {
                return alert("Anderes Laborbuch", "Dieses Etikett gehört zu einem Laborbuch, das auf diesem Mac nicht bekannt ist.")
            }
            switchBook(to: URL(fileURLWithPath: path))
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.openScanned(code) }
            return
        }
        let js = (try? JSONSerialization.data(withJSONObject: code)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
        web.evaluateJavaScript("app.openCode(\(js))")
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func scanLabel() { web.evaluateJavaScript("app.scan()") }

    func alert(_ title: String, _ text: String) {
        let a = NSAlert(); a.messageText = title; a.informativeText = text; a.runModal()
    }

    /// `--perftest` / `--selftest`: Test in der echten WebView ausführen, Ergebnis ausgeben, beenden (Abnahme ohne Bedienung).
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        guard !testStarted, w === docs.first?.web else { return }  // nur einmal, nur im ersten Fenster
        if CommandLine.arguments.contains("--updatetest") { testStarted = true; return runUpdateTest() }
        let args = CommandLine.arguments
        let js = args.contains("--perftest") ? "await app.perfTest(); return window.perfResult.join('\\n')"
            : args.contains("--selftest") ? "await new Promise(r => setTimeout(r, 300)); return (await app.selfTest()).join('\\n')" : nil
        guard let js else { return }
        testStarted = true
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
                              "fingerprint": Keys.fingerprint() ?? NSNull(), "backupDir": Backup.dir(for: s).path, "version": Updater.current,
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
            case "testProgress":  // Testmodus: Zwischenstand sofort ausgeben (hängt ein Test, sieht man wo)
                guard testMode else { throw StoreError.invalid("Nur im Testmodus") }
                FileHandle.standardError.write(Data("… \(try str("line"))\n".utf8))
                replyHandler(true, nil)
            case "testOther":  // Testmodus: JavaScript in einem anderen Fenster ausführen (Tabs/Fenster prüfen)
                guard testMode else { throw StoreError.invalid("Nur im Testmodus") }
                guard let other = docs.first(where: { $0.web !== m.webView }) else { return replyHandler(["windows": docs.count], nil) }
                other.web.callAsyncJavaScript(try str("js"), arguments: [:], in: nil, in: .page) { r in
                    switch r { case .success(let v): replyHandler(["windows": self.docs.count, "value": v], nil)
                               case .failure(let e): replyHandler(nil, "\(e)") }
                }
            case "updateCheck":
                let ci = Updater.canInstall
                Updater.check { r in
                    switch r {
                    case .failure(let e): replyHandler(nil, "\(e)")
                    case .success(let found):
                        let rel: Updater.Release? = found
                        self.pendingRelease = rel
                        let latest: String = rel?.version ?? Updater.current
                        replyHandler(["current": Updater.current, "latest": latest, "available": rel != nil,
                                      "canInstall": ci.ok, "reason": ci.reason ?? ""], nil)
                    }
                }
            case "updateInstall":
                guard let rel = pendingRelease else { throw StoreError.invalid("Erst nach Updates suchen") }
                let ci = Updater.canInstall
                guard ci.ok else { throw StoreError.invalid(ci.reason ?? "Update nicht möglich") }
                Updater.install(rel, progress: { [weak self] st in self?.broadcast(except: nil, "app.updateProgress && app.updateProgress('\(st)')") }) { err in
                    if let err { return replyHandler(nil, "\(err)") }
                    replyHandler(true, nil)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) }  // speichert, dann tauscht das Skript
                }
            case "testQuickLook":  // Testmodus: Vorschau schreiben und mit qlmanage prüfen, was macOS daraus macht
                guard testMode else { throw StoreError.invalid("Nur im Testmodus") }
                try QuickLookWriter.write(s)
                let out = FileManager.default.temporaryDirectory.appendingPathComponent("lb-ql-\(UUID().uuidString)")
                try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
                try FileExport.run("/usr/bin/qlmanage", ["-p", "-o", out.path, s.root.path])
                try FileExport.run("/usr/bin/qlmanage", ["-t", "-s", "256", "-o", out.path, s.root.path])
                let urlFile = out.appendingPathComponent("\(s.root.lastPathComponent).qlpreview/Preview.url")
                let previewURL = (try? String(contentsOf: urlFile, encoding: .utf8)) ?? ""
                let thumb = FileManager.default.fileExists(atPath: out.appendingPathComponent("\(s.root.lastPathComponent).png").path)
                let html = (try? String(contentsOf: s.root.appendingPathComponent("QuickLook/Preview.html"), encoding: .utf8)) ?? ""
                replyHandler(["previewURL": previewURL, "thumbnail": thumb, "html": html], nil)
            case "testSpotlight":  // Testmodus: Buch indizieren, per Spotlight-Abfrage suchen, Index wieder löschen
                guard testMode else { throw StoreError.invalid("Nur im Testmodus") }
                let needle = try str("title"), book = s.bookID
                Spotlight.reindex(s) { err in
                    if let err { return replyHandler(nil, "Indizieren: \(err)") }
                    var found = 0, tries = 0
                    func ask() {
                        let q = CSSearchQuery(queryString: "title == \"\(needle)\"", queryContext: { let c = CSSearchQueryContext(); c.fetchAttributes = ["title"]; return c }())
                        q.foundItemsHandler = { found += $0.count }
                        q.completionHandler = { _ in DispatchQueue.main.async {
                            tries += 1
                            if found > 0 || tries >= 20 { Spotlight.remove(book: book) { replyHandler(["found": found, "tries": tries], nil) } }
                            else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: ask) }
                        } }
                        q.start()
                    }
                    ask()
                }
            case "testWriteText", "testWriteBase64", "testReadText", "testList":
                guard testMode, let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"] else { throw StoreError.invalid("Nur im Testmodus") }
                let base = URL(fileURLWithPath: dir)
                if cmd == "testList" { return replyHandler(FileManager.default.enumerator(atPath: base.path)?.allObjects as? [String] ?? [], nil) }
                let url = try FileExport.safe(try str(cmd == "testReadText" ? "path" : "name"), in: base)
                if cmd == "testReadText" { return replyHandler(try String(contentsOf: url, encoding: .utf8), nil) }
                let data = cmd == "testWriteText" ? Data(try str("text").utf8) : Data(base64Encoded: try str("base64")) ?? Data()
                try data.write(to: url)
                replyHandler(url.path, nil)
            case "testSnapshot":  // Testmodus: Bild der Oberfläche ablegen (zum Ansehen neuer Ansichten)
                guard testMode, let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"], let wv = m.webView else { throw StoreError.invalid("Nur im Testmodus") }
                let url = try FileExport.safe(try str("name"), in: URL(fileURLWithPath: dir))
                wv.takeSnapshot(with: nil) { img, err in
                    guard let img, let tiff = img.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                        return replyHandler(nil, err.map { "\($0)" } ?? "Kein Bild")
                    }
                    do { try png.write(to: url); replyHandler(url.path, nil) } catch { replyHandler(nil, "\(error)") }
                }
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
            case "trash": replyHandler(try s.trash(), nil)
            case "trashEntry":
                let id = try int("id")
                try s.trashEntry(id: id)
                if !testMode { CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ["\(s.bookID)/\(id)"]) }
                broadcast(except: m.webView, "app.externalChange && app.externalChange(\(id))")
                replyHandler(true, nil)
            case "restoreEntry":
                let id = try int("id")
                try s.restoreEntry(id: id)
                if !testMode { Spotlight.update(s, id: id) }
                replyHandler(true, nil)
            case "purgeEntry": try s.purgeEntry(id: try int("id")); replyHandler(true, nil)
            case "emptyTrash": replyHandler(try s.emptyTrash(), nil)
            case "qr":
                guard let png = QR.png(try str("text")) else { throw StoreError.invalid("QR-Code ließ sich nicht erzeugen") }
                replyHandler(png.base64EncodedString(), nil)
            case "labelsPDF":
                WitnessPDF.make(html: try str("html"), hash: "", scheme: scheme, noMargins: true) { [weak self] r in
                    switch r {
                    case .failure(let e): replyHandler(nil, "\(e)")
                    case .success(let data): self?.savePDF(data, name: (a["name"] as? String) ?? "Etiketten.pdf", reply: replyHandler)
                    }
                }
            case "scan":
                ScannerWindow.open(found: { [weak self] code in self?.openScanned(code) }, failed: { [weak self] msg in self?.alert("Scannen", msg) })
                replyHandler(true, nil)
            case "resolveCode":  // gescannter oder getippter Code → Ziel
                guard var t = QR.target(try str("code")) else { return replyHandler(NSNull(), nil) }
                if t["t"] as? String == "code" {
                    guard let id = try s.entityID(code: t["code"] as! String) else { return replyHandler(NSNull(), nil) }
                    t = ["t": "entity", "id": id, "book": ""]
                }
                if let b = t["book"] as? String, !b.isEmpty, b != s.bookID { t["otherBook"] = true }
                replyHandler(t, nil)
            case "bookID": replyHandler(s.bookID, nil)
            case "testDecodeQR":  // Testmodus: Bild wie ein Kamerabild auswerten
                guard testMode, let d = Data(base64Encoded: try str("base64")), let img = NSImage(data: d),
                      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw StoreError.invalid("Nur im Testmodus / Bild unlesbar") }
                replyHandler(QR.detect(in: cg), nil)
            case "resultSchemas": replyHandler(try s.resultSchemas(), nil)
            case "saveResultSchema": replyHandler(try s.saveResultSchema(id: a["id"] as? Int, name: try str("name"), fields: a["fields"] as? [[String: Any]] ?? []), nil)
            case "resultRows":
                replyHandler(try s.resultRows(schema: try int("schema"), project: a["project"] as? Int, from: a["from"] as? String, to: a["to"] as? String), nil)
            case "saveText":  // z. B. CSV aus der Auswertung
                let name = URL(fileURLWithPath: try str("name")).lastPathComponent, data = Data(try str("text").utf8)
                if let dir = ProcessInfo.processInfo.environment["LABORBUCH_TESTOUT"], testMode {
                    let u = URL(fileURLWithPath: dir).appendingPathComponent(name); try data.write(to: u); return replyHandler(["path": u.path], nil)
                }
                let p = NSSavePanel(); p.nameFieldStringValue = name
                p.beginSheetModal(for: window) { r in
                    guard r == .OK, let u = p.url else { return replyHandler(NSNull(), nil) }
                    do { try data.write(to: u); replyHandler(["path": u.path], nil) } catch { replyHandler(nil, "\(error)") }
                }
            case "locations": replyHandler(try s.locations().map { l in var l = l; l["path"] = try s.locationPath(l["id"] as? Int); return l }, nil)
            case "saveLocation":
                replyHandler(try s.saveLocation(id: a["id"] as? Int, parent: a["parent"] as? Int, name: try str("name"), kind: (a["kind"] as? String) ?? "ort",
                                                rows: a["rows"] as? Int, cols: a["cols"] as? Int, temp: (a["temp"] as? String) ?? ""), nil)
            case "lots": replyHandler(try s.lots(filter: (a["filter"] as? String) ?? "all", q: (a["q"] as? String) ?? ""), nil)
            case "lot": replyHandler(try s.lot(id: try int("id")), nil)
            case "saveLot": replyHandler(try s.saveLot(id: a["id"] as? Int, values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "moveLot":
                guard let delta = Store.number(a["delta"]) else { throw StoreError.invalid("Menge fehlt") }
                replyHandler(try s.moveLot(id: try int("id"), delta: delta, kind: try str("kind"), entry: a["entry"] as? Int,
                                           note: (a["note"] as? String) ?? "", author: Settings.author), nil)
            case "stockWarnings": replyHandler(try s.warningCount(), nil)
            case "cultures": replyHandler(try s.cultures(filter: (a["filter"] as? String) ?? "active", q: (a["q"] as? String) ?? ""), nil)
            case "culture": replyHandler(try s.culture(id: try int("id")), nil)
            case "saveCulture": replyHandler(try s.saveCulture(id: a["id"] as? Int, values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "cultureEvent":
                replyHandler(try s.cultureEvent(id: try int("id"), kind: try str("kind"), values: a["values"] as? [String: Any] ?? [:], entry: a["entry"] as? Int, author: Settings.author), nil)
            case "frozenStock": replyHandler(try s.frozenStock(), nil)
            case "thawCulture": replyHandler(try s.thawCulture(lot: try int("lot"), name: a["name"] as? String, entry: a["entry"] as? Int, author: Settings.author), nil)
            case "devices": replyHandler(try s.devices(filter: (a["filter"] as? String) ?? "all", q: (a["q"] as? String) ?? ""), nil)
            case "device": replyHandler(try s.device(id: try int("id")), nil)
            case "saveDevice": replyHandler(try s.saveDevice(id: a["id"] as? Int, values: a["values"] as? [String: Any] ?? [:]), nil)
            case "saveDeviceTask": replyHandler(try s.saveDeviceTask(id: a["id"] as? Int, device: try int("device"), values: a["values"] as? [String: Any] ?? [:]), nil)
            case "archiveDeviceTask": try s.archiveDeviceTask(id: try int("id")); replyHandler(true, nil)
            case "logDevice":
                replyHandler(try s.logDevice(id: try int("id"), task: a["task"] as? Int, kind: a["kind"] as? String, result: a["result"] as? String,
                                             values: a["values"] as? [String: Any] ?? [:], entry: a["entry"] as? Int, author: Settings.author), nil)
            case "careWarnings": replyHandler(try s.careWarnings(), nil)
            case "purchaseSuggestions": replyHandler(try s.purchaseSuggestions(), nil)
            case "purchases": replyHandler(try s.purchases(filter: (a["filter"] as? String) ?? "open"), nil)
            case "purchase": replyHandler(try s.purchase(id: try int("id")), nil)
            case "createPurchase": replyHandler(try s.createPurchase(values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "setPurchaseStatus": replyHandler(try s.setPurchaseStatus(id: try int("id"), status: try str("status"), note: (a["note"] as? String) ?? "", author: Settings.author), nil)
            case "receivePurchase": replyHandler(try s.receivePurchase(id: try int("id"), values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "purchaseCounts": replyHandler(try s.purchaseCounts(), nil)
            case "seqAnnotation": replyHandler(try s.seqAnnotation(entity: try int("entity"), field: try str("field")), nil)
            case "setSeqAnnotation":
                replyHandler(try s.setSeqAnnotation(entity: try int("entity"), field: try str("field"), circular: a["circular"] as? Bool ?? false,
                                                    features: a["features"] as? [[String: Any]] ?? [], source: (a["source"] as? String) ?? ""), nil)
            case "sequenceObjects": replyHandler(try s.sequenceObjects(), nil)
            case "types": replyHandler(try s.types(), nil)
            case "saveType":
                replyHandler(try s.saveType(id: a["id"] as? Int, name: try str("name"), prefix: try str("prefix"), icon: (a["icon"] as? String) ?? "",
                                            fields: a["fields"] as? [[String: Any]] ?? []), nil)
            case "archiveType": try s.archiveType(id: try int("id"), archived: a["archived"] as? Bool ?? true); replyHandler(true, nil)
            case "entities": replyHandler(try s.entities(typeId: a["type"] as? Int, q: (a["q"] as? String) ?? "", archived: a["archived"] as? Bool ?? false), nil)
            case "entity": replyHandler(try s.entity(id: try int("id")), nil)
            case "createEntity": replyHandler(try s.createEntity(typeId: try int("type"), name: try str("name"), values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "updateEntity": replyHandler(try s.updateEntity(id: try int("id"), name: try str("name"), values: a["values"] as? [String: Any] ?? [:], author: Settings.author), nil)
            case "archiveEntity": try s.archiveEntity(id: try int("id"), archived: a["archived"] as? Bool ?? true); replyHandler(true, nil)
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
            case "save":
                let id = try int("id")
                replyHandler(try s.saveDraft(id: id, title: try str("title"), json: try str("json"), text: try str("text"),
                                             links: a["links"] as? [Int] ?? [], files: a["files"] as? [String] ?? [], entities: a["entities"] as? [Int] ?? [],
                                             results: a["results"] as? [[String: Any]] ?? []), nil)
                broadcast(except: m.webView, "app.externalChange && app.externalChange(\(id))")
                if !testMode { Spotlight.update(s, id: id) }
                scheduleQuickLook()
            case "openInTab": openTab(entry: try int("id")); replyHandler(true, nil)
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
        } catch {
            Log.error("\(cmd): \(error)")
            replyHandler(nil, "\(error)")
        }
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

    /// `--updatetest`: nach Update suchen und installieren, Fortschritt ausgeben (für den Test 1.0 → 1.1)
    func runUpdateTest() {
        print("Version \(Updater.current)"); fflush(stdout)
        Updater.check { r in
            guard case .success(let rel?) = r else { print("Kein Update: \(r)"); fflush(stdout); NSApp.terminate(nil); return }
            print("Gefunden: \(rel.version)"); fflush(stdout)
            Updater.install(rel, progress: { print("Schritt: \($0)"); fflush(stdout) }) { err in
                print(err.map { "Fehler: \($0)" } ?? "Bereit, beende für den Austausch"); fflush(stdout)
                NSApp.terminate(nil)
            }
        }
    }

    // MARK: Quick Look (Vorschau im Finder), höchstens alle 30 s neu schreiben
    var qlTimer: Timer?
    func scheduleQuickLook() {
        guard qlTimer == nil else { return }
        qlTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            self?.qlTimer = nil
            if let s = self?.store { try? QuickLookWriter.write(s) }
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
                if ["Z", "N", "I", "E", "K"].contains(key) { i.keyEquivalentModifierMask = [.command, .shift] }
                if key == "NW" { i.keyEquivalent = "n"; i.keyEquivalentModifierMask = [.command, .option] }
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
                       ("Eintrag als PDF/A …", #selector(entryPDFA), ""), ("In den Papierkorb", #selector(trashEntry), ""), ("Etikett scannen …", #selector(scanLabel), "K"), ("Jetzt sichern", #selector(backupNow), ""), ("-", nil, ""),
                       ("Schließen", #selector(NSWindow.performClose(_:)), "w")])
        add("Bearbeiten", [("Widerrufen", Selector(("undo:")), "z"), ("Wiederholen", Selector(("redo:")), "Z"), ("-", nil, ""),
                           ("Ausschneiden", #selector(NSText.cut(_:)), "x"), ("Kopieren", #selector(NSText.copy(_:)), "c"),
                           ("Einsetzen", #selector(NSText.paste(_:)), "v"), ("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
                           ("-", nil, ""), ("Suchen", #selector(focusSearch), "f")])
        add("Test", [("Leistungstest (5.000 Wörter, 20 Bilder)", #selector(perfTest), "")])
        add("Fenster", [("Neues Fenster", #selector(newWindow), "NW"), ("Neuer Tab", #selector(newTab), "t"), ("-", nil, ""),
                        ("Minimieren", #selector(NSWindow.performMiniaturize(_:)), "m")])
        NSApp.mainMenu = main
    }
    // Gesperrt: nur Beenden und Sperren bleiben im Menü aktiv
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        !(locker?.locked ?? false) || item.action == #selector(NSApplication.terminate(_:)) || item.action == #selector(lockNow)
    }
    @objc func trashEntry() { web.evaluateJavaScript("app.trashEntry()") }
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
    /// Vor dem Schließen den Stand dieses Fensters speichern
    func windowShouldClose(_ w: NSWindow) -> Bool {
        guard let d = docs.first(where: { $0.window === w }), !d.flushed else { return true }
        d.web.evaluateJavaScript("app.flush()") { _, _ in d.flushed = true; w.close() }
        return false
    }
    func windowWillClose(_ n: Notification) {
        docs.removeAll { $0.window === n.object as? NSWindow }
        if docs.isEmpty { NSApp.terminate(nil) }  // letztes Fenster zu: App beenden (Revisionen werden gesichert)
    }
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        flushAll {
            try? self.store?.snapshotAll()
            if let s = self.store { try? QuickLookWriter.write(s) }
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

/// Fehlerprotokoll unter ~/Library/Logs/Laborbuch/app.log (für die Fehlersuche, ohne Inhalte der Einträge)
enum Log {
    static let url = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Laborbuch/app.log")
    static func error(_ msg: String) {
        if ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] != nil { return }  // Tests schreiben nicht ins Protokoll der App
        let line = "\(Store.now()) [\(Updater.current)] \(msg)\n"
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
        else { try? Data(line.utf8).write(to: url) }
    }
}
