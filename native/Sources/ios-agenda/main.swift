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
            run(method, input)
        case "call-file":
            // 由 LaunchServices 拉起时没有可用的 stdin，输入从文件读。
            let rest = Array(arguments.dropFirst())
            let method = rest.first ?? ""
            let path = rest.dropFirst().first ?? ""
            let data = path.isEmpty ? Data() : ((try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data())
            let input = (try? JSON.object(from: data)) ?? [:]
            run(method, input)
        case "help", "--help", "-h":
            let help = """
            ios-agenda — 本机提醒事项与日历

              ios-agenda mcp                          以 stdio MCP 运行，供 dreammate-node 拉起
              ios-agenda call <method>                从 stdin 读 JSON 对象并调用同一套方法
              ios-agenda call-file <method> <path>    从文件读 JSON 对象，供 LaunchServices 启动

            方法：\(AgendaMethods.names.joined(separator: ", "))
            日志不要写到 stdout。授权只认 IosAgenda.app 这个包，要用 open 启动才能拿到 TCC 归属。
            """
            FileHandle.standardError.write(Data(help.utf8))
        default:
            writeStdout(envelope(error: AgendaError(code: "BAD_INPUT", message: "未知命令 \(command)。使用 mcp 或 call。")))
            exit(2)
        }
    }

    private static func run(_ method: String, _ input: [String: Any]) {
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
    }
}
