# PM 台账 · 工作流（AGENTS.md/代理视角）

> 由 Agent 维护：本文为操作 SOP 与数据字典的"总入口"，详细接口定义见 docs/00-plan-final.md 与 docs/design/*。

## 数据字典

（与 AGENTS.md §数据原则同表，不再复制——这里指向 AGENTS.md 的字典：02-core §3 流转表、03-cli §1.2 全部命令、04-mcp §2 工具、05-server §2-3 REST。）
> 原则：新代理看完 AGENTS.md 字典即可开工；具体异常处理看各 SOP。
> 运行约定：全部命令支持 `--root <path>` 指定工程根（全局或子命令级，`03-cli §1.1`；缺省 = cwd 及祖先链解析 `pm.config.json`）；MCP server 等价入口 `node packages/mcp/dist/main.js --root <工程根>`（挂载示例见仓库 README）。

## SOP：inbox 整理（`07-workflow §2.1`）

### 触发条件
新收集箱条目出现（人手丢或 Agent 收集）。

### 步骤
1. `pm inbox list --json` —— 列出未归档条目（按 created 降序）；
2. `pm inbox process [--limit <n>] [--all] [--dry-run]` —— 预览待处理（默认前 20 条），决定维护节奏；
3. `pm new requirement --slug <slug> --title "..." --module --source "inbox:<file>"`；
4. `pm inbox archive <INBOX-id>`。

> MCP 等价工具：`pm_inbox_list` / `pm_inbox_process` / `pm_inbox_archive`（04-mcp/03-cli §7 同源语义）。

### 产物
- `PM/projects/<slug>/requirements/REQ-<slug>-NNN.md`（合规字段：title/module/source/priority）；
- `PM/inbox/archive/<id>.md`（带 `archived: <date>`）。

### 异常处理
- 无法识别类型的 md 文件（`unnumbered`）→ `pm validate` 报告（E_VALIDATION），人工重写或删除（`01-数据规范 §7.5`）。

## SOP：需求状态流转（`07-workflow §2.2`）

### 步骤
`pm move <REQ-id> --status <target>` / Web 拖拽 / `PATCH /api/requirements/:id`（`05-server §2.7`）。

### 流转表（`01-数据规范 §3.2`）
允许流转：pool→reviewing、pool→rejected、reviewing→accepted、reviewing→rejected、accepted→done、rejected→pool。

### 副作用
流转副作用见 `01-数据规范 §3.2`（updated/completed）；适用于 Agent 或人（Web/CLI/MCP，`04-mcp` 用法同源）。

### 异常处理
- 非法流转 → `E_INVALID_TRANSITION`（409/CLI 4，`05-server §6.5`）；
- 写冲突 → `E_CONFLICT`（409/CLI 3，`05-server §6.1-6.4`）。

## SOP：需求派生任务（`07-workflow §2.3`）

### 步骤
`POST /api/requirements/:id/derive-task`（Web，`05-server §2.8`）；或 CLI `pm new task --slug <slug> --requirement REQ-<slug>-NNN --title --priority --due`（`03-cli §3.3`，`--requirement` 传裸 id，入库自动转 wiki-link）；MCP `pm_create({type:"task",...})`（requirement 兼容 `[[REQ-id]]` wiki-link 双形态）。

### 产物
`TASK-<slug>-NNN.md`（`requirement = "[[REQ-id]]"`）。

### 异常处理
- 非 accepted → `E_INVALID_TRANSITION`（409）；
- 编号耗尽 → `E_SEQ_EXHAUSTED`（409/5），先归档/删除低优任务。

## SOP：台账巡检（`07-workflow §2.4`）

### 步骤
1. `pm validate [files...] [--json]`（`03-cli §2`，报错精确到 file+field）；
2. `pm check [--json]`（`03-cli §6`：悬空 wiki-link / 链接格式非法 / 编号冲突 / 日期倒挂 / 非法 frontmatter；编号冲突扫描含 inbox 条目 id，`01-数据规范 §6.2/§4`）；
3. Web 总览查看"待修复清单"（`06-web §11`）。

> 退出码：0 = 无问题；2 = 发现问题（`03-cli §6.5/§1.3`）。修复后重跑至 exit=0。

### 产物
问题清单（exit=0 时确认无问题）。

### 异常处理
- 修复后重跑；`broken` 清单需人工判断（`01-数据规范 §4.2` 降级策略）。

## SOP：周报生成（`07-workflow §2.5`）

### 步骤
1. `pm stats --json`（`03-cli §5`）；
2. Web 速览 + 漏斗（`06-web §7`）；
3. 按 §WeekYYmmDD 模板追加到本文件顶部。

### 产物
周报条目。

### 异常处理
无数据/失败时注明"人工修正"与原因。

---

## 模板：WeekYYmmDD（截至 <今天>）

| 维度 | 值 | 备注 |
|---|---|---|
| 需求进度 | 已完成 X / 在进行 Y / 待处理 Z | 数据来自 `pm stats` |
| 任务进度 | 完成率 % | `completedRate`（`02-core §2.4`） |
| 进行中任务 | N 个 | `onTrack`（todo/doing 且 due ≥ 今天，`02-core §2.4`；`projects[].progress.onTrack` 与 `totals.tasks.onTrack`） |
| 过期任务 | N 个 | `overdueCount` |
| 交付漏斗 | pool/reviewing/accepted/done 数量 | Web 总览 |

> 写入顺序：新周报节按时间倒序排在最上方。

> **注意事项**：数据来自 `02-core deriveStats`（`02-core §2.4`）与各 store 的 SSE 推送（`05-server §5.3`，`06-web §5`），工具输出以 CLI `--json`/MCP 结构为准，不要维护第二份人工计数。
