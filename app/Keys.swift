// Persönlicher Signaturschlüssel (Ed25519) im macOS-Schlüsselbund und Einstellungen der Person.
// Der private Schlüssel verlässt den Schlüsselbund nicht; im BioBook liegt nur der öffentliche Teil.
import CryptoKit
import Foundation
import Security

enum Keys {
    static let service = "de.felix.biobook.signing"
    /// Dienstname aus der Zeit vor der Umbenennung (Laborbuch → BioBook): Dort liegt der bisherige Signaturschlüssel
    static let legacyService = "de.felix.laborbuch.signing"

    /// Für Tests: BIOBOOK_KEYFILE zeigt auf eine Datei statt auf den Schlüsselbund (keine Rückfragen von macOS)
    static func signingKey() throws -> Curve25519.Signing.PrivateKey {
        if let path = ProcessInfo.processInfo.environment["BIOBOOK_KEYFILE"] {
            let url = URL(fileURLWithPath: path)
            if let d = try? Data(contentsOf: url) { return try Curve25519.Signing.PrivateKey(rawRepresentation: d) }
            let k = Curve25519.Signing.PrivateKey()
            try k.rawRepresentation.write(to: url, options: .atomic)
            return k
        }
        if let d = try read() { return try Curve25519.Signing.PrivateKey(rawRepresentation: d) }
        let k = Curve25519.Signing.PrivateKey()
        try store(k.rawRepresentation)
        return k
    }

    /// Öffentlicher Schlüssel als Fingerabdruck, ohne einen neuen Schlüssel anzulegen
    static func fingerprint() -> String? {
        // Mit Testschlüsseldatei nie auf den Schlüsselbund zurückfallen (sonst fragt macOS nach dem Passwort)
        let d: Data?
        if let path = ProcessInfo.processInfo.environment["BIOBOOK_KEYFILE"] { d = try? Data(contentsOf: URL(fileURLWithPath: path)) }
        else { d = try? read() }
        guard let d, let k = try? Curve25519.Signing.PrivateKey(rawRepresentation: d) else { return nil }
        return Store.fingerprint(Store.hex(k.publicKey.rawRepresentation))
    }

    private static func read() throws -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "default", kSecReturnData as String: true]
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return try migrateLegacy() }
        guard st == errSecSuccess, let d = out as? Data else { throw keychainError(st) }
        return d
    }

    /// Fehlt der Schlüssel unter dem neuen Namen, wird der alte übernommen (statt einen zweiten, anderen Schlüssel anzulegen).
    /// Der alte Eintrag bleibt unverändert als Rückfall. macOS fragt dabei einmal nach dem Anmeldepasswort.
    private static func migrateLegacy() throws -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: legacyService,
                                kSecAttrAccount as String: "default", kSecReturnData as String: true]
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let d = out as? Data else { throw keychainError(st) }
        try store(d)
        return d
    }

    private static func store(_ d: Data) throws {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "default", kSecAttrLabel as String: "BioBook Signaturschlüssel",
                                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecValueData as String: d]
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw keychainError(st) }
    }

    /// Verständliche Meldung statt Fehlercode. Häufigster Fall: Die App wurde neu gebaut oder aktualisiert und macOS fragt
    /// nach dem Anmeldepasswort, bevor sie den Schlüssel wieder benutzen darf.
    private static func keychainError(_ st: OSStatus) -> StoreError {
        let sys = SecCopyErrorMessageString(st, nil) as String? ?? ""
        switch st {
        case errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed:
            return .invalid("macOS hat den Zugriff auf deinen Signaturschlüssel nicht erlaubt. Bitte noch einmal abschließen und im Dialog das Anmeldepasswort eingeben, am besten mit „Immer erlauben“. (Nach einem Update der App fragt macOS einmal nach.) [\(st)]")
        default:
            return .invalid("Schlüsselbund-Fehler \(st): \(sys)")
        }
    }
}

/// Einstellungen der Person (nicht des Buches): Name für Signaturen, Sperre
enum Settings {
    static var author: String {
        get { UserDefaults.standard.string(forKey: "author") ?? NSFullUserName() }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "author") }
    }
    static var lockEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "lockEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "lockEnabled") }
    }
    /// Minuten ohne Eingabe bis zur Sperre (0 = nur beim Start und Ruhezustand)
    static var lockMinutes: Int {
        get { UserDefaults.standard.object(forKey: "lockMinutes") as? Int ?? 15 }
        set { UserDefaults.standard.set(max(0, min(240, newValue)), forKey: "lockMinutes") }
    }
}
