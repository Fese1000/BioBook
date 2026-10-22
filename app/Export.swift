// Export und Import auf Dateiebene: Ordner mit HTML, Markdown, JSON und Dateien; .eln (RO-Crate-ZIP); Dokumente lesen.
// Die Inhalte (HTML, Markdown, RO-Crate-Metadaten) baut die Oberfläche; hier wird nur geschrieben, kopiert und gepackt.
import Cocoa
import UniformTypeIdentifiers

enum ExportError: Error, CustomStringConvertible {
    case badPath(String), tool(String)
    var description: String { switch self { case .badPath(let p): return "Ungültiger Pfad im Export: \(p)"; case .tool(let m): return m } }
}

enum FileExport {
    /// Relativen Pfad prüfen (kein „..“, nicht absolut) und an den Ordner hängen
    static func safe(_ rel: String, in dir: URL) throws -> URL {
        let parts = rel.split(separator: "/").map(String.init)
        guard !rel.hasPrefix("/"), !parts.isEmpty, !parts.contains(where: { $0 == ".." || $0 == "." || $0.isEmpty }) else { throw ExportError.badPath(rel) }
        return parts.reduce(dir) { $0.appendingPathComponent($1) }
    }

    /// Ortszeit für Datei- und Ordnernamen, z. B. „2026-10-23 14-05“
    static func stamp(seconds: Bool = false) -> String {
        let f = DateFormatter()
        f.dateFormat = seconds ? "yyyy-MM-dd HH-mm-ss" : "yyyy-MM-dd HH-mm"
        return f.string(from: Date())
    }

    static func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    static func copy(_ src: URL, to dst: URL) throws {
        try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
        try FileManager.default.copyItem(at: src, to: dst)
    }

    static func run(_ tool: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        let err = Pipe(); p.standardError = err; p.standardOutput = Pipe()
        try p.run(); p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            throw ExportError.tool("\(URL(fileURLWithPath: tool).lastPathComponent): " + (String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "Fehler"))
        }
    }

    /// .eln = ZIP mit einem Ordner, darin ro-crate-metadata.json und die Dateien
    static func zipELN(folder: URL, to out: URL) throws {
        if FileManager.default.fileExists(atPath: out.path) { try FileManager.default.removeItem(at: out) }
        try run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noqtn", "--keepParent", folder.path, out.path])  // ohne __MACOSX-Einträge
    }

    static func unzip(_ zip: URL, to dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try run("/usr/bin/ditto", ["-x", "-k", zip.path, dir.path])
    }

    /// Word, RTF, ODT, DOC → HTML (über die Textsysteme von macOS)
    static func documentHTML(_ url: URL) throws -> String {
        let attr = try NSAttributedString(url: url, options: [:], documentAttributes: nil)
        let data = try attr.data(from: NSRange(location: 0, length: attr.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.html])
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Ghostscript für PDF/A (nur wenn installiert, z. B. per Homebrew)
    static var ghostscript: String? { ["/opt/homebrew/bin/gs", "/usr/local/bin/gs"].first { FileManager.default.isExecutableFile(atPath: $0) } }

    static func pdfA(_ pdf: Data) throws -> Data {
        guard let gs = ghostscript else { throw ExportError.tool("Für PDF/A wird Ghostscript gebraucht (im Terminal: brew install ghostscript). Normales PDF geht ohne.") }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("laborbuch-pdfa-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let inp = tmp.appendingPathComponent("in.pdf"), out = tmp.appendingPathComponent("out.pdf")
        try pdf.write(to: inp)
        try run(gs, ["-dPDFA=2", "-dBATCH", "-dNOPAUSE", "-dNOOUTERSAVE", "-dPDFACompatibilityPolicy=1", "-sColorConversionStrategy=RGB",
                     "-sDEVICE=pdfwrite", "-sOutputFile=\(out.path)", inp.path])
        return try Data(contentsOf: out)
    }
}
