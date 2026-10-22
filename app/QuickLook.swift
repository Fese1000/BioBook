// Quick Look für .laborbuch: Die App legt im Paket QuickLook/Preview.html (Übersicht der letzten Einträge)
// und QuickLook/Thumbnail.png ab. macOS zeigt beides in der Leertasten-Vorschau und im Finder an.
import Cocoa

enum QuickLookWriter {
    static func write(_ s: Store) throws {
        let dir = s.root.appendingPathComponent("QuickLook")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let rows = try s.list()
        let texts = Dictionary(try s.spotlightRows().compactMap { r in (r["id"] as? Int).map { ($0, (r["draft_text"] as? String) ?? "") } }, uniquingKeysWith: { a, _ in a })
        let esc = { (t: String) in t.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
        let df = DateFormatter(); df.dateStyle = .medium; df.timeStyle = .short; df.locale = Locale(identifier: "de_DE")
        let kinds = ["experiment": "Experiment", "note": "Notiz", "protocol": "Protokoll"]
        let items = rows.prefix(30).map { r -> String in
            let id = r["id"] as? Int ?? 0
            let when = (r["updated"] as? String).flatMap { ISO8601DateFormatter.full.date(from: $0) }.map(df.string) ?? ""
            let snippet = String((texts[id] ?? "").replacingOccurrences(of: "\n", with: " ").prefix(180))
            return """
            <li><b>\(esc((r["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Ohne Titel"))</b>
            <span>\(kinds[r["kind"] as? String ?? ""] ?? "") · \(when)\((r["tags"] as? String).map { " · " + esc($0) } ?? "")</span>
            <p>\(esc(snippet))</p></li>
            """
        }.joined()
        let html = """
        <!doctype html><html lang="de"><head><meta charset="utf-8"><style>
        body{font:13px/1.45 -apple-system,sans-serif;margin:24px;color:#1f1d1a;background:#fbfaf7}
        h1{font:600 22px "New York",Georgia,serif;margin:0 0 4px} .sub{color:#77716a;margin-bottom:16px}
        ul{list-style:none;padding:0} li{border-top:1px solid #dedad2;padding:8px 0} li span{color:#77716a;font-size:11.5px;margin-left:6px} li p{margin:3px 0 0;color:#444}
        @media(prefers-color-scheme:dark){body{background:#1b1c1e;color:#e8e6e1} li{border-color:#33353a} li p{color:#bbb}}
        </style></head><body><h1>🧪 \(esc(s.name))</h1><div class="sub">\(rows.count) Einträge · zuletzt geändert zuerst</div><ul>\(items)</ul></body></html>
        """
        try Data(html.utf8).write(to: dir.appendingPathComponent("Preview.html"), options: .atomic)
        if let png = thumbnail(name: s.name, count: rows.count) { try png.write(to: dir.appendingPathComponent("Thumbnail.png"), options: .atomic) }
    }

    /// Vorschaubild: App-Symbol mit Buchname und Anzahl der Einträge
    static func thumbnail(name: String, count: Int) -> Data? {
        let size = 512
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let card = NSRect(x: 40, y: 20, width: 432, height: 472)
        NSColor(red: 0.98, green: 0.976, blue: 0.965, alpha: 1).setFill()
        NSBezierPath(roundedRect: card, xRadius: 28, yRadius: 28).fill()
        NSColor(red: 0.18, green: 0.44, blue: 0.37, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 40, y: 372, width: 432, height: 120), xRadius: 28, yRadius: 28).fill()
        NSRect(x: 40, y: 372, width: 432, height: 40).fill()
        let emoji = NSAttributedString(string: "🧪", attributes: [.font: NSFont(name: "AppleColorEmoji", size: 64) ?? .systemFont(ofSize: 64)])
        emoji.draw(at: NSPoint(x: 70, y: 395))
        let style = NSMutableParagraphStyle(); style.lineBreakMode = .byWordWrapping
        NSAttributedString(string: name, attributes: [.font: NSFont.systemFont(ofSize: 44, weight: .semibold), .foregroundColor: NSColor(white: 0.12, alpha: 1), .paragraphStyle: style])
            .draw(in: NSRect(x: 72, y: 140, width: 370, height: 210))
        NSAttributedString(string: "\(count) Einträge", attributes: [.font: NSFont.systemFont(ofSize: 30), .foregroundColor: NSColor(white: 0.45, alpha: 1)])
            .draw(at: NSPoint(x: 72, y: 60))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
