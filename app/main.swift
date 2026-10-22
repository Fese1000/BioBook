// Dünne Swift-Schicht: Fenster, WebView, Schema lab:// für Oberfläche und Anhänge, Brücke JS ↔ Swift.
import Cocoa
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
            if sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil { file = s.fileURL(sha); mime = s.mime(sha) }
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

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var store: Store?
    var pendingOpen: URL?  // per Doppelklick im Finder übergeben, bevor das Fenster steht

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
        cfg.setURLSchemeHandler(SchemeHandler(web: res, store: { [weak self] in self?.store }), forURLScheme: "lab")
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
            default: replyHandler(nil, "Unbekannter Befehl: \(cmd)")
            }
        } catch { replyHandler(nil, "\(error)") }
    }

    // MARK: Menü
    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [(String, Selector?, String)]) {
            let item = NSMenuItem(); main.addItem(item)
            let m = NSMenu(title: title); item.submenu = m
            for (t, sel, key) in items {
                if t == "-" { m.addItem(.separator()); continue }
                let i = NSMenuItem(title: t, action: sel, keyEquivalent: key)
                if key == "Z" || key == "N" { i.keyEquivalentModifierMask = [.command, .shift] }
                m.addItem(i)
            }
        }
        add("Laborbuch", [("Laborbuch beenden", #selector(NSApplication.terminate(_:)), "q")])
        add("Ablage", [("Neuer Eintrag", #selector(newEntry), "n"), ("Revision sichern", #selector(snapshotNow), "s"), ("-", nil, ""),
                       ("Neues Laborbuch …", #selector(newBook), "N"), ("Laborbuch öffnen …", #selector(openBook), "o"),
                       ("Im Finder zeigen", #selector(revealBook), ""), ("-", nil, ""),
                       ("Schließen", #selector(NSWindow.performClose(_:)), "w")])
        add("Bearbeiten", [("Widerrufen", Selector(("undo:")), "z"), ("Wiederholen", Selector(("redo:")), "Z"), ("-", nil, ""),
                           ("Ausschneiden", #selector(NSText.cut(_:)), "x"), ("Kopieren", #selector(NSText.copy(_:)), "c"),
                           ("Einsetzen", #selector(NSText.paste(_:)), "v"), ("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
                           ("-", nil, ""), ("Suchen", #selector(focusSearch), "f")])
        add("Test", [("Leistungstest (5.000 Wörter, 20 Bilder)", #selector(perfTest), "")])
        add("Fenster", [("Minimieren", #selector(NSWindow.performMiniaturize(_:)), "m")])
        NSApp.mainMenu = main
    }
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
