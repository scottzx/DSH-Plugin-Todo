import AppKit
import Darwin
import Foundation

enum AgendaMethods {
    static let names = ["snapshot", "createReminder", "completeReminder", "deleteReminder", "createEvent", "deleteEvent"]

    @MainActor
    static func call(_ name: String, _ input: [String: Any], store: AgendaStore) async -> [String: Any] {
        do {
            let data: [String: Any]
            switch name {
            case "snapshot": data = try await store.snapshot(input)
            case "createReminder": data = try await store.createReminder(input)
            case "completeReminder": data = try await store.completeReminder(input)
            case "deleteReminder": data = try await store.deleteReminder(input)
            case "createEvent": data = try await store.createEvent(input)
            case "deleteEvent": data = try await store.deleteEvent(input)
            default:
                throw AgendaError(code: "UNKNOWN_METHOD", message: "未知方法 \(name)")
            }
            return envelope(ok: data)
        } catch let error as AgendaError {
            return envelope(error: error)
        } catch {
            return envelope(error: AgendaError(code: "FAILED", message: error.localizedDescription))
        }
    }
}

enum MCPServer {
    private static let supported = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"]

    static func serve() {
        let box = StoreBox()
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let queue = DispatchQueue(label: "work.1agents.ios-agenda.stdin")
        queue.async {
            var buffer = Data()
            var chunk = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = Darwin.read(STDIN_FILENO, &chunk, chunk.count)
                if count <= 0 { break }
                buffer.append(contentsOf: chunk.prefix(count))
                while let newline = buffer.firstIndex(of: 0x0A) {
                    let raw = buffer.prefix(upTo: newline)
                    buffer.removeSubrange(...newline)
                    let text = String(decoding: raw, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                    if text.isEmpty { continue }
                    let message = text
                    DispatchQueue.main.async {
                        Task { @MainActor in
                            await handleLine(message, box: box)
                        }
                    }
                }
            }
            DispatchQueue.main.async {
                app.terminate(nil)
            }
        }
        app.run()
    }

    @MainActor
    private static func handleLine(_ line: String, box: StoreBox) async {
        guard let data = line.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = message["method"] as? String else {
            writeStdout(["jsonrpc": "2.0", "id": NSNull(), "error": ["code": -32700, "message": "Parse error"]])
            return
        }
        guard let id = message["id"] else { return }
        let params = message["params"] as? [String: Any] ?? [:]
        switch method {
            case "initialize":
                let requested = params["protocolVersion"] as? String ?? "2025-03-26"
                let version = supported.contains(requested) ? requested : "2025-03-26"
                writeStdout([
                    "jsonrpc": "2.0",
                    "id": id as Any,
                    "result": [
                        "protocolVersion": version,
                        "capabilities": ["tools": ["listChanged": false]],
                        "serverInfo": ["name": "ios-agenda", "version": "0.1.0"],
                    ],
                ])
            case "ping":
                writeStdout(["jsonrpc": "2.0", "id": id as Any, "result": [:]])
            case "tools/list":
                writeStdout(["jsonrpc": "2.0", "id": id as Any, "result": ["tools": tools()]])
            case "tools/call":
                let name = params["name"] as? String ?? ""
                let arguments = params["arguments"] as? [String: Any] ?? [:]
                let methodName = name.replacingOccurrences(of: "agenda_", with: "")
                let mapped = mapTool(methodName)
                if box.store == nil { box.store = AgendaStore() }
                let result = await AgendaMethods.call(mapped, arguments, store: box.store!)
                let text = String(data: (try? JSON.data(result)) ?? Data(), encoding: .utf8) ?? ""
                var body: [String: Any] = [
                    "content": [["type": "text", "text": text]],
                    "isError": (result["ok"] as? Bool) != true,
                ]
                if let data = result["data"] as? [String: Any] {
                    body["structuredContent"] = data
                } else if let error = result["error"] as? [String: Any] {
                    body["structuredContent"] = ["ok": false, "error": error]
                }
                writeStdout(["jsonrpc": "2.0", "id": id as Any, "result": body])
            default:
            writeStdout(["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "Method not found"]])
        }
    }

    private static func mapTool(_ name: String) -> String {
        switch name {
        case "snapshot", "reminders", "events", "lists", "calendars": return "snapshot"
        case "create_reminder": return "createReminder"
        case "complete_reminder": return "completeReminder"
        case "delete_reminder": return "deleteReminder"
        case "create_event": return "createEvent"
        case "delete_event": return "deleteEvent"
        default: return name
        }
    }

    private static func tools() -> [[String: Any]] {
        return [
            tool("agenda_snapshot", "读取这台 Mac 上已同步的提醒事项和日历。默认返回未完成提醒，以及从今天起 7 天内的日程。", [
                "type": "object",
                "properties": [
                    "reminderList": ["type": "string", "description": "提醒列表名称或 id"],
                    "calendar": ["type": "string", "description": "日历名称或 id"],
                    "from": ["type": "string", "description": "ISO 8601 或 YYYY-MM-DD"],
                    "to": ["type": "string", "description": "ISO 8601 或 YYYY-MM-DD"],
                    "includeCompleted": ["type": "boolean"],
                    "limit": ["type": "integer"],
                ],
            ]),
            tool("agenda_create_reminder", "在系统提醒事项中新建一条。", [
                "type": "object",
                "properties": [
                    "title": ["type": "string"],
                    "list": ["type": "string"],
                    "notes": ["type": "string"],
                    "due": ["type": "string"],
                    "priority": ["type": "string", "enum": ["none", "low", "medium", "high"]],
                ],
                "required": ["title"],
            ]),
            tool("agenda_complete_reminder", "把一条提醒事项标为完成或未完成。", [
                "type": "object",
                "properties": [
                    "id": ["type": "string"],
                    "completed": ["type": "boolean"],
                ],
                "required": ["id"],
            ]),
            tool("agenda_delete_reminder", "删除一条提醒事项。", [
                "type": "object",
                "properties": ["id": ["type": "string"]],
                "required": ["id"],
            ]),
            tool("agenda_create_event", "在系统日历中新建一条日程。只给日期时按全天处理。", [
                "type": "object",
                "properties": [
                    "title": ["type": "string"],
                    "calendar": ["type": "string"],
                    "start": ["type": "string"],
                    "end": ["type": "string"],
                    "notes": ["type": "string"],
                    "location": ["type": "string"],
                ],
                "required": ["title", "start", "end"],
            ]),
            tool("agenda_delete_event", "删除一条日程。", [
                "type": "object",
                "properties": ["id": ["type": "string"]],
                "required": ["id"],
            ]),
        ]
    }

    private static func tool(_ name: String, _ description: String, _ schema: [String: Any]) -> [String: Any] {
        ["name": name, "description": description, "inputSchema": schema]
    }
}

private final class StoreBox {
    var store: AgendaStore?
}
