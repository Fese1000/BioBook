// QR-Codes für Etiketten erzeugen (CoreImage) und in Kamerabildern erkennen (Vision); dazu das Kamera-Fenster zum Scannen.
// Inhalt eines Etiketts: laborbuch://open?book=<BuchID>&t=lot|entity|location|entry&id=<Nummer> (oder nur die ID wie BS-00042)
import AVFoundation
import Cocoa
import CoreImage.CIFilterBuiltins
import Vision

enum QR {
    /// PNG eines QR-Codes, ohne Weichzeichnung vergrößert (scharf beim Drucken)
    static func png(_ text: String, scale: CGFloat = 10) -> Data? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let img = f.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(img, from: img.extent) else { return nil }
        return NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
    }

    static func detect(in image: CGImage) -> [String] {
        let req = VNDetectBarcodesRequest()
        req.symbologies = [.qr, .dataMatrix, .code128, .ean13]
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([req])
        return (req.results ?? []).compactMap(\.payloadStringValue)
    }

    static func detect(in buffer: CVPixelBuffer) -> [String] {
        let req = VNDetectBarcodesRequest()
        req.symbologies = [.qr, .dataMatrix, .code128, .ean13]
        try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([req])
        return (req.results ?? []).compactMap(\.payloadStringValue)
    }

    /// Erkanntes in ein Ziel übersetzen: laborbuch://-Link oder eine nackte ID (BS-00042, PL-0001)
    static func target(_ s: String) -> [String: Any]? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if let u = URLComponents(string: t), u.scheme == "laborbuch" {
            let q = Dictionary(uniqueKeysWithValues: (u.queryItems ?? []).compactMap { i in i.value.map { (i.name, $0) } })
            guard let kind = q["t"], ["lot", "entity", "location", "entry"].contains(kind), let id = q["id"].flatMap(Int.init) else { return nil }
            return ["t": kind, "id": id, "book": q["book"] ?? ""]
        }
        if t.range(of: "^BS-\\d{5}$", options: .regularExpression) != nil { return ["t": "lot", "id": Int(t.dropFirst(3))!, "book": ""] }
        if t.range(of: "^[A-Z]{1,4}-\\d{4}$", options: .regularExpression) != nil { return ["t": "code", "code": t, "book": ""] }
        return nil
    }
}

/// Kleines Fenster mit Kamerabild; sobald ein Code erkannt wird, schließt es sich und meldet ihn
final class ScannerWindow: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "de.felix.laborbuch.scan")
    private var found: ((String) -> Void)?
    private var lastCheck = Date.distantPast
    private var done = false
    private var keepAlive: ScannerWindow?

    static func open(found: @escaping (String) -> Void, failed: @escaping (String) -> Void) {
        let s = ScannerWindow()
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: s.start(found: found, failed: failed)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async { ok ? s.start(found: found, failed: failed) : failed("Kein Zugriff auf die Kamera erlaubt") }
            }
        default: failed("Kein Zugriff auf die Kamera. Erlauben unter Systemeinstellungen › Datenschutz & Sicherheit › Kamera.")
        }
    }

    private func start(found: @escaping (String) -> Void, failed: (String) -> Void) {
        guard let dev = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: dev), session.canAddInput(input) else {
            return failed("Keine Kamera gefunden")
        }
        keepAlive = self
        self.found = found
        session.addInput(input)
        let out = AVCaptureVideoDataOutput()
        out.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(out) { session.addOutput(out) }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 400), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        w.title = "Etikett scannen – Code vor die Kamera halten"
        w.isReleasedWhenClosed = false
        w.delegate = self
        let view = NSView()
        view.wantsLayer = true
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer = layer
        w.contentView = view
        w.center(); w.makeKeyAndOrderFront(nil)
        window = w
        queue.async { self.session.startRunning() }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput buf: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !done, Date().timeIntervalSince(lastCheck) > 0.25, let px = CMSampleBufferGetImageBuffer(buf) else { return }
        lastCheck = Date()
        guard let code = QR.detect(in: px).first(where: { QR.target($0) != nil }) else { return }
        done = true
        DispatchQueue.main.async { self.found?(code); self.window?.close() }
    }

    func windowWillClose(_ n: Notification) {
        queue.async { self.session.stopRunning() }
        DispatchQueue.main.async { self.keepAlive = nil }
    }
}
