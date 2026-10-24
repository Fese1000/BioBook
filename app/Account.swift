// Lokale Konten im Laborbuch: Name und Passwort liegen nur im Buch selbst (kein Server). Das Passwort wird nie gespeichert,
// sondern als PBKDF2-HMAC-SHA256 mit eigenem Zufallssalz je Konto; geprüft wird in konstanter Zeit.
// Touch ID gehört zur App-Sperre (Locker), nicht hierher.
import Foundation
import CommonCrypto
import Security

extension Store {
    static let passwordMinLength = 8
    static let kdfRounds = 210_000  // OWASP-Empfehlung für PBKDF2-HMAC-SHA256

    private static func derive(_ password: String, salt: Data, rounds: Int) -> Data {
        var out = Data(count: 32)
        let pw = Array(password.utf8)
        let status = out.withUnsafeMutableBytes { o in
            salt.withUnsafeBytes { s in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw.map { Int8(bitPattern: $0) }, pw.count,
                                     s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(rounds),
                                     o.bindMemory(to: UInt8.self).baseAddress, 32)
            }
        }
        precondition(status == kCCSuccess, "PBKDF2 fehlgeschlagen")
        return out
    }

    private static func sameBytes(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private func accountRow(_ name: String) throws -> [String: Any]? {
        try queryRows("SELECT * FROM account WHERE name = ? COLLATE NOCASE", [name.trimmingCharacters(in: .whitespaces)]).first
    }

    private func passwordMatches(_ row: [String: Any], _ password: String) -> Bool {
        guard let salt = Store.unhex(row["salt"] as? String ?? ""), let want = Store.unhex(row["hash"] as? String ?? ""),
              let rounds = row["rounds"] as? Int else { return false }
        return Store.sameBytes(Store.derive(password, salt: salt, rounds: rounds), want)
    }

    private func storePassword(_ password: String, forAccount id: Int) throws {
        var salt = Data(count: 16)
        let ok = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) } == errSecSuccess
        guard ok else { throw StoreError.invalid("Kein Zufall verfügbar") }
        let hash = Store.derive(password, salt: salt, rounds: Store.kdfRounds)
        try queryRows("UPDATE account SET salt = ?, hash = ?, rounds = ? WHERE id = ?",
                      [salt.map { String(format: "%02x", $0) }.joined(), hash.map { String(format: "%02x", $0) }.joined(), Store.kdfRounds, id])
    }

    /// Neues Konto; der Name ist eindeutig (ohne Rücksicht auf Groß-/Kleinschreibung)
    @discardableResult
    func createAccount(name: String, password: String) throws -> Int {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { throw StoreError.invalid("Bitte einen Namen angeben") }
        guard password.count >= Store.passwordMinLength else { throw StoreError.invalid("Das Passwort braucht mindestens \(Store.passwordMinLength) Zeichen") }
        guard try accountRow(n) == nil else { throw StoreError.invalid("Dieser Name ist schon vergeben") }
        return try transactionRun {
            try queryRows("INSERT INTO account(name, salt, hash, rounds, created) VALUES(?, '', '', 0, ?)", [n, Store.now()])
            let id = try queryRows("SELECT id FROM account WHERE name = ?", [n]).first!["id"] as! Int
            try storePassword(password, forAccount: id)
            return id
        }
    }

    /// Stimmt das Passwort? Unbekannter Name und falsches Passwort sehen gleich aus (keine Auskunft, welche Namen es gibt).
    func authenticate(name: String, password: String) throws -> Bool {
        guard let row = try accountRow(name) else {
            _ = Store.derive(password, salt: Data(count: 16), rounds: Store.kdfRounds)  // gleiche Rechenzeit wie bei einem echten Konto
            return false
        }
        return passwordMatches(row, password)
    }

    func changePassword(name: String, old: String, new: String) throws {
        guard let row = try accountRow(name), passwordMatches(row, old) else { throw StoreError.invalid("Name oder aktuelles Passwort stimmt nicht") }
        guard new.count >= Store.passwordMinLength else { throw StoreError.invalid("Das Passwort braucht mindestens \(Store.passwordMinLength) Zeichen") }
        try storePassword(new, forAccount: row["id"] as! Int)
    }

    func accountNames() throws -> [String] {
        try queryRows("SELECT name FROM account ORDER BY name COLLATE NOCASE").compactMap { $0["name"] as? String }
    }

    /// Löschen nur mit dem Passwort des Kontos
    func deleteAccount(name: String, password: String) throws {
        guard let row = try accountRow(name), passwordMatches(row, password) else { throw StoreError.invalid("Name oder Passwort stimmt nicht") }
        try queryRows("DELETE FROM account WHERE id = ?", [row["id"] as! Int])
    }
}
