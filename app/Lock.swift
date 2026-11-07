// Sperre mit Touch ID (oder Anmeldepasswort): beim Start, nach Inaktivität und wenn der Mac schläft.
// Die Sperre legt eine undurchsichtige Fläche über das Fenster und fängt Tastatur und Maus ab.
import Cocoa
import LocalAuthentication

final class LockOverlay: NSVisualEffectView {
    var onUnlock: (() -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with e: NSEvent) { if e.keyCode == 36 || e.keyCode == 49 { onUnlock?() } }  // Enter oder Leertaste
    override func mouseDown(with e: NSEvent) {}
    override func scrollWheel(with e: NSEvent) {}
}

final class Locker {
    private(set) var locked = false
    private var overlays: [LockOverlay] = []
    private var lastActivity = Date()
    private var timer: Timer?
    private let windows: () -> [NSWindow]
    private let disabled: Bool  // in automatischen Tests nie sperren

    init(windows: @escaping () -> [NSWindow], disabled: Bool) {
        self.windows = windows
        self.disabled = disabled
        NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .mouseMoved, .scrollWheel]) { [weak self] e in
            self?.lastActivity = Date(); return e
        }
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in self?.checkIdle() }
        let nc = NSWorkspace.shared.notificationCenter
        for n in [NSWorkspace.screensDidSleepNotification, NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in if Settings.lockEnabled { self?.lock() } }
        }
    }

    private func checkIdle() {
        guard Settings.lockEnabled, Settings.lockMinutes > 0, !locked else { return }
        if Date().timeIntervalSince(lastActivity) > Double(Settings.lockMinutes) * 60 { lock() }
    }

    func lockIfEnabled() { if Settings.lockEnabled { lock() } }

    func lock() {
        guard !locked, !disabled else { return }
        locked = true
        windows().forEach(lockWindow)
    }

    /// Ein Fenster abdecken (auch Fenster, die während der Sperre neu entstehen)
    func lockWindow(_ w: NSWindow) {
        guard locked, let content = w.contentView else { return }
        let o = LockOverlay(frame: content.bounds)
        o.autoresizingMask = [.width, .height]
        o.material = .underWindowBackground
        o.blendingMode = .withinWindow
        o.state = .active
        let title = NSTextField(labelWithString: "🔒  BioBook ist gesperrt")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        let hint = NSTextField(labelWithString: "Mit Touch ID oder dem Anmeldepasswort entsperren")
        hint.textColor = .secondaryLabelColor
        let btn = NSButton(title: "Entsperren", target: self, action: #selector(unlock))
        btn.bezelStyle = .rounded
        btn.keyEquivalent = "\r"
        let stack = NSStackView(views: [title, hint, btn])
        stack.orientation = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        o.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: o.centerXAnchor), stack.centerYAnchor.constraint(equalTo: o.centerYAnchor)])
        o.onUnlock = { [weak self] in self?.unlock() }
        content.addSubview(o)
        overlays.append(o)
        w.makeFirstResponder(o)
    }

    @objc func unlock() {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            // Ohne Touch ID und ohne Passwort-Abfrage (sollte auf dem Mac nicht vorkommen): nicht ausgesperrt bleiben
            return finishUnlock()
        }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "das BioBook zu entsperren") { ok, _ in
            DispatchQueue.main.async { if ok { self.finishUnlock() } }
        }
    }

    private func finishUnlock() {
        overlays.forEach { $0.removeFromSuperview() }
        overlays = []
        locked = false
        lastActivity = Date()
        for w in windows() { w.makeFirstResponder(w.contentView) }
    }
}
