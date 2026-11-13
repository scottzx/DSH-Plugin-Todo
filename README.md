# @1agents/dsh-plugin-todo

管理这台 Mac 上已经和 iPhone 同步的系统「提醒事项」和「日历」。

- DSH 插件提供侧栏里的独立页面，不注册 Agent 工具。
- 同一个 `IosAgenda.app` 以 stdio MCP 登记到本机 dreammate-node，范围是 `local`。
- 页面和 MCP 调用同一套 EventKit 方法。写入后要等 iCloud 同步才会出现在手机上。

## 构建

```sh
npm install
npm run build
npm test
```

`npm run build` 会编译 Swift、打成 `dist/IosAgenda.app` 并签名。授权记在这个 app 上，不要改去调用裸二进制。

第一次读取会弹出「提醒事项」和「日历」的权限。如果没弹出，到「系统设置 → 隐私与安全性」里允许 `IosAgenda.app`（`work.1agents.ios-agenda`）。

### 为什么必须经过系统启动器

macOS 的隐私授权按「责任进程」判定，而不是看实际读数据的是谁。宿主直接 `spawn` 包内的二进制时，责任进程是整个 DSH，日历权限会被静默判成 `notDetermined`：系统既不弹框，也不会读成功。

所以页面和 MCP 都改成先用 `open -W -a IosAgenda.app --args call-file …` 交给 LaunchServices 起一个自己，这个进程才是自己的责任进程，授权和读取都正常。副作用有两条：

- 需要图形登录会话，没有 `open` 可用的环境（例如纯 ssh）跑不了。
- 每次调用要经 LaunchServices 起一个实例。首次约 3 秒，之后约 150 毫秒。

## 安装

前提：Apple 芯片的 macOS、Node.js 20 或以上、已安装的 DeepSeek Harness。提醒事项和日历只在这台 Mac 上读写。当前发布的原生程序是 arm64，Intel Mac 不能安装。

```sh
dsh plugin --profile web add @1agents/dsh-plugin-todo@0.1.3
```

装完后重启 DSH。左侧栏「历史会话」上方出现「日程」。Host 启动时会把 MCP 登记到 `127.0.0.1:36908`。网关没在跑时，页面仍可用，Agent 搜索不到工具。当前这个对话窗口走的是 desktop profile；要在 `dsh web`（默认 `http://127.0.0.1:3080`）里看到，安装目标是 web profile。

从源码安装时，先完成本地构建，再把仓库目录加进 profile：

```sh
dsh plugin --profile web add /absolute/path/DSH-Plugin-Todo
```

## 给 Agent 用

不要在 DSH 里再注册同名工具。已接入 dreammate-node MCP 的会话用搜索来调用：

```sh
dreammate-node cli search --agent http://127.0.0.1:36908 --query '提醒事项 日历'
```

服务名是 `mcp-ios-agenda`。操作说明在 `skills/ios-agenda/SKILL.md`。

随包发布的 `IosAgenda.app` 使用本机临时签名。换一台 Mac 后，如果系统拦截，到「系统设置 → 隐私与安全性」里允许 `IosAgenda.app`（`work.1agents.ios-agenda`）访问提醒事项和日历。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
