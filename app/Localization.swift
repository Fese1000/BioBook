// Sprache der Oberfläche. Die Quelltexte sind deutsch; Englisch kommt aus web/lang/en.json (Deutsch → Englisch), derselben
// Datei, die auch die Oberfläche in der WebView benutzt. Schlüssel mit {0}, {1} … stehen für wechselnde Teile und werden zu Mustern.
// Einstellung „auto“ folgt der Systemsprache (Deutsch, sonst Englisch); für Tests überschreibt BIOBOOK_LANG die Einstellung.
import Foundation

enum Lang {
    static var setting: String {
        get { UserDefaults.standard.string(forKey: "uiLanguage") ?? "auto" }
        set { UserDefaults.standard.set(["de", "en"].contains(newValue) ? newValue : "auto", forKey: "uiLanguage") }
    }

    /// Wirksame Sprache: "de" oder "en"
    static var code: String {
        if let e = ProcessInfo.processInfo.environment["BIOBOOK_LANG"], ["de", "en"].contains(e) { return e }
        switch setting {
        case "de": return "de"
        case "en": return "en"
        default: return (Locale.preferredLanguages.first ?? "en").hasPrefix("de") ? "de" : "en"
        }
    }

    private struct Pattern { let re: NSRegularExpression; let en: String; let weight: Int }
    private static var exact: [String: String] = [:]
    private static var patterns: [Pattern] = []
    private static var loaded = false

    static func parse(_ d: [String: String]) -> (exact: [String: String], patterns: [(NSRegularExpression, String, Int)]) {
        var ex: [String: String] = [:], pats: [(NSRegularExpression, String, Int)] = []
        let ph = try! NSRegularExpression(pattern: "\\{\\d+\\}")
        for (de, en) in d {
            let ns = de as NSString
            let matches = ph.matches(in: de, range: NSRange(location: 0, length: ns.length))
            if matches.isEmpty { ex[de] = en; continue }
            var pattern = "^", pos = 0, literal = 0
            for m in matches {
                let part = ns.substring(with: NSRange(location: pos, length: m.range.location - pos))
                pattern += NSRegularExpression.escapedPattern(for: part) + "(.*?)"; literal += part.count
                pos = m.range.location + m.range.length
            }
            let tail = ns.substring(from: pos)
            pattern += NSRegularExpression.escapedPattern(for: tail) + "$"; literal += tail.count
            if let re = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) { pats.append((re, en, literal)) }
        }
        pats.sort { $0.2 > $1.2 }  // das genauere Muster zuerst
        return (ex, pats)
    }

    private static func load() {
        loaded = true
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("web/lang/en.json"),
              let data = try? Data(contentsOf: url), let d = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return }
        let p = parse(d)
        exact = p.exact
        patterns = p.patterns.map { Pattern(re: $0.0, en: $0.1, weight: $0.2) }
    }

    /// Text ins Englische übersetzen (bei deutscher Sprache und bei unbekannten Texten unverändert)
    static func tr(_ s: String) -> String {
        guard code == "en", !s.isEmpty else { return s }
        if !loaded { load() }
        return translate(s, exact: exact, patterns: patterns.map { ($0.re, $0.en, $0.weight) })
    }

    static func translate(_ s: String, exact: [String: String], patterns: [(NSRegularExpression, String, Int)]) -> String {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return s }
        let lead = String(s.prefix(while: { $0.isWhitespace })), trail = String(s.reversed().prefix(while: { $0.isWhitespace }).reversed())
        func core(_ c: String) -> String {
            if let e = exact[c] { return e }
            let ns = c as NSString
            for p in patterns {
                guard let m = p.0.firstMatch(in: c, range: NSRange(location: 0, length: ns.length)) else { continue }
                var out = p.1
                for i in stride(from: m.numberOfRanges - 1, through: 1, by: -1) {
                    let r = m.range(at: i)
                    let cap = r.location == NSNotFound ? "" : translate(ns.substring(with: r), exact: exact, patterns: patterns)
                    out = out.replacingOccurrences(of: "{\(i - 1)}", with: cap)
                }
                return out
            }
            if c.contains("\n") { return c.components(separatedBy: "\n").map { translate($0, exact: exact, patterns: patterns) }.joined(separator: "\n") }
            return c
        }
        let r = core(trimmed)
        return r == trimmed ? s : lead + r + trail
    }

    /// Skript, das vor dem Laden der Seite die Sprache setzt
    static var pageScript: String {
        // BIOBOOK_I18N_SHADOW=1: Oberfläche bleibt deutsch, die Übersetzungsschicht meldet still, was im Englischen fehlt (Abdeckungsprüfung)
        let shadow = ProcessInfo.processInfo.environment["BIOBOOK_I18N_SHADOW"] == "1" ? " window.I18N_SHADOW = true;" : ""
        return "window.UI_LANG = '\(code)';" + shadow
    }
}

/// Kurzform für native Texte (Menüs, Dialoge, Panels)
func L(_ s: String) -> String { Lang.tr(s) }
