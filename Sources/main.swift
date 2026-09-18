import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var store: ParcelStore!
    var window: NSPanel!
    var statusItem: NSStatusItem!
    func applicationDidFinishLaunching(_ notification: Notification) {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Nova Parcel")
        let quitItem = NSMenuItem(title: "Завершити Nova Parcel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quitItem.target = NSApp
        appMenu.addItem(quitItem); appItem.submenu = appMenu; mainMenu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Редагування")
        for (title, selector, key) in [("Вирізати", "cut:", "x"), ("Копіювати", "copy:", "c"), ("Вставити", "paste:", "v"), ("Вибрати все", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key))
        }
        editItem.submenu = editMenu; mainMenu.addItem(editItem); NSApp.mainMenu = mainMenu
        store = ParcelStore()
        window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 650), styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Nova Parcel"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.isFloatingPanel = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.minSize = NSSize(width: 390, height: 560)
        window.maxSize = NSSize(width: 510, height: 1200)
        window.backgroundColor = NSColor(calibratedRed: 0.965, green: 0.957, blue: 0.945, alpha: 1)
        window.contentView = NSHostingView(rootView: WidgetView(store: store).padding(.top, 20))
        window.setFrameAutosaveName("NovaParcelWidget")
        if !window.setFrameUsingName("NovaParcelWidget"), let screen = NSScreen.main {
            let f = screen.visibleFrame
            window.setFrameOrigin(NSPoint(x: f.maxX - 440, y: f.maxY - 690))
        }
        window.level = store.pinned ? .floating : .normal
        store.onPin = { [weak self] pinned in self?.window.level = pinned ? .floating : .normal }
        store.onShow = { [weak self] in self?.showWidget() }
        let menuItemName = "NovaParcelMenu"
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: "didPlaceMenuIconOnRight") {
            // AppKit's persisted placement is an implementation detail, used
            // only once for this local build. A later user drag takes priority.
            // Seed both identities before creation to avoid a leftmost initial
            // placement while macOS assigns the stable autosave name.
            defaults.set(0, forKey: "NSStatusItem Preferred Position Item-0")
            defaults.set(0, forKey: "NSStatusItem Preferred Position \(menuItemName)")
            defaults.set(true, forKey: "didPlaceMenuIconOnRight")
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.autosaveName = menuItemName
        statusItem.button?.image = NSImage(systemSymbolName: "shippingbox", accessibilityDescription: "Nova Parcel")
        statusItem.button?.image?.isTemplate = true
        statusItem.button?.toolTip = "Nova Parcel — мої посилки"
        if statusItem.button?.image == nil { statusItem.button?.title = "NP" }
        let menu = NSMenu()
        let entries: [(String, Selector, String)] = [("Показати віджет", #selector(showWidget), ""), ("Відкрити акаунт", #selector(openAccount), ""), ("Оновити статуси", #selector(refresh), "r")]
        for (title, selector, key) in entries { let item = NSMenuItem(title: title, action: selector, keyEquivalent: key); item.target = self; menu.addItem(item) }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Завершити Nova Parcel", action: #selector(quitApp), keyEquivalent: "q"); quit.target = self; menu.addItem(quit)
        statusItem.menu = menu
        // A configured tracker starts quietly, including launch at login.
        // Explicit menu/reopen actions always show the widget.
        if !CommandLine.arguments.contains("--background") && (store.isDemo || CommandLine.arguments.contains("--show") || (!store.connected && store.parcels.isEmpty)) { showWidget() }
    }
    @objc func showWidget() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil); Task { await store.updateNotificationPermission() } }
    @objc func openAccount() { store.signIn() }
    @objc func refresh() { Task { await store.refresh(force: true) } }
    @objc func quitApp() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWidget(); return true }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { app.run() }
}
