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

    /// 保留空字符串。更新时用它区分「没传这个字段」和「要清空」。
    static func text(_ object: [String: Any], _ key: String) -> String? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        return value as? String
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

/// TCC 按「责任进程」判定授权。被宿主直接 spawn 的进程拿到的是宿主的归属，
/// 日历权限会静默变成 notDetermined。交给 LaunchServices 重新起一个自己，
/// 它才是自己的责任进程。MCP 这种长驻 stdio 进程只能这样转发。
enum LaunchCall {
    static func run(_ method: String, _ input: [String: Any]) -> [String: Any]? {
        let bundle = Bundle.main.bundleURL
        guard bundle.pathExtension == "app" else { return nil }
        let manager = FileManager.default
        let dir = manager.temporaryDirectory.appendingPathComponent("ios-agenda-\(UUID().uuidString)", isDirectory: true)
        try? manager.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: dir) }
        let inputPath = dir.appendingPathComponent("input.json")
        let outputPath = dir.appendingPathComponent("output.json")
        let errorPath = dir.appendingPathComponent("stderr.txt")
        guard let data = try? JSON.data(input), (try? data.write(to: inputPath)) != nil else { return nil }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [
            "-W", "-n", "-a", bundle.path,
            "--stdout", outputPath.path,
            "--stderr", errorPath.path,
            "--args", "call-file", method, inputPath.path,
        ]
        do {
            try process.run()
        } catch {
            return nil
        }
        // 授权框等人点的时候别无限挂着。
        let deadline = DispatchWorkItem {
            guard process.isRunning else { return }
            process.terminate()
            let killer = Process()
            killer.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            // 只收掉转发出来的那次调用，别误伤正在跑 MCP 的自己。
            killer.arguments = ["-f", "\(bundle.appendingPathComponent("Contents/MacOS").path) call-file"]
            try? killer.run()
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 150, execute: deadline)
        process.waitUntilExit()
        deadline.cancel()
        guard let output = try? Data(contentsOf: outputPath) else { return nil }
        let text = String(decoding: output, as: UTF8.self)
        guard let line = text.split(separator: "\n").last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
    }
}

func envelope(error: AgendaError) -> [String: Any] {
    var body: [String: Any] = ["code": error.code, "message": error.message]
    if let access = error.access { body["access"] = access }
    return ["ok": false, "error": body]
}
