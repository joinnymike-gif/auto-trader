import Cocoa
import WebKit

// =============================================================================
// Clodds macOS Native Desktop App
// =============================================================================

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var splashView: NSView!
    var splashStatusLabel: NSTextField!
    var splashProgress: NSProgressIndicator!
    var statusItem: NSStatusItem!
    
    var gatewayProcess: Process?
    var isGatewayRunning: Bool = false
    var projectDir: String?
    var healthCheckTimer: Timer?
    var statusDot: NSTextField?
    var statusLabel: NSTextField?

    // 远程网关地址：「服务 → 网关设置」或 `defaults write com.clodds.desktop gatewayURL <url>`；为空 = 本机模式
    var remoteGatewayURL: String? {
        let value = UserDefaults.standard.string(forKey: "gatewayURL")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    }
    var isRemote: Bool { remoteGatewayURL != nil }
    var gatewayBase: String { remoteGatewayURL ?? "http://localhost:18789" }
    var gatewayHost: String {
        guard let url = URL(string: gatewayBase), let host = url.host else { return gatewayBase }
        return url.port.map { "\(host):\($0)" } ?? host
    }
    var gatewayUrlString: String { gatewayBase + "/webchat/" }
    var healthUrlString: String { gatewayBase + "/health" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 1. Resolve project directory
        resolveProjectDirectory()

        // 2. Setup standard macOS Menu
        setupMainMenu()

        // 3. Setup macOS Status Bar Item (Menu Bar)
        setupStatusItem()

        // 4. Setup Main Window
        setupMainWindow()

        // 5. Check and launch gateway
        checkAndLaunchGateway()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Keep running in menu bar even if window closed
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let proc = gatewayProcess, proc.isRunning {
            proc.terminate()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // MARK: - Project Directory Resolution（仅本机模式需要）
    // 顺序：CLODDS_PROJECT_DIR → Clodds.app 所在目录 → 构建脚本写入 Info.plist 的 CloddsProjectDir
    private func resolveProjectDirectory() {
        let candidates: [String?] = [
            ProcessInfo.processInfo.environment["CLODDS_PROJECT_DIR"],
            Bundle.main.bundleURL.deletingLastPathComponent().path,
            Bundle.main.object(forInfoDictionaryKey: "CloddsProjectDir") as? String,
        ]
        projectDir = candidates.compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: ($0 as NSString).appendingPathComponent("package.json"))
        }
    }

    // MARK: - Standard macOS Main Menu (Enables ⌘C, ⌘V, ⌘A, ⌘Z in WebKit)
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App Menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: "Clodds")
        appMenu.addItem(withTitle: "关于 Clodds", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "偏好设置...", action: #selector(openSettingsInWeb), keyEquivalent: ",")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "隐藏 Clodds", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 Clodds", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // File Menu
        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "文件")
        fileMenu.addItem(withTitle: "新建对话", action: #selector(newChat), keyEquivalent: "n")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // Edit Menu (Essential for text editing in WKWebView!)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(redoItem)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View Menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        viewMenu.addItem(withTitle: "重新加载", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "在默认浏览器打开", action: #selector(openInBrowser), keyEquivalent: "b")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "切换全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Controls Menu
        let ctrlMenuItem = NSMenuItem()
        let ctrlMenu = NSMenu(title: "服务")
        ctrlMenu.addItem(withTitle: "系统健康诊断 (Doctor)", action: #selector(runDoctor), keyEquivalent: "d")
        ctrlMenu.addItem(withTitle: "重启 / 重新连接网关", action: #selector(restartGateway), keyEquivalent: "")
        ctrlMenu.addItem(NSMenuItem.separator())
        ctrlMenu.addItem(withTitle: "网关设置（本机 / 远程 VPS）...", action: #selector(openGatewaySettings), keyEquivalent: "")
        ctrlMenuItem.submenu = ctrlMenu
        mainMenu.addItem(ctrlMenuItem)

        // Window Menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Status Bar Menu Item (Menu Bar Tray)
    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "🦀 Clodds"
            button.toolTip = "Clodds Trading Terminal"
        }
        updateStatusMenu()
    }

    private func updateStatusMenu() {
        let menu = NSMenu()
        
        let mode = isRemote ? "远程" : "本机"
        let statusTitle = isGatewayRunning ? "● \(mode)网关: 在线 (\(gatewayHost))" : "○ \(mode)网关: 正在连接 \(gatewayHost)..."
        let statusItemHeader = NSMenuItem(title: statusTitle, action: nil, keyEquivalent: "")
        statusItemHeader.isEnabled = false
        menu.addItem(statusItemHeader)
        menu.addItem(NSMenuItem.separator())

        menu.addItem(withTitle: "打开控制台", action: #selector(bringWindowToFront), keyEquivalent: "o")
        menu.addItem(withTitle: "新建对话", action: #selector(newChat), keyEquivalent: "n")
        menu.addItem(withTitle: "在浏览器中打开", action: #selector(openInBrowser), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())

        menu.addItem(withTitle: "运行系统诊断 (Doctor)", action: #selector(runDoctor), keyEquivalent: "")
        menu.addItem(withTitle: "重启 / 重新连接网关", action: #selector(restartGateway), keyEquivalent: "")
        menu.addItem(withTitle: "网关设置（本机 / 远程 VPS）...", action: #selector(openGatewaySettings), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())

        menu.addItem(withTitle: "退出 Clodds", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        
        statusItem.menu = menu
        statusDot?.stringValue = isGatewayRunning ? "🟢" : "🟡"
        statusLabel?.stringValue = gatewayHost
    }

    // MARK: - Main Window & WebKit
    private func setupMainWindow() {
        let windowRect = NSRect(x: 100, y: 100, width: 1240, height: 840)
        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Clodds Trading Terminal"
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 880, height: 580)
        window.center()

        // Content View setup
        let contentView = NSView(frame: windowRect)
        contentView.autoresizingMask = [.width, .height]
        window.contentView = contentView

        // Setup WKWebView
        let webConfig = WKWebViewConfiguration()
        webConfig.preferences.javaScriptCanOpenWindowsAutomatically = true
        
        webView = WKWebView(frame: contentView.bounds, configuration: webConfig)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isHidden = true
        contentView.addSubview(webView)

        // Setup Splash / Loading View
        setupSplashView(in: contentView)

        // Setup Window Toolbar
        setupWindowToolbar()

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func setupSplashView(in container: NSView) {
        splashView = NSView(frame: container.bounds)
        splashView.autoresizingMask = [.width, .height]
        splashView.wantsLayer = true
        splashView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        // Container box
        let box = NSView(frame: NSRect(x: (container.bounds.width - 400) / 2, y: (container.bounds.height - 260) / 2, width: 400, height: 260))
        box.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]

        // App Icon or Emoji
        let emojiLabel = NSTextField(labelWithString: "🦀")
        emojiLabel.font = NSFont.systemFont(ofSize: 64)
        emojiLabel.alignment = .center
        emojiLabel.frame = NSRect(x: 0, y: 170, width: 400, height: 80)
        box.addSubview(emojiLabel)

        // Title
        let titleLabel = NSTextField(labelWithString: "Clodds Trading Terminal")
        titleLabel.font = NSFont.systemFont(ofSize: 20, weight: .bold)
        titleLabel.alignment = .center
        titleLabel.frame = NSRect(x: 0, y: 130, width: 400, height: 30)
        box.addSubview(titleLabel)

        // Progress spinner
        splashProgress = NSProgressIndicator(frame: NSRect(x: 184, y: 85, width: 32, height: 32))
        splashProgress.style = .spinning
        splashProgress.isIndeterminate = true
        splashProgress.startAnimation(nil)
        box.addSubview(splashProgress)

        // Status Message
        splashStatusLabel = NSTextField(wrappingLabelWithString: "正在检测网关服务...")
        splashStatusLabel.font = NSFont.systemFont(ofSize: 13, weight: .regular)
        splashStatusLabel.textColor = NSColor.secondaryLabelColor
        splashStatusLabel.alignment = .center
        splashStatusLabel.frame = NSRect(x: 20, y: 10, width: 360, height: 60)
        box.addSubview(splashStatusLabel)

        splashView.addSubview(box)
        container.addSubview(splashView)
    }

    private func setupWindowToolbar() {
        let toolbar = NSToolbar(identifier: "CloddsMainToolbar")
        toolbar.displayMode = .iconOnly
        toolbar.delegate = self
        window.toolbar = toolbar
    }

    // MARK: - Gateway Management & Polling
    private func checkAndLaunchGateway() {
        splashProgress.startAnimation(nil)
        splashStatusLabel.stringValue = "正在检测网关状态 (\(gatewayHost))..."
        
        testGatewayHealth { [weak self] isHealthy in
            guard let self = self else { return }
            if isHealthy {
                self.onGatewayReady()
            } else if self.isRemote {
                // 远程模式：网关跑在 VPS 上，本机只等待连接
                self.waitForGateway(message: "正在连接远程网关 \(self.gatewayHost)")
            } else {
                self.startGatewayProcess()
            }
        }
    }

    private func testGatewayHealth(completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: healthUrlString) else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                DispatchQueue.main.async { completion(true) }
            } else {
                DispatchQueue.main.async { completion(false) }
            }
        }
        task.resume()
    }

    private func startGatewayProcess() {
        guard let projectDir = projectDir else {
            showSplashError("未找到项目目录。请把 Clodds.app 放在项目根目录、设置 CLODDS_PROJECT_DIR，或在「服务 → 网关设置」中连接远程 VPS。")
            return
        }
        splashStatusLabel.stringValue = "正在启动本地后台网关 (node dist/index.js)..."

        let proc = Process()
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        
        // Use user's shell environment to ensure node/nvm is in PATH
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        let script = "export PATH=\"/usr/local/bin:/opt/homebrew/bin:$PATH\"; cd \(shellQuote(projectDir)) && node dist/index.js start"
        proc.arguments = ["-l", "-c", script]
        
        do {
            try proc.run()
            self.gatewayProcess = proc
        } catch {
            showSplashError("启动失败: \(error.localizedDescription)")
            return
        }

        waitForGateway(message: "正在建立行情总线连接")
    }

    // 每秒轮询 /health，最多 25 秒
    private func waitForGateway(message: String) {
        var attempts = 0
        healthCheckTimer?.invalidate()
        healthCheckTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            attempts += 1
            self.splashStatusLabel.stringValue = "\(message)... (\(attempts)s)"

            self.testGatewayHealth { isHealthy in
                if isHealthy {
                    timer.invalidate()
                    self.onGatewayReady()
                } else if attempts >= 25 {
                    timer.invalidate()
                    self.showSplashError(self.isRemote
                        ? "无法连接远程网关 \(self.gatewayHost)。请确认 VPS 上网关已启动，并检查「服务 → 网关设置」中的地址。"
                        : "网关启动超时，请在菜单中点击“运行系统诊断”")
                }
            }
        }
    }

    private func showSplashError(_ message: String) {
        splashProgress.stopAnimation(nil)
        splashStatusLabel.stringValue = message
    }

    private func shellQuote(_ s: String) -> String {
        return "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func onGatewayReady() {
        guard !isGatewayRunning else { return }  // 重叠的健康检查可能重复回调
        isGatewayRunning = true
        updateStatusMenu()

        if let url = URL(string: gatewayUrlString) {
            webView.load(URLRequest(url: url))
        }

        // Crossfade splash to webview
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.35
            splashView.animator().alphaValue = 0.0
        } completionHandler: { [weak self] in
            self?.splashView.isHidden = true
            self?.webView.isHidden = false
        }
    }

    // MARK: - Actions
    @objc func bringWindowToFront() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func newChat() {
        bringWindowToFront()
        webView.evaluateJavaScript("document.getElementById('new-chat-btn')?.click();") { _, _ in }
    }

    @objc func reloadPage() {
        webView.reload()
    }

    @objc func openInBrowser() {
        if let url = URL(string: gatewayUrlString) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func openSettingsInWeb() {
        bringWindowToFront()
        webView.evaluateJavaScript("document.getElementById('profile-avatar')?.click(); setTimeout(() => document.getElementById('popover-settings')?.click(), 100);") { _, _ in }
    }

    @objc func restartGateway() {
        splashView.alphaValue = 1.0
        splashView.isHidden = false
        webView.isHidden = true
        isGatewayRunning = false
        healthCheckTimer?.invalidate()
        updateStatusMenu()

        if let proc = gatewayProcess, proc.isRunning {
            proc.terminate()
        }
        gatewayProcess = nil

        checkAndLaunchGateway()
    }

    @objc func runDoctor() {
        let alert = NSAlert()
        alert.messageText = "系统健康诊断 (Clodds Doctor)"
        alert.alertStyle = .informational
        guard !isRemote, let projectDir = projectDir else {
            alert.informativeText = isRemote
                ? "当前连接的是远程网关 \(gatewayHost)。\n请 SSH 登录 VPS，在项目目录运行：\nnode dist/cli/index.js doctor"
                : "未找到本地项目目录，无法运行诊断。"
            alert.runModal()
            return
        }
        alert.informativeText = "正在后台扫描系统环境、API 凭据与网络连接..."
        alert.addButton(withTitle: "在终端运行完整诊断")
        alert.addButton(withTitle: "取消")

        let resp = alert.runModal()
        if resp == .alertFirstButtonReturn {
            // 先做 shell 转义，再按 AppleScript 字符串规则转义
            let command = "cd \(shellQuote(projectDir)) && node dist/cli/index.js doctor"
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            let script = "tell application \"Terminal\" to do script \"\(command)\""
            if let appleScript = NSAppleScript(source: script) {
                var error: NSDictionary?
                appleScript.executeAndReturnError(&error)
            }
        }
    }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Clodds Trading Terminal"
        alert.informativeText = "版本 1.9.0 (macOS Native GUI)\n\n开源预测市场 AI 交易终端\n支持 DeepSeek & Claude\nhttps://github.com/alsk1992/CloddsBot"
        alert.alertStyle = .informational
        alert.runModal()
    }

    @objc func openGatewaySettings() {
        let alert = NSAlert()
        alert.messageText = "网关设置"
        alert.informativeText = """
        留空：本机模式，自动启动项目内的网关。
        填写 VPS 地址：远程模式，只连接、不在本机启动网关，例如
        • https://clodds.example.com（反向代理 + HTTPS）
        • http://127.0.0.1:18789（SSH 隧道）
        公网访问请使用 HTTPS 或 SSH 隧道，并在 VPS 上设置 WEBCHAT_TOKEN。
        """
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 24))
        field.placeholderString = "https://your-vps.example.com"
        field.stringValue = remoteGatewayURL ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "保存并连接")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            UserDefaults.standard.removeObject(forKey: "gatewayURL")
        } else if let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil {
            UserDefaults.standard.set(value, forKey: "gatewayURL")
        } else {
            let invalid = NSAlert()
            invalid.messageText = "地址无效"
            invalid.informativeText = "请输入以 http:// 或 https:// 开头的完整地址。"
            invalid.runModal()
            return
        }
        restartGateway()
    }

    // MARK: - WKNavigationDelegate
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Open external links in default macOS browser
        if url.host != URL(string: gatewayBase)?.host && navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - WKUIDelegate（WebChat 用 prompt/confirm 输入 Token、命名项目、确认删除；不实现时 WKWebView 直接返回空）
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let fieldFrame = NSRect(x: 0, y: 0, width: 320, height: 24)
        let field: NSTextField = prompt.localizedCaseInsensitiveContains("token")
            ? NSSecureTextField(frame: fieldFrame)
            : NSTextField(frame: fieldFrame)
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}

// MARK: - NSToolbarDelegate
extension AppDelegate: NSToolbarDelegate {
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return [
            NSToolbarItem.Identifier("StatusIndicator"),
            .flexibleSpace,
            NSToolbarItem.Identifier("NewChat"),
            NSToolbarItem.Identifier("Reload"),
            NSToolbarItem.Identifier("Browser"),
            NSToolbarItem.Identifier("Doctor"),
            NSToolbarItem.Identifier("Restart"),
        ]
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return [
            NSToolbarItem.Identifier("StatusIndicator"),
            .flexibleSpace,
            NSToolbarItem.Identifier("NewChat"),
            NSToolbarItem.Identifier("Reload"),
            NSToolbarItem.Identifier("Browser"),
            NSToolbarItem.Identifier("Doctor"),
            NSToolbarItem.Identifier("Restart"),
        ]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: itemIdentifier)

        switch itemIdentifier.rawValue {
        case "StatusIndicator":
            let container = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 28))
            let dot = NSTextField(labelWithString: isGatewayRunning ? "🟢" : "🟡")
            dot.frame = NSRect(x: 0, y: 4, width: 20, height: 20)
            let label = NSTextField(labelWithString: gatewayHost)
            label.font = NSFont.systemFont(ofSize: 11, weight: .medium)
            label.textColor = NSColor.secondaryLabelColor
            label.lineBreakMode = .byTruncatingMiddle
            label.frame = NSRect(x: 20, y: 4, width: 200, height: 20)
            statusDot = dot
            statusLabel = label
            container.addSubview(dot)
            container.addSubview(label)
            item.view = container
            item.label = "状态"
            return item

        case "NewChat":
            item.label = "新建对话"
            item.paletteLabel = "新建对话"
            item.toolTip = "新建交易会话 (⌘N)"
            item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New Chat")
            item.target = self
            item.action = #selector(newChat)
            return item

        case "Reload":
            item.label = "刷新"
            item.paletteLabel = "刷新"
            item.toolTip = "重新加载界面 (⌘R)"
            item.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "Reload")
            item.target = self
            item.action = #selector(reloadPage)
            return item

        case "Browser":
            item.label = "浏览器打开"
            item.paletteLabel = "在浏览器中打开"
            item.toolTip = "在系统默认浏览器中打开控制台"
            item.image = NSImage(systemSymbolName: "safari", accessibilityDescription: "Open in Browser")
            item.target = self
            item.action = #selector(openInBrowser)
            return item

        case "Doctor":
            item.label = "系统诊断"
            item.paletteLabel = "系统诊断"
            item.toolTip = "全面检查系统依赖、凭据与网络"
            item.image = NSImage(systemSymbolName: "stethoscope", accessibilityDescription: "Doctor")
            item.target = self
            item.action = #selector(runDoctor)
            return item

        case "Restart":
            item.label = "重启服务"
            item.paletteLabel = "重启服务"
            item.toolTip = "重启本地 Node.js 网关"
            item.image = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "Restart")
            item.target = self
            item.action = #selector(restartGateway)
            return item

        default:
            return nil
        }
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
