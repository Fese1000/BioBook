// Zeugen-PDF: den signierten Stand eines Eintrags als mehrseitiges PDF ausgeben, mit Revisions-Hash im Text und in den Metadaten.
// Das ausgedruckte und unterschriebene (oder digital unterschriebene) PDF wird später wieder angehängt; der Hash verbindet beides.
import Cocoa
import PDFKit
import WebKit

final class WitnessPDF: NSObject, WKNavigationDelegate {
    private var window: NSWindow?
    private var web: WKWebView?
    private var done: ((Result<Data, Error>) -> Void)?
    private var revHash = ""
    private var noMargins = false
    private var outURL: URL?
    private var keepAlive: WitnessPDF?

    /// html: vollständiges Dokument (Bilder über lab://); scheme: derselbe Handler wie im Hauptfenster
    /// noMargins: für Etikettenbögen, deren Raster das HTML selbst in Millimetern festlegt
    static func make(html: String, hash: String, scheme: WKURLSchemeHandler, noMargins: Bool = false, completion: @escaping (Result<Data, Error>) -> Void) {
        let w = WitnessPDF()
        w.keepAlive = w
        w.revHash = hash
        w.noMargins = noMargins
        w.done = completion
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(scheme, forURLScheme: "lab")
        // A4 bei 72 dpi; das Fenster bleibt unsichtbar, wird aber zum Drucken gebraucht
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 595, height: 842), configuration: cfg)
        web.navigationDelegate = w
        let win = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 595, height: 842), styleMask: [.borderless], backing: .buffered, defer: false)
        win.isReleasedWhenClosed = false
        win.contentView = web
        w.window = win; w.web = web
        web.loadHTMLString(html, baseURL: URL(string: "lab://app/"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // kurz warten, bis Bilder geladen sind
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.printToPDF() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }

    private func printToPDF() {
        guard let web, let window else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("laborbuch-zeuge-\(UUID().uuidString).pdf")
        outURL = url
        let info = NSPrintInfo(dictionary: [.jobSavingURL: url])
        info.jobDisposition = .save
        info.paperSize = NSSize(width: 595, height: 842)
        if noMargins { info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0 }
        else { info.topMargin = 36; info.bottomMargin = 36; info.leftMargin = 40; info.rightMargin = 40 }
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        let op = web.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = web.bounds
        op.runModal(for: window, delegate: self, didRun: #selector(printDone(_:success:contextInfo:)), contextInfo: nil)
    }

    /// AppKit ruft das auf einem Nebenthread auf; weiter geht es im Hauptthread
    @objc private func printDone(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        DispatchQueue.main.async { self.readPDF(success: success) }
    }

    private func readPDF(success: Bool) {
        guard success, let url = outURL else { return finish(.failure(StoreError.invalid("PDF konnte nicht erzeugt werden"))) }
        defer { try? FileManager.default.removeItem(at: url) }
        guard let doc = PDFDocument(url: url) else { return finish(.failure(StoreError.invalid("PDF ist leer"))) }
        var attrs = doc.documentAttributes ?? [:]
        attrs[PDFDocumentAttribute.titleAttribute] = "Laborbuch – Zeugen-PDF"
        attrs[PDFDocumentAttribute.subjectAttribute] = "Laborbuch Revisions-Hash SHA-256: \(revHash)"
        attrs[PDFDocumentAttribute.keywordsAttribute] = ["laborbuch", revHash]
        attrs[PDFDocumentAttribute.creatorAttribute] = "Laborbuch"
        doc.documentAttributes = attrs
        guard let data = doc.dataRepresentation() else { return finish(.failure(StoreError.invalid("PDF konnte nicht geschrieben werden"))) }
        finish(.success(data))
    }

    private func finish(_ r: Result<Data, Error>) {
        done?(r); done = nil
        // erst nach dem Druckvorgang freigeben; die WebView nicht aus dem Fenster lösen, solange WebKit sie beobachtet
        DispatchQueue.main.async {
            self.window?.orderOut(nil)
            self.web?.navigationDelegate = nil
            self.window = nil; self.web = nil
            self.keepAlive = nil
        }
    }

    /// Steht der Hash im Text oder in den Metadaten des PDF? (Ein reiner Scan ohne Texterkennung enthält ihn nicht.)
    static func containsHash(_ data: Data, hash: String) -> Bool {
        guard let doc = PDFDocument(data: data) else { return false }
        if let s = doc.string?.replacingOccurrences(of: "\\s", with: "", options: .regularExpression), s.contains(hash) { return true }
        let a = doc.documentAttributes ?? [:]
        let meta = "\(a[PDFDocumentAttribute.subjectAttribute] ?? "") \(a[PDFDocumentAttribute.keywordsAttribute] ?? "")"
        return meta.contains(hash)
    }
}
