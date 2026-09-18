import AppKit
import WebKit
import SwiftUI

@MainActor
final class AuthSession: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let loginURL = URL(string: "https://new.novaposhta.ua/auth/login-private-person")!
    private(set) var webView: WKWebView!
    private var loginWindow: NSWindow?
    var onReady: (() -> Void)?
    var onError: ((String) -> Void)?
    private var bridgeSource = ""

    override init() {
        super.init()
        bridgeSource = (try? String(contentsOf: Bundle.main.url(forResource: "Bridge", withExtension: "js")!, encoding: .utf8)) ?? ""
    }

    func prepare(restoring: Bool = false) {
        guard webView == nil else { return }
        let config = WKWebViewConfiguration()
        // WebKit owns the website's persistent cookies and OAuth storage.
        // Native code never copies tokens or codes into preferences or logs.
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(source: bridgeSource, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: restoring ? URL(string: "https://new.novaposhta.ua/dashboard")! : Self.loginURL))
    }

    func showLogin() {
        prepare()
        if loginWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 740), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
            window.title = "Вхід до Нової пошти · Nova Parcel"
            window.minSize = NSSize(width: 700, height: 560)
            window.isReleasedWhenClosed = false
            let stack = NSStackView()
            stack.orientation = .vertical
            stack.spacing = 0
            let label = NSTextField(wrappingLabelWithString: "Офіційний сайт Нової пошти. Введіть телефон і код у формі нижче. Після входу посилки з’являться у віджеті.")
            label.font = .systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            let header = NSView()
            header.addSubview(label)
            label.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 18), label.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -18), label.centerYAnchor.constraint(equalTo: header.centerYAnchor), header.heightAnchor.constraint(equalToConstant: 54)])
            stack.addArrangedSubview(header)
            stack.addArrangedSubview(webView)
            header.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            webView.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            window.contentView = stack
            window.center()
            loginWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        loginWindow?.makeKeyAndOrderFront(nil)
    }

    func sync(numbers: [[String: String]], accountID: String?) async throws -> [String: Any] {
        guard let webView else { return ["kind": "login"] }
        guard webView.url?.host == "new.novaposhta.ua" else { return ["kind": "login"] }
        let value = try await webView.callAsyncJavaScript(
            "if (!window.novaParcelSync) return {kind:'loading'}; return await window.novaParcelSync(numbers, previousAccount);",
            arguments: ["numbers": numbers, "previousAccount": accountID ?? ""], in: nil, contentWorld: .page)
        return value as? [String: Any] ?? ["kind": "error", "message": "Не вдалося прочитати відповідь кабінету."]
    }

    func reload() { webView?.reload() }
    func hideLogin() { loginWindow?.orderOut(nil) }

    func signOut() async {
        loginWindow?.close()
        loginWindow = nil
        webView?.stopLoading()
        webView = nil
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onReady?() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { onError?("Не вдалося відкрити сайт Нової пошти. Перевірте інтернет.") }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { onError?("Сторінка входу не завантажилася. Спробуйте повторно.") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        let host = url.host?.lowercased() ?? ""
        let official = host == "novaposhta.ua" || host.hasSuffix(".novaposhta.ua") || host == "novapost.com" || host.hasSuffix(".novapost.com")
        if url.scheme == "https" && official { decisionHandler(.allow) }
        else {
            if action.navigationType == .linkActivated && url.scheme == "https" { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }
}
