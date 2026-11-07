// Automatisierung: AppleScript-Befehle (BioBook.sdef), biobook://-Aktionen für Kurzbefehle und der Dienst „Neuer BioBook-Eintrag“.
// Die eigentliche Arbeit machen die Store-Funktionen in AutomationStore.swift; hier nur die Anbindung an macOS.
import AppKit

// MARK: AppleScript
enum Automation {
    static var delegate: AppDelegate? { NSApp.delegate as? AppDelegate }
    static func changed(_ id: Int) { delegate?.broadcast(except: nil, "app.externalChange && app.externalChange(\(id))") }

    /// Gemeinsamer Rahmen: Buch holen, Fehler als AppleScript-Fehler melden
    static func run(_ cmd: NSScriptCommand, _ body: (Store) throws -> Any?) -> Any? {
        guard let s = delegate?.store else { cmd.scriptErrorNumber = -1728; cmd.scriptErrorString = "Kein BioBook geöffnet"; return nil }
        do { return try body(s) } catch { cmd.scriptErrorNumber = -10000; cmd.scriptErrorString = "\(error)"; return nil }
    }
}

@objc(LBCreateEntryCommand) final class LBCreateEntryCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        Automation.run(self) { s in
            let a = evaluatedArguments ?? [:]
            let id = try s.newEntry(title: a["title"] as? String ?? "", text: a["text"] as? String ?? "")
            Automation.changed(id)
            return id
        }
    }
}

@objc(LBAppendTextCommand) final class LBAppendTextCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        Automation.run(self) { s in
            guard let text = directParameter as? String, let id = evaluatedArguments?["entry"] as? Int else { throw StoreError.invalid("Text und Eintragsnummer angeben") }
            try s.appendText(entry: id, text: text)
            Automation.changed(id)
            return true
        }
    }
}

@objc(LBFindEntriesCommand) final class LBFindEntriesCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        Automation.run(self) { s in
            try s.search(directParameter as? String ?? "").map { "\($0["id"]!): \(($0["title"] as? String) ?? "")" }
        }
    }
}

@objc(LBEntryTextCommand) final class LBEntryTextCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        Automation.run(self) { s in
            guard let id = directParameter as? Int else { throw StoreError.invalid("Eintragsnummer angeben") }
            return try s.entryText(id: id)
        }
    }
}

// MARK: biobook://-Aktionen und Dienst
extension AppDelegate {
    /// biobook://new?title=…&text=…, biobook://append?id=…&text=… (mit Rückfrage), biobook://search?q=…; true, wenn es eine Aktion war
    func handleAction(_ url: URL) -> Bool {
        guard ["biobook", "laborbuch"].contains(url.scheme ?? ""), let host = url.host, ["new", "append", "search"].contains(host), let s = store else { return false }
        let q = Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).compactMap { i in i.value.map { (i.name, $0) } }, uniquingKeysWith: { a, _ in a })
        let web = docs.first?.web
        do {
            switch host {
            case "new":
                let id = try s.newEntry(title: q["title"] ?? "", text: q["text"] ?? "")
                broadcast(except: web, "app.externalChange && app.externalChange(\(id))")
                web?.evaluateJavaScript("app.openEntry(\(id))")
            case "append":
                guard let id = q["id"].flatMap(Int.init), let text = q["text"], !text.isEmpty else { throw StoreError.invalid("id und text angeben") }
                if !testMode {  // ein Link aus dem Netz soll nicht unbemerkt ins BioBook schreiben
                    let a = NSAlert(); a.messageText = L("Text an Eintrag \(id) anhängen?")
                    a.informativeText = String(text.prefix(300)); a.addButton(withTitle: L("Anhängen")); a.addButton(withTitle: L("Abbrechen"))
                    NSApp.activate(ignoringOtherApps: true)
                    guard a.runModal() == .alertFirstButtonReturn else { return true }
                }
                try s.appendText(entry: id, text: text)
                broadcast(except: nil, "app.externalChange && app.externalChange(\(id))")
            default:
                let js = (try? JSONSerialization.data(withJSONObject: q["q"] ?? "", options: .fragmentsAllowed)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                web?.evaluateJavaScript("app.search(\(js))")
            }
        } catch { if !testMode { alert("BioBook", "\(error)") } }
        window?.makeKeyAndOrderFront(nil)
        if !testMode { NSApp.activate(ignoringOtherApps: true) }
        return true
    }

    /// Dienste-Menü „Neuer BioBook-Eintrag“: markierter Text aus einer anderen App wird ein neuer Eintrag
    @objc func newEntryFromService(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString>) {
        guard let text = pboard.string(forType: .string), !text.isEmpty, let s = store else { error.pointee = "Kein Text ausgewählt"; return }
        do {
            let id = try s.newEntry(title: "", text: text)
            docs.first?.web.evaluateJavaScript("app.openEntry(\(id))")
            window?.makeKeyAndOrderFront(nil)
            if !testMode { NSApp.activate(ignoringOtherApps: true) }
        } catch let e { error.pointee = "\(e)" as NSString }
    }
}
