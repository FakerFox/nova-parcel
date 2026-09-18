import SwiftUI
import AppKit

private let accent = Color(red: 0.96, green: 0.27, blue: 0.23)
private let ink = Color(red: 0.12, green: 0.13, blue: 0.16)
private let secondary = Color(red: 0.45, green: 0.47, blue: 0.50)
private let canvas = Color(red: 0.965, green: 0.957, blue: 0.945)

struct WidgetView: View {
    @ObservedObject var store: ParcelStore
    @State private var showAdd = false
    @State private var showSettings = false
    var body: some View {
        VStack(spacing: 0) {
            header
            if store.isDemo { Text("ДЕМО · ВИГАДАНІ ПОСИЛКИ").font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(accent).padding(.bottom, 10) }
            if store.parcels.isEmpty && !store.connected { onboarding }
            else { parcelList }
            footer
        }
        .frame(minWidth: 380, idealWidth: 400, maxWidth: .infinity, minHeight: 520, maxHeight: .infinity)
        .background(canvas)
        .foregroundStyle(ink)
        .preferredColorScheme(.light)
        .sheet(isPresented: $showAdd) { AddParcelView(store: store, direction: store.selectedDirection) }
        .sheet(isPresented: $showSettings) { SettingsView(store: store) }
    }
    private var header: some View {
        HStack(spacing: 10) {
            ZStack { RoundedRectangle(cornerRadius: 11).fill(accent).frame(width: 36, height: 36)
                Image(systemName: "shippingbox.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white) }
            VStack(alignment: .leading, spacing: 2) {
                Text("Nova Parcel").font(.system(size: 14, weight: .bold))
                Text("НОВА ПОШТА · НЕОФІЦІЙНИЙ ВІДЖЕТ").font(.system(size: 8, weight: .medium, design: .monospaced)).tracking(0.5).foregroundStyle(secondary)
            }
            Spacer()
            Button { store.setPinned(!store.pinned) } label: { Image(systemName: store.pinned ? "pin.fill" : "pin").foregroundStyle(store.pinned ? accent : secondary) }
                .buttonStyle(.plain).help("Закріпити поверх вікон").accessibilityLabel("Закріпити поверх вікон")
            Button { showSettings = true } label: { Image(systemName: "slider.horizontal.3").foregroundStyle(secondary) }
                .buttonStyle(.plain).help("Налаштування").accessibilityLabel("Налаштування")
        }.padding(.horizontal, 24).padding(.top, 18).padding(.bottom, 24)
    }
    private var onboarding: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack { Text("ВАША ДОСТАВКА, ПОРУЧ").font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(2).foregroundStyle(accent); Spacer() }
            Text("Посилки.\nПід контролем.").font(.system(size: 37, weight: .bold, design: .rounded)).tracking(-1.5).lineSpacing(-1).padding(.top, 12)
            Text("Увійдіть до Нової пошти — і відстежуйте\nсвої посилки просто з робочого столу.").font(.system(size: 13)).foregroundStyle(secondary).lineSpacing(5).padding(.top, 12)
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(accent.opacity(0.09)).frame(width: 64, height: 64)
                    Image(systemName: "bell.badge").font(.system(size: 25, weight: .light)).foregroundStyle(accent)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Статус змінився? Ви знатимете.").font(.system(size: 12, weight: .semibold))
                    Text("Перевірка кожні 5 хвилин,\nпоки Mac не спить.").font(.system(size: 11)).foregroundStyle(secondary).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                }
            }.padding(.vertical, 28)
            Button { store.signIn() } label: {
                HStack { Text(store.awaitingLogin ? "Продовжити вхід" : "Увійти за номером телефону"); Spacer(); Image(systemName: "arrow.up.right") }
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).padding(16).background(accent, in: RoundedRectangle(cornerRadius: 13))
            }.buttonStyle(.plain)
            Button { showAdd = true } label: { Text("або додати посилку за ТТН").font(.system(size: 12)).foregroundStyle(secondary).frame(maxWidth: .infinity).padding(.vertical, 16) }.buttonStyle(.plain)
            if let error = store.error { errorBanner(error) }
            Spacer(minLength: 12)
        }.padding(.horizontal, 28)
    }
    private var parcelList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(store.selectedDirection == "outgoing" ? "Відправлення" : "Отримання").font(.system(size: 26, weight: .bold, design: .rounded)).tracking(-0.8)
                Spacer()
                Button { showAdd = true } label: { Image(systemName: "plus").font(.system(size: 17)).foregroundStyle(secondary) }.buttonStyle(.plain).accessibilityLabel("Додати ТТН")
            }.padding(.horizontal, 24)
            HStack(spacing: 4) {
                directionTab("Отримання", direction: "incoming", symbol: "arrow.down.left")
                directionTab("Відправлення", direction: "outgoing", symbol: "arrow.up.right")
            }.padding(4).background(ink.opacity(0.045), in: RoundedRectangle(cornerRadius: 12)).padding(.horizontal, 24)
            HStack {
                Label(store.connected ? "Акаунт підключено" : "Відстеження за ТТН", systemImage: store.connected ? "checkmark.shield" : "number")
                    .font(.system(size: 10)).foregroundStyle(secondary)
                Spacer()
                Button { store.showCompleted.toggle() } label: { Text(store.showCompleted ? "Лише активні" : "Усі посилки").font(.system(size: 10)).foregroundStyle(secondary) }.buttonStyle(.plain)
            }.padding(.horizontal, 24)
            if let error = store.error { errorBanner(error).padding(.horizontal, 24) }
            ScrollViewReader { reader in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if store.visibleParcels.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "tray").font(.system(size: 35, weight: .light)).foregroundStyle(secondary)
                            Text(store.selectedDirection == "outgoing" ? "Відправлених посилок поки немає" : "Посилок до вас поки немає").font(.system(size: 13, weight: .medium))
                            Text("Нові посилки з’являться після перевірки.\nТакож можна додати ТТН вручну.").font(.system(size: 12)).foregroundStyle(secondary).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity).padding(.vertical, 60)
                    }
                    ForEach(store.visibleParcels) { parcel in ParcelCard(parcel: parcel) }
                }.padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 16)
            }
            .onChange(of: store.focusedParcelID) { _, id in if let id { reader.scrollTo(id, anchor: .top) } }
            .onChange(of: store.selectedDirection) { _, _ in if let first = store.visibleParcels.first { reader.scrollTo(first.id, anchor: .top) } }
            }
            if !store.notificationsGranted {
                Button { store.enableNotifications() } label: {
                    Label("Увімкнути сповіщення про зміни", systemImage: "bell.badge").font(.system(size: 11, weight: .medium)).foregroundStyle(accent).frame(maxWidth: .infinity).padding(12)
                }.buttonStyle(.plain).padding(.horizontal, 24).background(.white.opacity(0.4))
            }
        }
    }
    private func directionTab(_ title: String, direction: String, symbol: String) -> some View {
        Button { store.selectedDirection = direction } label: {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 10, weight: .semibold))
                Text(title).font(.system(size: 11, weight: .semibold))
                Text("\(store.activeCount(direction))").font(.system(size: 10, weight: .bold)).foregroundStyle(accent)
            }.frame(maxWidth: .infinity).padding(.vertical, 10)
                .foregroundStyle(store.selectedDirection == direction ? ink : secondary)
                .background(store.selectedDirection == direction ? Color.white : Color.clear, in: RoundedRectangle(cornerRadius: 9))
        }.buttonStyle(.plain).accessibilityLabel(title).accessibilityAddTraits(store.selectedDirection == direction ? .isSelected : [])
    }
    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle().fill(ink.opacity(0.07)).frame(height: 1)
            HStack(spacing: 6) {
                Circle().fill(store.error != nil ? Color.orange : store.connected || !store.parcels.isEmpty ? Color.green : secondary.opacity(0.4)).frame(width: 5, height: 5)
                if store.busy { Text("Перевіряємо статуси…") }
                else if let last = store.lastRefresh { Text("Оновлено \(last.formatted(date: .omitted, time: .shortened))") }
                else { Text(store.awaitingLogin ? "Очікуємо на вхід" : "Готовий до підключення") }
                Spacer()
                Button { Task { await store.refresh(force: true) } } label: { Image(systemName: "arrow.clockwise").font(.system(size: 12)) }
                    .buttonStyle(.plain).disabled(store.busy || store.isDemo).help("Оновити").accessibilityLabel("Оновити")
            }.font(.system(size: 10)).foregroundStyle(secondary).padding(.horizontal, 24).padding(.vertical, 15)
        }
    }
    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
            Text(message).fixedSize(horizontal: false, vertical: true)
        }.font(.system(size: 11)).foregroundStyle(Color(red: 0.59, green: 0.32, blue: 0.1)).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct ParcelCard: View {
    let parcel: Parcel
    private var color: Color { parcel.isReady ? accent : parcel.isDelivered ? .green : ink }
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Image(systemName: parcel.symbol).font(.system(size: 15)).foregroundStyle(color)
                Text(parcel.stageTitle).font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1).foregroundStyle(color)
                Spacer()
                Image(systemName: parcel.direction == "outgoing" ? "arrow.up.right" : "arrow.down.left").font(.system(size: 10)).foregroundStyle(secondary)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(parcel.title).font(.system(size: 17, weight: .semibold, design: .rounded)).lineLimit(3).help(parcel.title)
                Text(parcel.id).font(.system(size: 11, design: .monospaced)).foregroundStyle(secondary).textSelection(.enabled)
            }
            HStack(spacing: 4) {
                ForEach(0..<4) { index in Capsule().fill(index <= parcel.phase ? color : ink.opacity(0.08)).frame(height: 3) }
            }
            Text(parcel.status).font(.system(size: 12, weight: .medium)).fixedSize(horizontal: false, vertical: true)
            if !parcel.destination.isEmpty {
                Label(parcel.destination, systemImage: "mappin").font(.system(size: 11)).foregroundStyle(secondary).lineLimit(2)
            }
            if !parcel.expected.isEmpty && !parcel.isDelivered && !parcel.isReady {
                Label("Очікуємо: \(parcel.expected)", systemImage: "calendar").font(.system(size: 10)).foregroundStyle(secondary)
            }
            if Date().timeIntervalSince(parcel.updatedAt) > 900 {
                Text("Статус може бути застарілим").font(.system(size: 10)).foregroundStyle(.orange)
            }
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(parcel.isReady ? accent.opacity(0.22) : ink.opacity(0.055), lineWidth: 1))
            .contextMenu { Button("Скопіювати ТТН") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(parcel.id, forType: .string) } }
    }
}

struct AddParcelView: View {
    @ObservedObject var store: ParcelStore
    @Environment(\.dismiss) var dismiss
    @State private var number = ""
    @State private var title = ""
    @State var direction: String
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Додати посилку").font(.system(size: 22, weight: .bold, design: .rounded))
            Picker("Напрямок", selection: $direction) {
                Text("Отримання").tag("incoming")
                Text("Відправлення").tag("outgoing")
            }.pickerStyle(.segmented)
            TextField("Номер ТТН · 14 цифр", text: $number).textFieldStyle(.roundedBorder)
            TextField("Назва, наприклад «Книжки»", text: $title).textFieldStyle(.roundedBorder)
            if let error = store.error { Text(error).font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Скасувати") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(store.busy ? "Перевіряємо…" : "Відстежувати") { Task { if await store.add(number: number, title: title, direction: direction) { dismiss() } } }
                    .buttonStyle(.borderedProminent).tint(accent).keyboardShortcut(.defaultAction).disabled(store.busy || number.isEmpty || store.isDemo)
            }
        }.padding(28).frame(width: 350)
    }
}

struct SettingsView: View {
    @ObservedObject var store: ParcelStore
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text("Налаштування").font(.system(size: 22, weight: .bold, design: .rounded)); Spacer(); Button("Готово") { dismiss() } }
            VStack(alignment: .leading, spacing: 12) {
                Label(store.connected ? "Акаунт Нової пошти підключено" : "Акаунт не підключено", systemImage: "person.crop.circle").font(.system(size: 13, weight: .medium))
                HStack {
                    Button(store.connected ? "Відкрити акаунт" : "Увійти за телефоном") { dismiss(); store.signIn() }
                    if store.connected { Button("Вийти", role: .destructive) { store.signOut() } }
                }
                Text("Вихід прибере з цього Mac сесію та список посилок. Дані в Новій пошті залишаться.").font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            Toggle("Поверх інших вікон", isOn: Binding(get: { store.pinned }, set: { store.setPinned($0) }))
            Toggle("Запускати разом із Mac", isOn: Binding(get: { store.loginAtLaunch }, set: { store.setLoginAtLaunch($0) }))
            HStack { Text("Сповіщення"); Spacer(); Button(store.notificationsGranted ? "Тестове сповіщення" : "Дозволити") { store.testNotification() } }
            if let result = store.notificationTestResult { Text(result).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            Text("Перевіряємо зміни кожні 5 хвилин, поки Mac не спить. Віджет сам відкриється, коли посилка прибуде у відділення або поштомат. Решта змін — у сповіщеннях. Відкрити вручну можна через коробку в рядку меню.").font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).lineSpacing(3)
            Text("Локальна експериментальна версія. Підключення акаунта залежить від вебкабінету Нової пошти. Системний віджет WidgetKit ще не входить до цієї версії.").font(.system(size: 10)).foregroundStyle(.secondary).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            if let error = store.error { Text(error).font(.system(size: 11)).foregroundStyle(.red) }
            HStack { Text("Nova Parcel 0.3.0").font(.system(size: 10)).foregroundStyle(.secondary); Spacer(); Button("Завершити роботу") { NSApp.terminate(nil) } }
        }.padding(28).frame(width: 380).disabled(store.isDemo)
    }
}
