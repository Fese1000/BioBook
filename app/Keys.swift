// Persönlicher Signaturschlüssel (Ed25519) im macOS-Schlüsselbund und Einstellungen der Person.
// Der private Schlüssel verlässt den Schlüsselbund nicht; im Laborbuch liegt nur der öffentliche Teil.
import CryptoKit
import Foundation
import Security

enum Keys {
    static let service = "de.felix.laborbuch.signing"

    /// Für Tests: LABORBUCH_KEYFILE zeigt auf eine Datei statt auf den Schlüsselbund (keine Rückfragen von macOS)
    static func signingKey() throws -> Curve25519.Signing.PrivateKey {
        if let path = ProcessInfo.processInfo.environment["LABORBUCH_KEYFILE"] {
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
        guard let d = ProcessInfo.processInfo.environment["LABORBUCH_KEYFILE"].flatMap({ try? Data(contentsOf: URL(fileURLWithPath: $0)) }) ?? (try? read()),
              let k = try? Curve25519.Signing.PrivateKey(rawRepresentation: d) else { return nil }
        return Store.fingerprint(Store.hex(k.publicKey.rawRepresentation))
    }

    private static func read() throws -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "default", kSecReturnData as String: true]
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let d = out as? Data else { throw StoreError.invalid("Schlüsselbund nicht lesbar (\(st))") }
        return d
    }

    private static func store(_ d: Data) throws {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "default", kSecAttrLabel as String: "Laborbuch Signaturschlüssel",
                                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecValueData as String: d]
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw StoreError.invalid("Schlüssel ließ sich nicht im Schlüsselbund speichern (\(st))") }
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
