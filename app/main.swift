// Dünne Swift-Schicht: Fenster, WebView, Schema lab:// für Oberfläche und Anhänge, Brücke JS ↔ Swift.
import Cocoa
import WebKit

/// Liefert die Oberfläche (lab://app/…) und Anhänge (lab://files/<sha256>) aus, ohne file:// freizugeben.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let web: URL
    let store: () -> Store?
    init(web: URL, store: @escaping () -> Store?) { self.web = web; self.store = store }

    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var file: URL?, mime = "application/octet-stream"
        if url.host == "app" {
            let rel = url.path == "/" || url.path.isEmpty ? "index.html" : String(url.path.dropFirst())
            let f = web.appendingPathComponent(rel).standardizedFileURL
            if f.path.hasPrefix(web.standardizedFileURL.path + "/") { file = f }
            mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "png": "image/png"][f.pathExtension] ?? mime
        } else if url.host == "files", let s = store() {
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

    func applicationDidFinishLaunching(_ n: Notification) {
        do { store = try Store(root: Self.defaultBook()) } catch { fail("Laborbuch lässt sich nicht öffnen: \(error)") }
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
        window.title = "Laborbuch"
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("LaborbuchMain")
        if !window.setFrameUsingName("LaborbuchMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: URL(string: "lab://app/index.html")!))
    }

    /// M0: ein Standard-Buch unter Application Support. Mehrere Bücher und „Öffnen …" kommen in M1.
    static func defaultBook() -> URL {
        if let p = ProcessInfo.processInfo.environment["LABORBUCH_BOOK"] { return URL(fileURLWithPath: p) }  // für Tests
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Laborbuch/Standard.laborbuch")
    }

    /// `--perftest`: Leistungstest in der echten WebView ausführen, Ergebnis ausgeben, beenden (M0-Abnahme ohne Bedienung).
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        guard CommandLine.arguments.contains("--perftest") else { return }
        w.callAsyncJavaScript("await app.perfTest(); return window.perfResult.join('\\n')", arguments: [:], in: nil, in: .page) { r in
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
            case "list": replyHandler(try s.list(), nil)
            case "create": replyHandler(try s.create(title: (a["title"] as? String) ?? ""), nil)
            case "load": replyHandler(try s.load(id: try int("id")), nil)
            case "save": replyHandler(try s.saveDraft(id: try int("id"), title: try str("title"), json: try str("json"), text: try str("text")), nil)
            case "snapshot": replyHandler(try s.snapshot(id: try int("id")) ?? NSNull(), nil)
            case "history": replyHandler(try s.history(id: try int("id")), nil)
            case "verify": replyHandler(try s.verify(id: try int("id")), nil)
            case "search": replyHandler(try s.search(try str("q")), nil)
            case "putFile":
                guard let data = Data(base64Encoded: try str("base64")) else { throw StoreError.invalid("Datei unlesbar") }
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
                if key == "Z" { i.keyEquivalentModifierMask = [.command, .shift] }
                m.addItem(i)
            }
        }
        add("Laborbuch", [("Laborbuch beenden", #selector(NSApplication.terminate(_:)), "q")])
        add("Ablage", [("Neuer Eintrag", #selector(newEntry), "n"), ("Revision sichern", #selector(snapshotNow), "s"), ("-", nil, ""),
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
