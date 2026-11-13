---
name: ios-agenda
description: 操作这台 Mac 上已和 iPhone 同步的系统「提醒事项」和「日历」，以及 DSH 侧栏里那个「日程」页面。用户要看今天/本周安排、列出待办、新建或修改提醒与日程、标记完成、删除条目、查某个列表或日历、纠结授权没生效时使用。只要涉及日程、待办、提醒事项、日历、开会排期、截止时间，先读这个技能再动手，不要凭印象编造参数。
---

# 本机提醒事项与日历

数据源是这台 Mac 的 EventKit（系统「提醒事项」和「日历」），经 iCloud 与 iPhone 双向同步。写入后不会立刻出现在手机上，要等 Apple 云端同步。

有两种用法，别混：

- **页面**：DSH 左侧栏的「日程」，给人看和点。
- **工具**：`dreammate-node` 里的 MCP 服务 `mcp-ios-agenda`，给 Agent 调。不要在 DSH 里重复注册同名工具。

## 先确认能用

```sh
dreammate-node cli inspect --agent http://127.0.0.1:36908 --service mcp-ios-agenda
```

能看到 9 个方法就说明服务在线。服务不在时不要自己乱猜原因，先看第 5 节。

调用顺序是 搜索 → 读契约 → 调用。方法参数以 `inspect` 返回的 Schema 为准，本文只给要点。

## 1. 九个工具

| 工具 | 用途 | 必填 | 要点 |
| --- | --- | --- | --- |
| `agenda_authorize` | 请求日历与提醒权限 | 无 | 未决定时弹系统框，已被拒时打开系统设置 |
| `agenda_snapshot` | 读提醒 + 日程 | 无 | `from`/`to` 限范围，`reminderList`/`calendar` 按列表或日历过滤，`includeCompleted` 连已完成一起返回 |
| `agenda_create_reminder` | 新建提醒 | `title` | 可选 `list` `notes` `due` `priority` |
| `agenda_update_reminder` | 改提醒 | `id` | 只改传入字段；`notes`/`due` 传空字符串即清空；可换 `list`、改 `completed` |
| `agenda_complete_reminder` | 只翻完成状态 | `id` | 等价于 `update_reminder` 只传 `completed`，日常优先用 update |
| `agenda_delete_reminder` | 删提醒 | `id` | 不可恢复 |
| `agenda_create_event` | 新建日程 | `title` `start` `end` | 起止都只给日期时按全天；可选 `calendar` `notes` `location` |
| `agenda_update_event` | 改日程 | `id` | 只改传入字段；只传 `start` 会保持原时长；`span` 取 `thisEvent`（默认）或 `futureEvents` |
| `agenda_delete_event` | 删日程 | `id` | 不可恢复 |

时间一律 ISO 8601，例如 `2026-11-20T14:00:00+08:00`；只给日期 `2026-11-20` 表示全天。

## 2. 典型调用

```sh
# 今天到本周末的安排
dreammate-node cli invoke --agent http://127.0.0.1:36908 --service mcp-ios-agenda \
  --method agenda_snapshot --params '{"from":"2026-11-13","to":"2026-11-16"}'

# 新建一个提醒（指定列表和截止时间）
dreammate-node cli invoke --agent http://127.0.0.1:36908 --service mcp-ios-agenda \
  --method agenda_create_reminder \
  --params '{"title":"交季度报表","list":"工作待办","due":"2026-11-20T18:00:00+08:00"}'

# 改期并清掉备注
dreammate-node cli invoke --agent http://127.0.0.1:36908 --service mcp-ios-agenda \
  --method agenda_update_reminder \
  --params '{"id":"<id>","due":"2026-11-21T18:00:00+08:00","notes":""}'

# 挪一次会议（只改开始时间，时长不变）
dreammate-node cli invoke --agent http://127.0.0.1:36908 --service mcp-ios-agenda \
  --method agenda_update_event --params '{"id":"<id>","start":"2026-11-14T10:00:00+08:00"}'
```

`id` 从 `agenda_snapshot` 的结果里取，REST 里没有按标题搜索。条目多时先用 `from`/`to` 或 `reminderList`/`calendar` 缩小范围。

## 3. 操作纪律

- 改之前先读一次拿到 `id` 和当前值，别凭用户描述里的旧标题去猜 id。
- `delete_*` 不可恢复。用户说「删掉」时如果有多条同名，先列出来让他选，别挑第一条。
- 批量清理测试数据时，只删自己刚创建的 `id`。**不要用标题关键词批量匹配**——用户真实待办的标题里也可能含「测试」这类字。
- 写入报告给用户时带上标题和最终时间，方便他核对。

## 4. 页面怎么用

侧栏「日程」打开后分两栏：

- **左侧月历**：切日期，周一为一周开始。今天描边；有日程的点用日历色，有提醒的点用列表色。下面「逾期 N」「无日期 N」可跳转。
- **右侧看板**：默认只看选中的那一天，有钟点的排前面、全天在后；「本周」铺成 7 列。
- **筛选项**：列表和日历各一组多选。勾上才显示，取消的会滑到本组底部；选择会记住，下次打开还在。
- **新建**：底部输入框回车加提醒；「新日程」展开后可填起止时间。

## 5. 授权与疑难

插件读 EventKit 需要系统授权，macOS 按**责任进程**判定：

- 页面和 MCP 都通过 LaunchServices（`open -a IosAgenda.app`）调起原生程序，这样 app 才是自己的责任进程。宿主直接 spawn 包内二进制会被记到 DSH 名下，权限静默变成 `notDetermined`，既不弹框也读不到数据。
- 因此需要图形登录会话；纯 ssh 环境跑不了。
- 每次调用要经 LaunchServices 起实例：首次约 3 秒，之后约 150 毫秒。

权限出问题时的处理顺序：

1. 调 `agenda_authorize`。返回 `granted: true` 就直接重试读取。
2. 返回里 `openedSettings: true` 说明已经跳到系统设置的对应开关，让用户打开，再刷新页面或重试。
3. 页面顶部出现授权卡片时，点「授权」；若按钮显示「打开系统设置」，说明之前被拒过。

**重新签名会让授权失效。** 本地 `npm run build` 或升级插件后，`IosAgenda.app` 的签名变了，需要重新允许一次。这是 ad-hoc 签名的固有代价，不是 bug。

其他限制：

- 只支持 Apple 芯片 macOS（包里是 arm64），Intel 机器装不了。
- 换一台 Mac 后首次使用要重新授权。
- MCP 由 `dreammate-node` 拉起，如果工具列表还是旧版（比如少了 `agenda_update_*`），重连一次：
  ```sh
  dreammate-node mcp remove mcp-ios-agenda
  dreammate-node mcp add --config '{"mcpServers":{"ios-agenda":{"command":"<profile>/node_modules/@1agents/dsh-plugin-todo/dist/IosAgenda.app/Contents/MacOS/ios-agenda","args":["mcp"],"sharing":"local"}}}'
  ```

## 6. 安装与升级

```sh
dsh plugin --profile web add @1agents/dsh-plugin-todo@0.1.4
```

装完重启 DSH，侧栏出现「日程」。本技能会由插件安装时自动放到 `~/.dsh/skills/ios-agenda/`；如果没生效，从包目录手动复制一次即可。
