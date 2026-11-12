import AppKit
import Foundation

@main
enum AgendaMain {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        let command = arguments.first ?? "help"
        switch command {
        case "mcp":
            MCPServer.serve()
        case "call":
            let method = arguments.dropFirst().first ?? ""
            let input = (try? JSON.object(from: FileHandle.standardInput.readDataToEndOfFile())) ?? [:]
            let app = NSApplication.shared
            app.setActivationPolicy(.accessory)
            DispatchQueue.main.async {
                Task { @MainActor in
                    let result = await AgendaMethods.call(method, input, store: AgendaStore())
                    writeStdout(result)
                    exit((result["ok"] as? Bool) == true ? 0 : 1)
                }
            }
            app.run()
        case "help", "--help", "-h":
            let help = """
            ios-agenda — 本机提醒事项与日历

              ios-agenda mcp                 以 stdio MCP 运行，供 dreammate-node 拉起
              ios-agenda call <method>       从 stdin 读 JSON 对象并调用同一套方法

            方法：\(AgendaMethods.names.joined(separator: ", "))
            日志不要写到 stdout。授权只认 IosAgenda.app 这个包。
            """
            FileHandle.standardError.write(Data(help.utf8))
        default:
            writeStdout(envelope(error: AgendaError(code: "BAD_INPUT", message: "未知命令 \(command)。使用 mcp 或 call。")))
            exit(2)
        }
    }
}
