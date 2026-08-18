import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width: CGFloat = 1440
        let height: CGFloat = 900
        let rect = NSRect(
            x: screen.midX - width / 2,
            y: screen.midY - height / 2,
            width: width,
            height: height
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "AI CFO"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedRed: 18 / 255, green: 17 / 255, blue: 15 / 255, alpha: 1)
        window.minSize = NSSize(width: 1080, height: 720)

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController.add(self, name: "usage")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        if let resource = Bundle.main.resourceURL {
            let index = resource.appendingPathComponent("dist/index.html")
            webView.loadFileURL(index, allowingReadAccessTo: resource.appendingPathComponent("dist"))
        }

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "usage" else { return }
        let days: Int
        if let body = message.body as? [String: Any], let value = body["days"] as? Int {
            days = value
        } else {
            days = 30
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let json = try Self.scan(days: days)
                let encoded = Data(json.utf8).base64EncodedString()
                DispatchQueue.main.async {
                    self?.webView.evaluateJavaScript(
                        "window.__aicfoUsage && window.__aicfoUsage.resolve(JSON.parse(atob('\(encoded)')))"
                    )
                }
            } catch {
                let msg = error.localizedDescription.replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                DispatchQueue.main.async {
                    self?.webView.evaluateJavaScript(
                        "window.__aicfoUsage && window.__aicfoUsage.reject(new Error('\(msg)'))"
                    )
                }
            }
        }
    }

    static func scan(days: Int) throws -> String {
        guard let script = Bundle.main.url(forResource: "scan_usage", withExtension: "py") else {
            throw NSError(domain: "AICfo", code: 1, userInfo: [NSLocalizedDescriptionKey: "scan_usage.py missing from app bundle"])
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [script.path, "--days", String(days)]
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        try process.run()
        process.waitUntilExit()
        let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if process.terminationStatus != 0 {
            let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw NSError(domain: "AICfo", code: Int(process.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: stderr.isEmpty ? "Local usage scan failed" : stderr,
            ])
        }
        return stdout
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
