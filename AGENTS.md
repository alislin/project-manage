# PM 台账 — 代理操作指南

> 本文件 = 唯一事实来源入口：`docs/00-plan-final.md`（定案内容不变更）；
> 细节见 `docs/design/`（`01-数据规范` / `02-core` / `03-cli` / `04-mcp` / `05-server` / `06-web` / `07-workflow`）。
> Agent-first：数据由代理维护，Web/CLI/MCP 三视角同源。

## 目录结构

```
PM/
├── WORKFLOW.md            # 本目录的操作 SOP + 数据字典（与本文档互补）
├── _config.md             # 全局配置（编号规则、状态枚举、优先级定义）
├── inbox/                 # 收集箱（人放碎片 → Agent 整理成需求）
└── projects/
    └── <slug>/
        ├── project.md
        ├── requirements/   # REQ-<slug>-NNN.md
        └── tasks/          # TASK-<slug>-NNN.md
```

## 数据原则（`01-数据规范`）

- **单写原则**：任务→需求关联只写在任务侧（`requirement = "[[REQ-<slug>-NNN]]"`）；需求→任务反链由 core 实时聚合不落盘（`01-数据规范 §6`）。
- **进度派生值**：完成率、逾期数实时计算，不写入任何 md（`01-数据规范 §4.2`）。
- **编号**：`<前缀>-<项目slug>-<三位序号>`，由 `pm new` 自动分配；三位耗尽（>999）报错（`E_SEQ_EXHAUSTED`），先归档/删除低价值文件。
- **状态机**：非法流转必须被拒绝（`E_INVALID_TRANSITION`），状态副作用（`updated`/`completed`）由 `pm move` 维护。

## 常用命令速查（`03-cli` 各节，`04-mcp` 用法对齐）

| 任务 | 命令（CLI/MCP） |
|---|---|
| 新建项目 | `pm new project --name "我的应用 v2"` / `pm_create({type:"project",...})` |
| 新建需求 | `pm new requirement --slug <slug> --title "..." --module --source` / `pm_create({type:"requirement",...})` |
| 新建任务 | `pm new task --slug <slug> --requirement REQ-<slug>-NNN --title --priority --due`（CLI 传裸 id，入库自动转 wiki-link）/ `pm_create({type:"task",...})`（requirement 兼容 `[[REQ-...]]`） |
| 整理收集箱 | `pm inbox list` / `pm inbox process [--limit <n>] [--all] [--dry-run]` / `pm inbox archive <INBOX-id>`（`03-cli §7`；MCP `pm_inbox_list/process/archive` 同源） |
| 提交整理完成 | `pm move REQ-<slug>-001 --status reviewing` |
| 接受→交付 | `pm move REQ-<slug>-001 --status accepted` → `--status done` |
| 开始任务/完成任务 | `pm move TASK-<slug>-002 --status doing/done`（done 自动写 completed） |
| 巡检（台账） | `pm validate [--json]` + `pm check [--json]`（`03-cli §2/§6`；check 编号冲突扫描含 inbox 条目 id） |
| 统计速览 | `pm stats --json`（`03-cli §5`；含 `onTrack`：`projects[].progress.onTrack` 与 `totals.tasks.onTrack`） |
| 启动 Web 服务 | `pm serve [-p 端口] [-H 主机]`（`03-cli §8`：REST + SSE + 静态托管 `apps/web/dist`） |
| 需求派生任务 | `POST /api/requirements/:id/derive-task`（`05-server §2.8`） |

> `--root <path>`：全局与子命令级均可指定工程根（`pm.config.json` 所在目录，缺省 = cwd 及祖先链解析，`03-cli §1.1`）；MCP server 同语义：`node packages/mcp/dist/main.js --root <工程根>`（opencode 挂载示例见仓库 README）。

## 错误速查（`02-core §3.1`，退出码 `03-cli §1.3`）

| 错误码 | 含义 | 常见处理 |
|---|---|---|
| `E_NOT_FOUND` | id/项目/文件不存在 | 检查 id；`pm new` 重新生成 |
| `E_INVALID_TRANSITION` | 状态流转非法 | 先 `pm validate`/`pm stats` 看当前状态 |
| `E_VALIDATION` | frontmatter 非法（字段不合法） | `pm validate --json` 精确定位 file+field，修后重跑 |
| `E_CONFLICT` | 有人改了文件（mtime 冲突） | 刷新（Web/CLI 重请） |
| `E_SEQ_EXHAUSTED` | 三位编号耗尽（>999） | 先归档/删除低优任务后重试 |
| `E_USAGE` | 入参非法（缺必填/取值越界，MCP inputSchema 校验） | 按报错 `field`/`message` 修正入参后重试 |

## 常见场景指引

- "我想把某个需求完成了" → `pm move REQ-... --status done`。
- "有新的想法碎片要进台账" → `pm inbox list --json` → `pm new requirement ... --source "inbox:<file>"` → `pm inbox archive <INBOX-id>`（`07-workflow §2.1`）。
- "生成一周工作报告" → `pm stats --json` + `PM/WORKFLOW.md` 周报模板（"模板：WeekYYmmDD"节）。
- "台账里编号冲突" → `pm check --json` → `01-数据规范 §6.2` 悬空链接/编号规则，改路径或重命名。

> 完整执行流程见本目录 `PM/WORKFLOW.md` 的 SOP（`07-workflow §2`）。
