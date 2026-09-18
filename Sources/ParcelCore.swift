import Foundation

struct Parcel: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var status: String
    var code: String
    var origin: String
    var destination: String
    var expected: String
    var updatedAt: Date
    var direction: String
    var isManual: Bool = false

    var isDelivered: Bool { ["9", "10", "11"].contains(code) }
    var isReady: Bool { ["7", "8"].contains(code) }
    var isOutgoing: Bool { direction == "outgoing" }
    var tab: String { isOutgoing ? "outgoing" : "incoming" }
    var stageTitle: String {
        isReady ? (isOutgoing ? "ЧЕКАЄ НА ОТРИМУВАЧА" : "МОЖНА ЗАБИРАТИ") : isDelivered ? "ОТРИМАНО" : ["1", "2"].contains(code) ? "ОЧІКУЄ ВІДПРАВКИ" : "У ДОРОЗІ"
    }
    var symbol: String { isDelivered ? "checkmark.circle.fill" : isReady ? "shippingbox.fill" : "truck.box.fill" }
    var phase: Int { isDelivered ? 3 : isReady ? 2 : ["1", "2"].contains(code) ? 0 : 1 }
    var fingerprint: String { code + "|" + status.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func from(_ row: [String: Any], direction: String = "", now: Date = Date()) -> Parcel? {
        func value(_ keys: String...) -> String {
            for key in keys {
                if let s = row[key] as? String {
                    let text = s.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { return text }
                }
                if let n = row[key] as? NSNumber { return n.stringValue }
            }
            return ""
        }
        let number = value("Number", "IntDocNumber", "DocumentNumber")
        guard validNumber(number) else { return nil }
        let status = value("Status", "TrackingStatus", "StatusDescription")
        let code = value("StatusCode", "TrackingStatusCode")
        // A partial or unknown API response must never replace a valid baseline.
        guard !status.isEmpty, !code.isEmpty else { return nil }
        let title = value("Description", "CargoDescriptionString", "CargoDescription", "DescriptionOfCargo")
        return Parcel(id: number, title: title.isEmpty ? "Посилка" : title, status: status,
            code: code, origin: value("CitySender", "CitySenderDescription"),
            destination: value("WarehouseRecipient", "RecipientAddress", "RecipientAddressDescription", "CityRecipient"),
            expected: value("ScheduledDeliveryDate", "ExpectedDeliveryDate"), updatedAt: now, direction: direction)
    }

    static func normalizedNumber(_ input: String) -> String {
        input.filter { !$0.isWhitespace && $0 != "-" }
    }
    static func validNumber(_ number: String) -> Bool {
        number.count == 14 && number.utf8.allSatisfy { (48...57).contains($0) }
    }
}

struct Change: Equatable {
    var old: Parcel; var new: Parcel
    var shouldOpenWidget: Bool { !old.isReady && new.isReady }
}
struct MergeResult { var parcels: [Parcel]; var changes: [Change] }

enum ParcelMerge {
    static func apply(existing: [Parcel], incoming: [Parcel]) -> MergeResult {
        var map = Dictionary(existing.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        var changes: [Change] = []
        for var parcel in incoming {
            if !["incoming", "outgoing"].contains(parcel.direction) { parcel.direction = map[parcel.id]?.tab ?? "incoming" }
            if let old = map[parcel.id] {
                parcel.isManual = old.isManual
                if parcel.title == "Посилка" { parcel.title = old.title }
                if old.fingerprint != parcel.fingerprint { changes.append(Change(old: old, new: parcel)) }
            }
            map[parcel.id] = parcel
        }
        return MergeResult(parcels: map.values.sorted {
            if $0.isDelivered != $1.isDelivered { return !$0.isDelivered }
            return $0.id > $1.id
        }, changes: changes)
    }
}

struct SavedState: Codable {
    var parcels: [Parcel] = []
    var accountID: String? = nil
    var lastRefresh: Date? = nil
}

enum TrackingError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

struct TrackingAPI {
    var session: URLSession = .shared
    func track(_ numbers: [String]) async throws -> [Parcel] {
        guard !numbers.isEmpty else { return [] }
        var all: [Parcel] = []
        for offset in stride(from: 0, to: numbers.count, by: 100) {
            let batch = Array(numbers[offset..<min(offset + 100, numbers.count)])
            var request = URLRequest(url: URL(string: "https://api.novaposhta.ua/v2.0/json/")!)
            request.httpMethod = "POST"
            request.timeoutInterval = 25
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "apiKey": "", "modelName": "TrackingDocument", "calledMethod": "getStatusDocuments",
                "methodProperties": ["Documents": batch.map { ["DocumentNumber": $0] }, "Language": "UA"]
            ])
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                throw TrackingError.message("Нова пошта тимчасово не відповідає. Спробуйте пізніше.")
            }
            let rows = try Self.decode(data)
            all += rows.compactMap { Parcel.from($0) }
        }
        return all
    }
    static func decode(_ data: Data) throws -> [[String: Any]] {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any], json["success"] as? Bool == true else {
            throw TrackingError.message("Не вдалося отримати статус. Перевірте ТТН або увійдіть до акаунта.")
        }
        guard let rows = json["data"] as? [[String: Any]] else {
            throw TrackingError.message("Формат відповіді Нової пошти змінився.")
        }
        return rows
    }
}
