import Darwin
import Foundation

struct AgendaError: Error, Sendable {
    var code: String
    var message: String
    var access: [String: String]? = nil
}

enum JSON {
    static func object(from data: Data) throws -> [String: Any] {
        if data.isEmpty { return [:] }
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any] else {
            throw AgendaError(code: "BAD_INPUT", message: "输入必须是 JSON 对象")
        }
        return object
    }

    static func string(_ object: [String: Any], _ key: String) -> String? {
        guard let value = object[key] else { return nil }
        if value is NSNull { return nil }
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func bool(_ object: [String: Any], _ key: String) -> Bool? {
        object[key] as? Bool
    }

    static func int(_ object: [String: Any], _ key: String) -> Int? {
        if let value = object[key] as? Int { return value }
        if let value = object[key] as? Double { return Int(value) }
        if let value = object[key] as? String, let parsed = Int(value) { return parsed }
        return nil
    }

    static func data(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
}

enum Dates {
    static func parse(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: text) { return date }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = .current
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: text)
    }

    static func isDateOnly(_ text: String) -> Bool {
        text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    static func format(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func startOfToday() -> Date {
        Calendar.current.startOfDay(for: Date())
    }
}

func writeStdout(_ object: [String: Any]) {
    let data = (try? JSON.data(object)) ?? Data(#"{"ok":false,"error":{"code":"ENCODE","message":"结果无法编码"}}"#.utf8)
    var bytes = Array(data)
    bytes.append(0x0A)
    _ = Darwin.write(STDOUT_FILENO, &bytes, bytes.count)
}

func envelope(ok data: [String: Any]) -> [String: Any] {
    ["ok": true, "data": data]
}

func envelope(error: AgendaError) -> [String: Any] {
    var body: [String: Any] = ["code": error.code, "message": error.message]
    if let access = error.access { body["access"] = access }
    return ["ok": false, "error": body]
}
