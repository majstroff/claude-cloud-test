// «Лёгкость ОС» для macOS: своё окно на WebKit, без Chrome.
// Запускает локальный сервер (launcher.sh start), показывает интерфейс в окне,
// ссылки на сайты открывает в браузере по умолчанию, при закрытии окна
// останавливает сервер (launcher.sh stop).
// Сборка: bash macos/build-app.sh (нужны Command Line Tools: xcode-select --install).

import AppKit
import WebKit

let appURL = URL(string: "http://localhost:\(ProcessInfo.processInfo.environment["FRAME_PORT"] ?? "4317")/?shell=native")!

func launcherPath() -> String {
    Bundle.main.path(forResource: "launcher", ofType: "sh") ?? ""
}

/// Запуск launcher.sh с командой; возвращает код выхода и вывод.
@discardableResult
func runLauncher(_ command: String) -> (Int32, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [launcherPath(), command]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do {
        try p.run()
    } catch {
        return (1, "Не удалось запустить launcher.sh: \(error.localizedDescription)")
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
}

func dataDir() -> String {
    let home = ProcessInfo.processInfo.environment["FRAME_HOME"] ?? (NSHomeDirectory() + "/Documents/Frame OS")
    return home + "/.frame-data"
}

func isAppURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    if scheme == "about" || scheme == "data" || scheme == "blob" { return true }
    guard scheme == "http" || scheme == "https" else { return false }
    let host = url.host?.lowercased() ?? ""
    return (host == "localhost" || host == "127.0.0.1" || host == "::1") && url.port == appURL.port
}

let loadingHTML = """
<!doctype html><html lang="ru"><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: grid; place-items: center; font: 15px -apple-system, sans-serif; color: #5b6b66; background: #f6f8f7; }
  @media (prefers-color-scheme: dark) { body { background: #141816; color: #9fb0aa; } }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #1f8f7a; display: inline-block; margin-right: 10px; animation: p 1s infinite alternate; }
  @keyframes p { from { opacity: .3 } to { opacity: 1 } }
</style>
<body><div><span class="dot"></span>Запускаем «Лёгкость»…</div></body></html>
"""

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var stopped = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Лёгкость ОС"
        window.minSize = NSSize(width: 420, height: 480)
        window.contentView = webView
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("LyogkostMainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        webView.loadHTMLString(loadingHTML, baseURL: nil)

        DispatchQueue.global(qos: .userInitiated).async {
            let (code, output) = runLauncher("start")
            DispatchQueue.main.async {
                if code == 0 {
                    self.webView.load(URLRequest(url: appURL))
                } else {
                    let alert = NSAlert()
                    alert.alertStyle = .critical
                    alert.messageText = "Не удалось запустить «Лёгкость»"
                    alert.informativeText = output.trimmingCharacters(in: .whitespacesAndNewlines)
                    alert.runModal()
                    NSApp.terminate(nil)
                }
            }
        }
    }

    // Нажатие на значок в Доке — показать окно.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    // Закрыли окно — закрываем программу и сервер.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        guard !stopped else { return }
        stopped = true
        // Сервер останавливаем в фоне, чтобы программа завершилась сразу:
        // иначе повторное нажатие на значок в эти секунды попадает в уходящую программу.
        // launcher.sh start подождёт, пока остановка закончится.
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "touch \"$1/app-stopping\" 2>/dev/null; nohup /bin/bash \"$0\" stop >/dev/null 2>&1 &", launcherPath(), dataDir()]
        try? p.run()
        p.waitUntilExit()
    }

    // MARK: ссылки

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if isAppURL(url) {
            decisionHandler(.allow)
        } else {
            openExternally(url)
            decisionHandler(.cancel)
        }
    }

    // target="_blank" и window.open.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAppURL(url) { webView.load(URLRequest(url: url)) } else { openExternally(url) }
        }
        return nil
    }

    func openExternally(_ url: URL) {
        let allowed = ["http", "https", "mailto", "tel", "obsidian"]
        guard let scheme = url.scheme?.lowercased(), allowed.contains(scheme) else { return }
        NSWorkspace.shared.open(url)
    }

    // Сервер мог не успеть ответить — пробуем ещё раз (до 30 раз, раз в секунду).
    var retries = 0
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        guard retries < 30 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { webView.load(URLRequest(url: appURL)) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url.map(isAppURL) == true && webView.url?.scheme != "about" { retries = 0 }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: диалоги страницы

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "Да")
        a.addButton(withTitle: "Отмена")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    // MARK: меню

    @objc func reloadPage(_ sender: Any?) { webView.load(URLRequest(url: appURL)) }
    @objc func goBack(_ sender: Any?) { webView.goBack() }
    @objc func goForward(_ sender: Any?) { webView.goForward() }
    @objc func zoomIn(_ sender: Any?) { webView.pageZoom = min(webView.pageZoom + 0.1, 2.0) }
    @objc func zoomOut(_ sender: Any?) { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
    @objc func zoomReset(_ sender: Any?) { webView.pageZoom = 1.0 }
    @objc func openInBrowser(_ sender: Any?) {
        NSWorkspace.shared.open(webView.url.flatMap { isAppURL($0) && $0.scheme != "about" ? $0 : nil } ?? appURL)
    }

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "О программе «Лёгкость ОС»", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Скрыть «Лёгкость»", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Скрыть остальные", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Завершить «Лёгкость»", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Правка")
        edit.addItem(withTitle: "Отменить", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Повторить", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Скопировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Выбрать все", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "Вид")
        view.addItem(withTitle: "Обновить", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        view.addItem(withTitle: "Назад", action: #selector(goBack(_:)), keyEquivalent: "[")
        view.addItem(withTitle: "Вперёд", action: #selector(goForward(_:)), keyEquivalent: "]")
        view.addItem(.separator())
        view.addItem(withTitle: "Увеличить", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        view.addItem(withTitle: "Уменьшить", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        view.addItem(withTitle: "Обычный размер", action: #selector(zoomReset(_:)), keyEquivalent: "0")
        view.addItem(.separator())
        view.addItem(withTitle: "Открыть в браузере", action: #selector(openInBrowser(_:)), keyEquivalent: "")
        for item in view.items where item.action != nil { item.target = self }
        viewItem.submenu = view
        main.addItem(viewItem)

        let winItem = NSMenuItem()
        let win = NSMenu(title: "Окно")
        win.addItem(withTitle: "Свернуть", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Закрыть", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        main.addItem(winItem)
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
