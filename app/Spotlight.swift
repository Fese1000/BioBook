// Spotlight: Einträge erscheinen in der Systemsuche; ein Klick öffnet das Buch und den Eintrag.
// Der Index liegt bei macOS (nur auf diesem Mac); je Buch eine eigene Domäne, damit er sich gezielt erneuern lässt.
import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

enum Spotlight {
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "spotlight") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "spotlight") }
    }

    static func item(book: String, row: [String: Any]) -> CSSearchableItem? {
        guard let id = row["id"] as? Int else { return nil }
        let a = CSSearchableItemAttributeSet(contentType: .text)
        a.title = (row["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Ohne Titel"
        let text = (row["draft_text"] as? String) ?? ""
        a.contentDescription = String(text.prefix(300))
        a.textContent = String(text.prefix(20_000))
        a.keywords = ((row["tags"] as? String) ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } + ["BioBook"]
        if let u = row["updated"] as? String { a.contentModificationDate = ISO8601DateFormatter.full.date(from: u) }
        return CSSearchableItem(uniqueIdentifier: "\(book)/\(id)", domainIdentifier: book, attributeSet: a)
    }

    /// Ganzes Buch neu einlesen (beim Öffnen)
    static func reindex(_ s: Store, done: ((Error?) -> Void)? = nil) {
        guard enabled, let rows = try? s.spotlightRows() else { done?(nil); return }
        let book = s.bookID, items = rows.compactMap { item(book: book, row: $0) }
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [book]) { _ in
            CSSearchableIndex.default().indexSearchableItems(items) { e in DispatchQueue.main.async { done?(e) } }
        }
    }

    /// Einen Eintrag aktualisieren (nach dem Speichern)
    static func update(_ s: Store, id: Int) {
        guard enabled, let row = try? s.spotlightRows(id: id).first, let it = item(book: s.bookID, row: row) else { return }
        CSSearchableIndex.default().indexSearchableItems([it])
    }

    static func remove(book: String, done: (() -> Void)? = nil) {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [book]) { _ in DispatchQueue.main.async { done?() } }
    }

    /// Kennung aus Spotlight („BuchID/EintragID“) zerlegen
    static func parse(_ ident: String) -> (book: String, entry: Int)? {
        let p = ident.split(separator: "/")
        guard p.count == 2, let e = Int(p[1]) else { return nil }
        return (String(p[0]), e)
    }
}

extension ISO8601DateFormatter {
    static let full: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}
