// Texterkennung in Bildern und PDFs mit dem Vision-Framework von macOS (läuft lokal, nichts verlässt den Mac).
// PDFs mit Textebene werden direkt gelesen; nur gescannte Seiten ohne Text gehen durch die Erkennung.
import Cocoa
import PDFKit
import Vision

enum OCR {
    static let maxPages = 30

    /// Erkennt Text; läuft synchron und gehört deshalb auf eine Hintergrund-Queue
    static func recognize(url: URL, mime: String) -> String {
        if mime == "application/pdf" { return pdfText(url) }
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldAllowFloat: true] as CFDictionary) else { return "" }
        return text(in: img)
    }

    static func text(in image: CGImage) -> String {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        req.recognitionLanguages = ["de-DE", "en-US"]
        do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([req]) } catch { return "" }
        return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    private static func pdfText(_ url: URL) -> String {
        guard let doc = PDFDocument(url: url) else { return "" }
        var out: [String] = []
        for i in 0..<min(doc.pageCount, maxPages) {
            guard let page = doc.page(at: i) else { continue }
            if let s = page.string, s.trimmingCharacters(in: .whitespacesAndNewlines).count > 20 { out.append(s); continue }
            // Seite ohne Textebene (Scan): als Bild erkennen
            let box = page.bounds(for: .mediaBox)
            let scale = min(3, 2400 / max(box.width, box.height))
            let thumb = page.thumbnail(of: NSSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
            if let cg = thumb.cgImage(forProposedRect: nil, context: nil, hints: nil) { out.append(text(in: cg)) }
        }
        return out.joined(separator: "\n")
    }
}
