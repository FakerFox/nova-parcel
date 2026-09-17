import Foundation

@main
struct CoreTests {
    static func main() throws {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ name: String) {
            guard value() else { fatalError("FAIL: \(name)") }; checks += 1
        }
        let row: [String: Any] = ["Number": "20450000000001", "Status": "В дорозі", "StatusCode": "5", "CitySender": "Львів"]
        let initial = Parcel.from(row)!
        check(ParcelMerge.apply(existing: [], incoming: [initial]).changes.isEmpty, "first sync is silent")
        check(ParcelMerge.apply(existing: [initial], incoming: [initial]).changes.isEmpty, "unchanged is silent")
        var ready = initial; ready.code = "7"; ready.status = "Прибув у відділення"
        let merge = ParcelMerge.apply(existing: [initial], incoming: [ready])
        check(merge.changes.count == 1 && merge.parcels[0].isReady, "ready transition")
        var textChange = ready; textChange.status = "Прибув у поштомат"
        check(ParcelMerge.apply(existing: [ready], incoming: [textChange]).changes.count == 1, "status text changes")
        var codeChange = ready; codeChange.code = "8"
        check(ParcelMerge.apply(existing: [ready], incoming: [codeChange]).changes.count == 1, "status code changes")
        let state = SavedState(parcels: [ready], accountID: "test", lastRefresh: Date())
        let restored = try JSONDecoder().decode(SavedState.self, from: JSONEncoder().encode(state))
        check(ParcelMerge.apply(existing: restored.parcels, incoming: [ready]).changes.isEmpty, "restart doesn't repeat notifications")
        check(ParcelMerge.apply(existing: [ready], incoming: []).parcels == [ready], "empty response preserves baseline")
        check(Parcel.from(["Number": initial.id, "Status": "broken"]) == nil, "partial response rejected")
        check(Parcel.validNumber("20450000000001"), "valid number")
        check(!Parcel.validNumber("2045000000000"), "short number")
        check(!Parcel.validNumber("２０４５０００００００００１"), "non-ASCII rejected")
        check(Parcel.normalizedNumber("2045 0000-0000 01") == initial.id, "pasted number normalization")
        var delivered = ready; delivered.code = "9"
        check(delivered.isDelivered, "delivered classified")
        let rows = try TrackingAPI.decode(Data("{\"success\":true,\"data\":[]}".utf8))
        check(rows.isEmpty, "empty successful API")
        do { _ = try TrackingAPI.decode(Data("{\"success\":false,\"data\":[]}".utf8)); fatalError("accepted error") } catch { checks += 1 }
        do { _ = try TrackingAPI.decode(Data("{\"success\":true,\"data\":{}}".utf8)); fatalError("accepted bad schema") } catch { checks += 1 }
        var named = initial; named.title = "Книжки"; named.isManual = true
        let retained = ParcelMerge.apply(existing: [named], incoming: [ready]).parcels[0]
        check(retained.title == "Книжки" && retained.isManual, "manual name retained")
        var describedRow = row; describedRow["Description"] = "  Манґа: том 2  "
        let described = Parcel.from(describedRow)!
        let titled = ParcelMerge.apply(existing: [initial], incoming: [described])
        check(titled.parcels[0].title == "Манґа: том 2", "description replaces cached generic title")
        check(titled.changes.isEmpty, "adding a description is not a status notification")
        check(ParcelMerge.apply(existing: titled.parcels, incoming: [initial]).parcels[0].title == "Манґа: том 2", "missing later description preserves known title")
        describedRow["Description"] = " \n "; describedRow["CargoDescription"] = "Настільна гра"
        check(Parcel.from(describedRow)?.title == "Настільна гра", "blank description falls back to cargo description")
        print("Core: \(checks) checks passed")
    }
}
