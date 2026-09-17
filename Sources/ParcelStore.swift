import Foundation
import AppKit
import Combine
import UserNotifications
import ServiceManagement

@MainActor
final class ParcelStore: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published var parcels: [Parcel] = []
    @Published var connected = false
    @Published var busy = false
    @Published var error: String?
    @Published var lastRefresh: Date?
    @Published var notificationsGranted = false
    @Published var pinned = false
    @Published var loginAtLaunch = false
    @Published var awaitingLogin = false
    @Published var showCompleted = false
    @Published var isDemo = false
    @Published var notificationTestResult: String?
    var onPin: ((Bool) -> Void)?
    var onShow: (() -> Void)?
    private let auth = AuthSession()
    private var accountID: String?
    private var timer: Timer?
    private var loginTimer: Timer?
    private var generation = 0
    private var refreshingSession = false
    private var retryCount = 0
    private var notificationPermissionMessage = "Дозвольте сповіщення для Nova Parcel у Системних параметрах → Сповіщення."
    private var lastAttempt = Date.distantPast
    private var dataURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NovaParcel", isDirectory: true).appendingPathComponent("parcels.json")
    }
    var visibleParcels: [Parcel] { parcels.filter { showCompleted || !$0.isDelivered } }
    var activeCount: Int { parcels.filter { !$0.isDelivered }.count }

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        if CommandLine.arguments.contains("--demo") { loadDemo(); return }
        if let data = try? Data(contentsOf: dataURL), let saved = try? JSONDecoder().decode(SavedState.self, from: data) {
            parcels = saved.parcels; accountID = saved.accountID; lastRefresh = saved.lastRefresh
            connected = accountID != nil
        }
        pinned = UserDefaults.standard.bool(forKey: "pinned")
        loginAtLaunch = SMAppService.mainApp.status == .enabled
        auth.onReady = { [weak self] in
            guard let self else { return }
            Task { try? await Task.sleep(for: .seconds(2)); await self.refresh(force: true) }
        }
        auth.onError = { [weak self] message in self?.error = message }
        if connected { auth.prepare(restoring: true) }
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in Task { await self?.refresh() } }
        timer?.tolerance = 20
        if let timer { RunLoop.main.add(timer, forMode: .common) }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in await self?.refresh(force: true) } }
        Task { await updateNotificationPermission(); if !connected { await refresh() } }
    }

    func signIn() {
        guard !isDemo else { return }
        error = nil; awaitingLogin = true
        auth.showLogin()
        loginTimer?.invalidate()
        loginTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in Task { await self?.refresh(force: true) } }
        if let loginTimer { RunLoop.main.add(loginTimer, forMode: .common) }
    }

    func refresh(force: Bool = false) async {
        guard !isDemo, !busy else { return }
        // A failed service request backs off: 5, 10, 20, 40, then 60 minutes.
        if !force && Date().timeIntervalSince(lastAttempt) < min(3600, 300 * pow(2, Double(retryCount))) { return }
        busy = true; lastAttempt = Date()
        await updateNotificationPermission()
        let currentGeneration = generation
        defer { busy = false }
        do {
            if connected || awaitingLogin {
                let result = try await auth.sync(numbers: parcels.map(\.id), accountID: accountID)
                guard generation == currentGeneration else { return }
                switch result["kind"] as? String {
                case "success":
                    guard let newID = result["accountID"] as? String, let rows = result["rows"] as? [[String: Any]] else { throw TrackingError.message("Неповна відповідь кабінету.") }
                    let wasAwaitingLogin = awaitingLogin
                    if accountID != newID {
                        parcels = []; lastRefresh = nil
                        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                    }
                    accountID = newID; connected = true; awaitingLogin = false; refreshingSession = false
                    loginTimer?.invalidate(); loginTimer = nil
                    let incoming = rows.compactMap { Parcel.from($0, direction: $0["direction"] as? String ?? "incoming") }
                    guard rows.isEmpty || !incoming.isEmpty else { throw TrackingError.message("Формат статусів змінився. Збережені дані залишилися без змін.") }
                    merge(incoming)
                    if wasAwaitingLogin { auth.hideLogin() }
                case "expired":
                    if !refreshingSession { refreshingSession = true; auth.reload() }
                    else { error = "Сесію завершено. Відкрийте акаунт і увійдіть повторно."; awaitingLogin = false; loginTimer?.invalidate(); retryCount = 3 }
                    return
                case "login":
                    if connected && !awaitingLogin { error = "Потрібен повторний вхід до Нової пошти." }
                    return
                case "loading": return
                default:
                    throw TrackingError.message(result["message"] as? String ?? "Не вдалося синхронізувати посилки.")
                }
            } else if !parcels.isEmpty {
                let rows = try await TrackingAPI().track(parcels.map(\.id))
                guard generation == currentGeneration else { return }
                guard !rows.isEmpty else { throw TrackingError.message("Нова пошта не повернула статусів. Спробуйте увійти до акаунта.") }
                merge(rows)
            } else { return }
            lastRefresh = Date(); error = nil; retryCount = 0
            persist()
        } catch {
            guard generation == currentGeneration else { return }
            self.error = error.localizedDescription
            retryCount = min(4, retryCount + 1)
            // Stop an interactive polling loop on API errors. User can retry.
            loginTimer?.invalidate(); loginTimer = nil
        }
    }

    func add(number raw: String, title: String) async -> Bool {
        let number = Parcel.normalizedNumber(raw)
        guard Parcel.validNumber(number) else { error = "ТТН має містити 14 цифр."; return false }
        guard !parcels.contains(where: { $0.id == number }) else { error = "Ця посилка вже відстежується."; return false }
        guard !busy else { return false }
        busy = true
        let currentGeneration = generation
        defer { busy = false }
        do {
            var incoming = try await TrackingAPI().track([number])
            guard generation == currentGeneration else { return false }
            guard incoming.count == 1 else { throw TrackingError.message("Посилку не знайдено. Перевірте номер ТТН.") }
            incoming[0].isManual = true
            if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { incoming[0].title = title }
            merge(incoming); lastRefresh = Date(); error = nil; persist()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    private func merge(_ incoming: [Parcel]) {
        let result = ParcelMerge.apply(existing: parcels, incoming: incoming)
        parcels = result.parcels
        for change in result.changes { sendNotification(change) }
    }
    private func sendNotification(_ change: Change) {
        guard notificationsGranted else { return }
        let content = UNMutableNotificationContent()
        content.title = change.new.isReady ? "Посилка вже чекає на вас 📦" : "Статус посилки змінився"
        content.subtitle = change.new.title
        content.body = "\(change.new.id)\n\(change.new.status)"
        content.sound = .default
        content.threadIdentifier = change.new.id
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            if error != nil { Task { @MainActor in self?.error = "macOS не доставила сповіщення. Перевірте налаштування сповіщень." } }
        }
    }
    func updateNotificationPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationsGranted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        if notificationsGranted && error == notificationPermissionMessage { error = nil }
    }
    func enableNotifications() {
        Task {
            do { notificationsGranted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
            catch { self.error = "Не вдалося ввімкнути сповіщення." }
            if !notificationsGranted { self.error = notificationPermissionMessage }
        }
    }
    func testNotification() {
        guard notificationsGranted else { enableNotifications(); return }
        let c = UNMutableNotificationContent(); c.title = "Nova Parcel"; c.body = "Сповіщення працюють. Повідомимо, коли статус посилки зміниться."; c.sound = .default
        Task {
            do {
                try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "notification-test", content: c, trigger: nil))
                try? await Task.sleep(for: .seconds(2))
                let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
                notificationTestResult = delivered.contains { $0.request.identifier == "notification-test" }
                    ? "Тестове сповіщення доставлено в Центр сповіщень."
                    : "Сповіщення передано macOS. Якщо банера немає, перевірте режим «Зосередження»."
            } catch { self.error = "macOS не прийняла тестове сповіщення." }
        }
    }
    func signOut() {
        generation += 1
        loginTimer?.invalidate(); loginTimer = nil
        awaitingLogin = false; connected = false; accountID = nil
        parcels = []; lastRefresh = nil; error = nil; refreshingSession = false
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        persist()
        Task { await auth.signOut() }
    }
    func setPinned(_ value: Bool) { pinned = value; UserDefaults.standard.set(value, forKey: "pinned"); onPin?(value) }
    func setLoginAtLaunch(_ value: Bool) {
        do {
            if value { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginAtLaunch = SMAppService.mainApp.status == .enabled
            if SMAppService.mainApp.status == .requiresApproval { error = "Підтвердьте автозапуск у Системних параметрах → Основні → Елементи входу." }
        } catch { self.error = "Не вдалося змінити автозапуск. Перемістіть застосунок у папку «Програми» та спробуйте ще раз." }
    }
    private func persist() {
        guard !isDemo else { return }
        do {
            let directory = dataURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(SavedState(parcels: parcels, accountID: accountID, lastRefresh: lastRefresh))
            try data.write(to: dataURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dataURL.path)
        } catch { self.error = "Не вдалося зберегти посилки на цьому Mac." }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound, .list] }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async { await MainActor.run { self.onShow?() } }

    private func loadDemo() {
        isDemo = true; connected = true; notificationsGranted = true; lastRefresh = Date()
        parcels = [
            Parcel(id: "20450000000001", title: "Книжки на вихідні", status: "Прибув у відділення", code: "7", origin: "Львів", destination: "Київ · Відділення № 24", expected: "", updatedAt: Date(), direction: "incoming"),
            Parcel(id: "20450000000002", title: "Нова клавіатура", status: "Прямує до міста отримувача", code: "5", origin: "Одеса", destination: "Київ · Поштомат № 1024", expected: "18.09.2026", updatedAt: Date(), direction: "incoming")
        ]
    }
}
