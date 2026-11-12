---
name: ios-agenda
description: 通过 dreammate-node 管理这台 Mac 上已同步的系统提醒事项和日历。用户要查看、新建、完成或删除待办和日程时使用。不要把这些工具注册到 DSH。
---

# 本机提醒事项与日历

数据在这台 Mac 的系统「提醒事项」和「日历」里，经 iCloud 同步到 iPhone。工具不在 DSH 里，在 dreammate-node 的 `mcp-ios-agenda`。

先搜索再读契约再调用：

```sh
dreammate-node cli search --agent http://127.0.0.1:36908 --query '提醒事项 日历'
dreammate-node cli inspect --agent http://127.0.0.1:36908 --service mcp-ios-agenda --method agenda_snapshot
dreammate-node cli invoke --agent http://127.0.0.1:36908 --service mcp-ios-agenda --method agenda_snapshot --params '{}'
```

方法以 inspect 返回的 Schema 为准。常用的是 `agenda_snapshot`、`agenda_create_reminder`、`agenda_complete_reminder`、`agenda_create_event`。没有访问权限时先调用 `agenda_authorize`：还没决定会弹出系统授权框，已经被拒绝会打开系统设置。写入后不会立刻出现在手机上，要等 iCloud 同步。

没有来源时，先在插件仓库执行 `npm run build`，再由 DSH 启用插件，或手动 `dreammate-node mcp add`。来源范围是 `local`。
