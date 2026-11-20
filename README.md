# PM 台账

Agent-first 项目/需求/任务台账：数据由代理维护，CLI/MCP/Web 三视角同源（见 `docs/design/`）。

## MCP server（opencode 挂载示例）

`@pm/mcp` 提供基于 `@modelcontextprotocol/sdk` 的 stdio MCP server，工具清单全量对齐 `docs/design/04-mcp.md` §2：
`pm_validate / pm_create / pm_move / pm_stats / pm_check / pm_search / pm_inbox_list / pm_inbox_process / pm_inbox_archive`。

### 启动命令

```bash
# 1) 构建工作区（生成 packages/mcp/dist/main.js）
npm run build

# 2) 手动启动（stdio 传输；--root 指定 pm.config.json 所在工程根，缺省 = 当前目录）
node packages/mcp/dist/main.js --root E:/repos/project-manage
```

### opencode 挂载配置

在 `opencode.json`（工程根或 `~/.config/opencode/opencode.json`）中加入：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pm": {
      "type": "local",
      "command": ["node", "E:/repos/project-manage/packages/mcp/dist/main.js", "--root", "E:/repos/project-manage"],
      "enabled": true
    }
  }
}
```

挂载后代理即可调用上述工具（`pm_validate`、`pm_create` 等）；工具输出为结构化 JSON 文本（含 `ok` 信封与
`02-core §3.1` 错误码），错误时 `content[0]` 为 `[<code>] <message>`、`details` 供脚本/CI 机器解析（`04-mcp §1.1`）。
