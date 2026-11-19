# 07 · 工作流（AGENTS.md / PM/WORKFLOW.md 成品）

> 依据：`docs/00-plan-final.md`（唯一事实来源，§5 接口清单 + §7 工程结构 `AGENTS.md`）
> 契约参考：`docs/design/01-数据规范.md`（状态机/编号/inbox/Zod）、`02-core.md`、`03-cli.md`、`04-mcp.md`、`05-server.md`、`06-web.md`

---

## 1. 数据字典（代理视角字段速查）

> 常用"对应表"：这是 AGENTS.md 的"编号/状态/命令速查"，更严格地定义见 `01-数据规范`。

| 资源 | 文件 | id 格式 | 状态枚举 | 日期语义 |
|---|---|---|---|---|
| project | `PM/projects/<slug>/project.md` | （id = slug，无前缀） | active/paused/done/archived | period `[start, end]` |
| requirement | `PM/projects/<slug>/requirements/REQ-<slug>-NNN.md` | `REQ-<slug>-NNN`（三位） | pool/reviewing/accepted/rejected/done | created/updated；流转副作用 updated |
| task | `PM/projects/<slug>/tasks/TASK-<slug>-NNN.md` | `TASK-<slug>-NNN` | todo/doing/done/cancelled | due 必填；done 时 completed 置今天 |
| inbox 条目 | `PM/inbox/*.md`（archive/ 除外） | `INBOX-<slug>-NNN`（slug 自 frontmatter，默认 `inbox`） | （无状态机；`archived` 标记） | created；支持归档 |

- 优先级：P0–P3（项目/需求/任务通用）。
- wiki-link 关联：`task.requirement = "[[REQ-<slug>-NNN]]"`（任务侧唯一写入点，`01-数据规范 §6`）；需求→任务反链由 core 每次构建索引实时聚合，不落盘。
- 进度派生值（`02-core §2.4`）：`completedRate`、`overdueCount` 等只在内存计算，**禁止写入任何 md 文件**（plan §4.3 第 2 条）。
- slug（项目目录名）规范化策略：`01-数据规范 §1.5`。
- 日期约定：`YYYY-MM-DD`（ISO 日期），"overdue" = 未完成任务（todo/doing）且 due < 今天（`02-core §2.4`）。

---

## 2. 操作 SOP（步骤化流程）

> 常用 SOP 收集站为 `PM/WORKFLOW.md`（§3.2）；本文档按照"触发条件→步骤→涉及命令→产物→异常处理"统一描述。

### 2.1 inbox 整理（`PM/WORKFLOW.md` §1 链接）

- **触发条件**：新收集箱条目出现（人手丢或 Agent 收集，`01-数据规范 §7.2`）。
- **步骤**：
  1. `pm inbox list --json` —— 列出未归档条目（按 created 降序）；
  2. `pm inbox process [--all] [--dry-run]` —— 预览待处理（限 20 条），人/Agent 看情况决定操作；
  3. 整理：提炼"一个需求一句话标题"，`pm new requirement --slug <slug> --title ... --module ... --source "inbox:<file>" --priority ...`；
  4. `pm inbox archive <INBOX-id>` —— 归档原条目到 `PM/inbox/archive/`（`01-数据规范 §7.4`）。
- **涉及命令**：`pm inbox list`、`pm inbox process`、`pm new requirement`、`pm inbox archive`（CLI 用法 `03-cli §7-8`，MCP 用法 `04-mcp §2`、`04-mcp §4.1`）。
- **产物**：`projects/<slug>/requirements/REQ-<slug>-NNN.md` + `inbox/archive/<id>.md`（带 `archived: <date>`）。
- **异常处理**：
  - frontmatter 缺失/类型不明（`unnumbered`）：`pm validate` 报告（E_VALIDATION），人工重写或删除；
  - 整理产物标题不清/重复：修改后重新 `pm new requirement`（不覆盖同项目已有 id）；
  - `pm inbox archive` 报 404：条目已被 `pm validate --fix`/人工删除，重新 `pm inbox list` 确认。

### 2.2 需求状态流转

- **触发条件**：需求状态应当变化（整理完成→提交审查；审查中→接受/拒绝；接受→交付）。
- **步骤**：`pm move <REQ-id> --status <target>`（CLI 用法 `03-cli §4`），或 Web 看板拖拽（`06-web §3.1`），或 `PATCH /api/requirements/:id`（`05-server §2.7`）。
- **流转表**：见 `01-数据规范 §3.2`；允许：pool→reviewing、pool→rejected、reviewing→accepted、reviewing→rejected、accepted→done、rejected→pool。
- **涉及命令**：`pm move`（CLI）/ Web 拖拽（PATCH）/ `04-mcp`（`pm_move`）。
- **副作用**：`updated=<today>`（副作用表 `01-数据规范 §3.2`，执行 `02-core §3`）。
- **产物**：requirement frontmatter 变化（原子写 `02-core §6`）；SSE 推送刷新（`05-server §5.3`）。
- **异常处理**：
  - 非法流转（如 doing→todo）：`E_INVALID_TRANSITION`（HTTP 409/CLI 4，`05-server §6.5`），状态不变，报错包含原因（`01-数据规范 §3.4`）；
  - 文件被改动冲突：`E_CONFLICT`（409/3），前端提示重试（`05-server §6.4`）。

### 2.3 需求派生任务

- **触发条件**：requirement 进入 accepted 状态（`01-数据规范 §3.2`）。
- **步骤**：
  - Web：`POST /api/requirements/:id/derive-task`（`05-server §2.8`）；
  - 人工/Agent：`pm new task --slug <slug> --requirement <REQ-id> --title ... --priority ... --due ...`（CLI 用法 `03-cli §3.3`）。
- **产物**：`TASK-<slug>-NNN.md`（`requirement = "[[REQ-id]]"`，前端/API 侧还可查 `requirementTasks` 反链）。
- **副作用**：任务创建时 `updated=created=today`。
- **异常处理**：
  - 派生前状态非 accepted：`E_INVALID_TRANSITION`（409）；
  - 编号耗尽：`E_SEQ_EXHAUSTED`（409/5），先归档/删除低优任务；
  - 目标项目已存在同标题任务：按 Agent 目标先决（同一需求可重复派生？按需求编号区分，`01-数据规范 §3` 不区分范围。

### 2.4 台账巡检（validate + check）

- **触发条件**：改动后（每次迭代结束）/ 周期巡检（每周一）。
- **步骤**：
  1. `pm validate [files...] [--json]`（`03-cli §2`）—— Zod/降级检查，报错精确到 file+field；
  2. `pm check [--json]`（`03-cli §6`）—— 一致性检查（悬空 wiki-link、孤儿任务、编号冲突、日期倒挂）；
  3. Web 总览（`/` + `/p/:slug`）看"待修复清单"提示（`06-web §11`）；
  4. 重复 1–3 直到 exit=0 或无新问题。
- **产物**：问题清单（`pm validate --json`/`pm check --json`）；待修复文件清单（`broken`）。
- **异常处理**：
  - `E_VALIDATION`（422/4）：`pm validate` 输出带 file+field；人工改 frontmatter，重跑；
  - `dangling-wiki` / `invalid-link-target`（`03-cli §6.2`）：删除链接或先创建目标 requirement；
  - `id-conflict`：取给它的 id 改回来（`pm move` 不做改名——需人/代理改文件）；
  - `E_CONFLICT`（409/3）：刷新重试（Web §6.3；CLI 重跑 `pm move`）；
  - `E_IO`（500/1）：重跑（再次执行 `pm validate`/`pm check`/`pm move`）；
  - `E_CONFIG_INVALID`：检查 `pm.config.json`（`02-core §4.1`）。

### 2.5 周报生成

- **触发条件**：每周（周一/周末前）。
- **步骤**：
  1. `pm stats --json`（`03-cli §5`）—— 获取本周：完成率（`completedRate`）、逾期（`overdueCount`）、各状态数量（`02-core §2.4`）；
  2. Web `/` 与 `/p/:slug` 查看总览与漏斗（`06-web §7`）；
  3. 按 `PM/WORKFLOW.md` §3.3 模板追加周报节（`WeekYYmmDD 日期`）。
- **产物**：`PM/WORKFLOW.md` 顶部的周报条目。
- **异常处理**：
  - 数据缺省（如没有 tasks）：周报注明"无数据/需补齐";
  - 工具失败：人工复核本周 git/手动状态，周报加"人工修正"标注。

---

## 3. 成品内容（文档 `07` 输出）

### 3.1 AGENTS.md（完整内容）

```markdown
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
| 新建需求 | `pm new requirement --slug <slug> --title "..." --module --source` |
| 新建任务 | `pm new task --slug <slug> --requirement [[REQ-...]] --title --priority --due` |
| 提交整理完成 | `pm move REQ-<slug>-001 --status reviewing` |
| 接受→交付 | `pm move REQ-<slug>-001 --status accepted` → `--status done` |
| 开始任务/完成任务 | `pm move TASK-<slug>-002 --status doing/done`（done 自动写 completed） |
| 巡检（台账） | `pm validate [--json]` + `pm check`（`03-cli §2/§6`） |
| 统计速览 | `pm stats --json`（`03-cli §5`） |
| 需求派生任务 | `POST /api/requirements/:id/derive-task`（`05-server §2.8`） |

## 错误速查（`02-core §3.1`，退出码 `03-cli §1.3`）

| 错误码 | 含义 | 常见处理 |
|---|---|---|
| `E_NOT_FOUND` | id/项目/文件不存在 | 检查 id；`pm new` 重新生成 |
| `E_INVALID_TRANSITION` | 状态流转非法 | 先 `pm validate`/`pm stats` 看当前状态 |
| `E_VALIDATION` | frontmatter 非法（字段不合法） | `pm validate --json` 精确定位 file+field，修后重跑 |
| `E_CONFLICT` | 有人改了文件（mtime 冲突） | 刷新（Web/CLI 重请） |
| `E_SEQ_EXHAUSTED` | 三位编号耗尽（>999） | 先归档/删除低优任务后重试 |

## 常见场景指引

- "我想把某个需求完成了" → `pm move REQ-... --status done`。
- "生成一周工作报告" → `pm stats --json` + `PM/WORKFLOW.md` §3.3 模板。
- "台账里编号冲突" → `pm check --json` → `01-数据规范 §6.2` 悬空链接/编号规则，改路径或重命名。

> 完整执行流程见本目录 `PM/WORKFLOW.md` 的 SOP（`07-workflow §2`）。
```

### 3.2 PM/WORKFLOW.md（完整内容）

```markdown
# PM 台账 · 工作流（AGENTS.md/代理视角）

> 由 Agent 维护：本文为操作 SOP 与数据字典的"总入口"，详细接口定义见 docs/00-plan-final.md 与 docs/design/*。

## 数据字典

（与 AGENTS.md §数据原则同表，不再复制——这里指向 AGENTS.md 的字典：02-core §3 流转表、03-cli §1.2 全部命令、04-mcp §2 工具、05-server §2-3 REST。）
> 原则：新代理看完 AGENTS.md 字典即可开工；具体异常处理看各 SOP。

## SOP：inbox 整理（`07-workflow §2.1`）

### 触发条件
新收集箱条目出现（人手丢或 Agent 收集）。

### 步骤
1. `pm inbox list --json` —— 列出未归档条目（按 created 降序）；
2. `pm inbox process [--all] [--dry-run]` —— 预览待处理，决定维护节奏；
3. `pm new requirement --slug <slug> --title "..." --module --source "inbox:<file>"`；
4. `pm inbox archive <INBOX-id>`。

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
`POST /api/requirements/:id/derive-task`（Web，`05-server §2.8`）或 `pm new task --slug <slug> --requirement <REQ-id> --title --priority --due`（`03-cli §3.3`）。

### 产物
`TASK-<slug>-NNN.md`（`requirement = "[[REQ-id]]"`）。

### 异常处理
- 非 accepted → `E_INVALID_TRANSITION`（409）；
- 编号耗尽 → `E_SEQ_EXHAUSTED`（409/5），先归档/删除低优任务。

## SOP：台账巡检（`07-workflow §2.4`）

### 步骤
1. `pm validate [files...] [--json]`（`03-cli §2`）；
2. `pm check`（`03-cli §6`，挂钩 `01-数据规范 §6.2/§4` 的 dangling/冲突/编号/日期问题）；
3. Web 总览查看"待修复清单"（`06-web §11`）。

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
| 过期任务 | N 个 | `overdueCount` |
| 交付漏斗 | pool/reviewing/accepted/done 数量 | Web 总览 |

> 写入顺序：新周报节按时间倒序排在最上方。

> **注意事项**：数据来自 `02-core deriveStats`（`02-core §2.4`）与各 store 的 SSE 推送（`05-server §5.3`，`06-web §5`），工具输出以 CLI `--json`/MCP 结构为准，不要维护第二份人工计数。
```

### 3.3 文档交叉引用（双视角一致性，`03-cli §10` 风格）

| 表达 | 含义 | 参考处 |
|---|---|---|
| `pm validate` 报错精确到 file+field | CLI 及 Agent 侧；MCP `pm_validate` 输出等价 | `03-cli §2`, `04-mcp §2.1`, `02-core §3.1` |
| `pm move` 返回副作用 `updated`/`completed` | Agent 用 `pm move` 入口，MCP `pm_move` 同源 | `01-数据规范 §3.2`, `03-cli §4.4`, `04-mcp §2.3` |
| 编号 `<前缀>-<项目slug>-<三位序号>` | 编号分配；三位耗尽报错 | `01-数据规范 §1.5`, `02-core §2.7`（编号分配） |
| 状态机流转表 | CLI `pm move`、MCP `pm_move`、Web 拖拽（`05-server §2.7/§3.3`） | `01-数据规范 §3` |
| HTTP 409 （冲突） | Web 自动刷新重试 + 提示 | `05-server §6.1-6.5` |

> 理由：三视角（Agent-first CLI/MCP + Web 看板，plan §1）同源语义，文档交叉引用让任何人/Agent 一次定位全部细节，`03-cli §10` 的交叉引用清单贯穿整个设计。
```

---

## 4. 实施可行性检查（按任务书「可实施」要求）

实现者读完 7 份文档（`01-数据规范` → `02-core` → `03-cli`）即可按 `packages/core/src` + `packages/cli` + `packages/mcp` + `packages/server` + `apps/web` 目录结构写代码，不需要再问"这个字段什么类型（`01-数据规范 §1` 表）、这个错误怎么返回（`02-core §3`（错误模型）/`03-cli §1.3`）、退出码对应哪个错误码（`03-cli §1.3`）、编号怎么分配（`02-core §2.7`）、状态流转怎么写（`01-数据规范 §3`）、写冲突怎么处理（`02-core §6`, `05-server §6`）".

> 一句话：7 份设计文档 = 实现者的"不需要再问"清单；`open-questions.md` = 为空的已落地尾短清单（§5.1）。
