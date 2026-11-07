// KI-Assistent mit eigenem Anthropic-Schlüssel: Schlüssel nur im Schlüsselbund, Anfrage nur auf Klick an api.anthropic.com.
// Keine Bibliothek – ein einzelner POST /v1/messages (Claude API, roh über HTTP, da es kein offizielles Swift-SDK gibt).
import Foundation
import Security

enum Assistant {
    static let model = "claude-opus-5-5"
    static let service = "de.felix.biobook.anthropic"
    static let legacyService = "de.felix.laborbuch.anthropic"  // vor der Umbenennung (Laborbuch → BioBook)
    static var testKey: String?                      // Testmodus: nie der echte Schlüsselbund
    static var testReply: [String: Any]?              // Testmodus: hinterlegte Antwort statt Netz
    static var lastRequest: [String: Any]?            // Testmodus: was gesendet worden wäre

    // MARK: Schlüssel
    static func key(test: Bool) -> String? {
        if test { return testKey }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "api-key", kSecReturnData as String: true]
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) != errSecSuccess {
            // Schlüssel aus der Zeit vor der Umbenennung übernehmen; der alte Eintrag bleibt als Rückfall
            let old: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: legacyService,
                                      kSecAttrAccount as String: "api-key", kSecReturnData as String: true]
            var oldOut: CFTypeRef?
            guard SecItemCopyMatching(old as CFDictionary, &oldOut) == errSecSuccess, let od = oldOut as? Data, let s = String(data: od, encoding: .utf8) else { return nil }
            try? setKey(s, test: false)
            return s
        }
        guard let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func setKey(_ k: String?, test: Bool) throws {
        let key = k?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let key, !key.isEmpty, !key.hasPrefix("sk-ant-") { throw StoreError.invalid("Das sieht nicht nach einem Anthropic-Schlüssel aus (beginnt mit sk-ant-)") }
        if test { testKey = (key?.isEmpty ?? true) ? nil : key; return }
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "api-key"]
        SecItemDelete(base as CFDictionary)
        guard let key, !key.isEmpty else { return }
        var add = base
        add[kSecAttrLabel as String] = "BioBook – Anthropic-API-Schlüssel"
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        add[kSecValueData as String] = Data(key.utf8)
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw StoreError.invalid("Schlüsselbund-Fehler \(st): \(SecCopyErrorMessageString(st, nil) as String? ?? "")") }
    }

    // MARK: Anfrage
    /// Eine Nachricht an Claude; Antwort: {text, stop_reason, model, input_tokens, output_tokens}
    static func ask(system: String, user: String, maxTokens: Int, test: Bool, done: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let key = key(test: test) else { return done(.failure(StoreError.invalid("Kein Schlüssel hinterlegt (Einstellungen › KI-Assistent)"))) }
        let body: [String: Any] = [
            "model": model, "max_tokens": min(max(maxTokens, 256), 16000),
            "output_config": ["effort": "medium"],
            "fallbacks": "default",  // lehnt ein Sicherheitsfilter ab, wiederholt der Server die Anfrage mit dem empfohlenen Modell
            "system": system,
            "messages": [["role": "user", "content": user]],
        ]
        if test {
            lastRequest = body
            guard let r = testReply else { return done(.failure(StoreError.invalid("Keine Verbindung zu api.anthropic.com (Testmodus)"))) }
            return done(parse(r, status: 200))
        }
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!, timeoutInterval: 600)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                if let e = err as? URLError {
                    return done(.failure(StoreError.invalid([.notConnectedToInternet, .networkConnectionLost, .cannotFindHost].contains(e.code)
                        ? "Keine Verbindung zu api.anthropic.com. Bitte Internet prüfen." : e.code == .timedOut ? "Zeitüberschreitung – bitte noch einmal versuchen." : e.localizedDescription)))
                }
                let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
                done(parse(json, status: (resp as? HTTPURLResponse)?.statusCode ?? 0))
            }
        }.resume()
    }

    /// Antwort auswerten: Fehler verständlich, Ablehnung erkennen, nur Textblöcke (Denkblöcke bleiben weg)
    static func parse(_ j: [String: Any], status: Int) -> Result<[String: Any], Error> {
        if status != 200 {
            let msg = ((j["error"] as? [String: Any])?["message"] as? String) ?? ""
            let text: String
            switch status {
            case 401: text = "Der Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen."
            case 402: text = "Abrechnungsproblem beim Anthropic-Konto. \(msg)"
            case 403: text = "Dieser Schlüssel darf das nicht. \(msg)"
            case 404: text = "Modell \(model) ist für diesen Schlüssel nicht verfügbar. \(msg)"
            case 413: text = "Die Anfrage ist zu groß – bitte weniger Text auswählen."
            case 429: text = "Zu viele Anfragen – bitte kurz warten und noch einmal versuchen."
            case 500, 529: text = "Der Dienst ist gerade überlastet – bitte später noch einmal versuchen."
            default: text = "Anfrage fehlgeschlagen (HTTP \(status)). \(msg)"
            }
            return .failure(StoreError.invalid(text))
        }
        let stop = j["stop_reason"] as? String ?? ""
        if stop == "refusal" { return .failure(StoreError.invalid("Claude hat diese Anfrage abgelehnt.")) }
        let text = ((j["content"] as? [[String: Any]]) ?? []).filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
        let usage = j["usage"] as? [String: Any] ?? [:]
        return .success(["text": text, "stop_reason": stop, "model": j["model"] ?? model,
                         "input_tokens": usage["input_tokens"] ?? 0, "output_tokens": usage["output_tokens"] ?? 0, "truncated": stop == "max_tokens"])
    }
}
