# 04 · MCP 工具清单

> 依据：`docs/00-plan-final.md`（唯一事实来源，接口清单 §5 MCP：`pm_validate / pm_create / pm_move / pm_stats / pm_check` 等）
> 契约参考：`docs/design/01-数据规范.md`（Zod、状态机）、`docs/design/02-core.md`（错误码、Stats）、`docs/design/03-cli.md`（退出码、JSON schema 与本文同源）

---

## 1. 调用约定

### 1.1 错误语义（所有工具统一）

```ts
// 工具失败 → CallToolResult
{
  isError: true,
  content: [{ type: "text", text: "[<code>] <message>" }],
  details?: {
    code: string;              // 与 02-core §3.1 相同（E_USAGE/E_NOT_FOUND/E_VALIDATION/
                               //  E_INVALID_TRANSITION/E_CONFLICT/E_SEQ_EXHAUSTED/E_IO/...)
    message: string;
    file?: string;             // 精确到绝对路径
    field?: string;            // 字段路径
    issues?: Array<{ file: string; field: string; code: string; message: string }>; // 降级/流转详情
  },
}

// 工具成功 → isError false，结构化输出（见各工具输出 schema）
```

> **理由**：文本信息对模型可读（`[<code>] <message>`），`details` 对脚本/CI 可机器解析；`code` 直接与 02-core 错误模型同源，CLI 退出码与 HTTP 状态由 `03-cli §1.3` / `05-server §6.5` 定义，三端一致。

### 1.2 全局运行环境

- 所有工具先 `loadConfig()`，缺失/非法 → `E_CONFIG_INVALID`。
- 工具语义 = 对应 CLI（映射表 §4.1），JSON 输出结构 = 同名 CLI `--json` 结构（`03-cli` 各命令节），错误语义 = §1.1。

---

## 2. 工具清单

### 2.1 `pm_validate`（对应 `pm validate`）

**描述**：校验一个或多个文件，报告 Zod/降级问题，错误精确到 file+field。

**输入 schema（JSON Schema）**：

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": { "type": "string" },
      "description": "可选。目录或 md 文件绝对/相对路径；缺省 = 全部"
    }
  },
  "additionalProperties": false
}
```

**输出 schema**（= `03-cli §2.2`）：

```json
{
  "type": "object",
  "properties": {
    "checkedFiles": { "type": "integer", "description": "校验文件数" },
    "ok":           { "type": "boolean" },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file":    { "type": "string" },
          "field":   { "type": "string" },
          "code":    { "type": "string" },
          "message": { "type": "string" }
        },
        "required": ["file", "code", "message"]
      }
    }
  },
  "required": ["checkedFiles", "ok", "errors"]
}
```

### 2.2 `pm_create`（对应 `pm new`）

**描述**：创建 project/requirement/task，自动分配编号、生成合规 frontmatter 模板。

**输入 schema**：

```json
{
  "type": "object",
  "properties": {
    "type": { "enum": ["project", "requirement", "task"] },
    "projectSlug": { "type": "string", "description": "type != project 时为目标项目 slug（§3.2/§3.3）" },
    "slug":     { "type": "string",                     "description": "type == project 时的 slug" },
    "name":     { "type": "string",                     "description": "project 必填" },
    "period":   { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 2, "description": "project：[start, end] ISO date" },
    "tags":     { "type": "array", "items": { "type": "string" }, "description": "project：tags" },
    "status":   { "enum": ["active", "paused", "done", "archived", "pool", "reviewing", "accepted", "rejected", "todo", "doing", "cancelled"], "description": "project：默认 active；requirement：默认 pool；task：默认 todo（03-cli §3.1/§3.2/§3.3），取值语义见 01-数据规范 §3" },
    "title":    { "type": "string", "description": "requirement/task 必填" },
    "module":   { "type": "string",                     "description": "requirement" },
    "source":   { "type": "string",                     "description": "requirement 需非空" },
    "priority": { "enum": ["P0", "P1", "P2", "P3"] },
    "requirement": { "type": "string", "description": "task 必填：[[REQ-...]] wiki-link（目标必须存在）" },
    "due":      { "type": "string",                     "description": "task 必填：ISO date" }
  },
  "required": ["type"]
}
```

> 理由：`pm_create` 用 `type` 分发（统一的创建入口）；`projectSlug`/`slug` 区分 project 的"即 slug 本身"语义与 requirement/task 的"所属项目"语义（`03-cli §3.2/§3.3` 表）；`status` 对三类型各有默认值（project 默认 active，requirement 默认 pool，task 默认 todo），与 CLI `--status` 三端语义同源（`03-cli §3.1-§3.3`）。

**输出 schema**（= `03-cli §3.1–3.3` 的 `created` 对象）：

```json
{
  "type": "object",
  "properties": {
    "created": {
      "type": "object",
      "properties": {
        "id":   { "type": "string" },
        "slug": { "type": "string", "description": "project 时的 slug" },
        "path": { "type": "string" }
      },
      "required": ["id", "path"]
    }
  },
  "required": ["created"]
}
```

### 2.3 `pm_move`（对应 `pm move`）

**描述**：执行状态流转；非法流转返回 `isError + details.code=E_INVALID_TRANSITION`；副作用（updated/completed）自动维护。

**输入 schema**（= `03-cli §4.1`）：

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "REQ-/TASK- 前缀的 id；project 即 slug（projects/<slug>/project.md）" },
    "status": { "enum": ["active", "paused", "done", "archived", "pool", "reviewing", "accepted", "rejected", "todo", "doing", "cancelled"] }
  },
  "required": ["id", "status"]
}
```

**输出 schema**（= `03-cli §4.2`）：

```json
{
  "type": "object",
  "properties": {
    "ok":           { "type": "boolean" },
    "file":         { "type": "string" },
    "from":         { "type": "string" },
    "to":           { "type": "string" },
    "updatedField": { "enum": ["updated", "updated+completed"] },
    "id":           { "type": "string" }
  },
  "required": ["ok", "file", "from", "to", "updatedField", "id"]
}
```

### 2.4 `pm_stats`（对应 `pm stats`）

**描述**：聚合统计（进度、逾期、各状态数量）；完整结构 = `02-core §2.4`。

**输入 schema**：

```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```

**输出 schema**：`02-core §2.4` 的 `Stats` 类型（静态定义见 `02-core §2.4`），即：

```json
{
  "type": "object",
  "properties": {
    "projects": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "slug":   { "type": "string" },
          "name":   { "type": "string" },
          "status": { "enum": ["active", "paused", "done", "archived"] },
          "progress": {
            "type": "object",
            "properties": {
              "completedRate": { "type": "number" },
              "overdueCount":  { "type": "integer" },
              "totalTasks":    { "type": "integer" },
              "doneTasks":     { "type": "integer" },
              "cancelledTasks":{ "type": "integer" },
              "onTrack":       { "type": "integer", "description": "与 02-core §2.4 Progress.onTrack 同义" }
            },
            "required": ["completedRate", "overdueCount", "totalTasks", "doneTasks", "cancelledTasks", "onTrack"]
          }
        },
        "required": ["slug", "name", "status", "progress"]
      }
    },
    "totals": {
      "type": "object",
      "properties": {
        "requirements": {
          "type": "object",
          "properties": {
            "total": { "type": "integer" },
            "byStatus": {
              "type": "object",
              "properties": {
                "pool": { "type": "integer" }, "reviewing": { "type": "integer" },
                "accepted": { "type": "integer" }, "rejected": { "type": "integer" },
                "done": { "type": "integer" }
              },
              "additionalProperties": { "type": "integer" }
            }
          },
          "required": ["total", "byStatus"]
        },
        "tasks": {
          "type": "object",
          "properties": {
            "total": { "type": "integer" },
            "byStatus": {
              "type": "object",
              "properties": {
                "todo": { "type": "integer" }, "doing": { "type": "integer" },
                "done": { "type": "integer" }, "cancelled": { "type": "integer" }
              },
              "additionalProperties": { "type": "integer" }
            },
            "overdue": { "type": "integer" },
            "onTrack": { "type": "integer", "description": "与 02-core §2.4 TaskStats.onTrack 同义" }
          },
          "required": ["total", "byStatus", "overdue", "onTrack"]
        }
      },
      "required": ["requirements", "tasks"]
    }
  },
  "required": ["projects", "totals"]
}
```

### 2.5 `pm_check`（对应 `pm check`）

**描述**：一致性检查：悬空 wiki-link、孤儿任务（invalid-link-target）、编号冲突、日期倒挂、非法 frontmatter。

**输入 schema**：同 `pm_validate`。

**输出 schema**（= `03-cli §6.3`）：

```json
{
  "type": "object",
  "properties": {
    "ok":     { "type": "boolean" },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file":    { "type": "string" },
          "field":   { "type": "string" },
          "code":    { "enum": ["dangling-wiki", "invalid-link-target", "id-conflict", "date-inverted", "invalid-frontmatter"] },
          "message": { "type": "string" }
        },
        "required": ["file", "code", "message"]
      }
    }
  },
  "required": ["ok", "issues"]
}
```

### 2.6 `pm_search`（对应 `GET /api/search?q=`，`02-core services/search.ts`）

**描述**：从 index 内存索引检索。

**输入 schema**：

```json
{
  "type": "object",
  "properties": {
    "q":       { "type": "string", "minLength": 1 },
    "type":    { "enum": ["project", "requirement", "task", "inbox"], "description": "可选" },
    "limit":   { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
  },
  "required": ["q"]
}
```

**输出 schema**（= `02-core §2.6`）：

```json
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id":    { "type": "string" },
          "type":  { "enum": ["project", "requirement", "task", "inbox"] },
          "slug":  { "type": "string" },
          "relPath": { "type": "string" },
          "title": { "type": "string" },
          "highlight": { "type": "string", "description": "带高亮的摘要片段（可选）" }
        },
        "required": ["id", "type", "slug", "relPath", "title"]
      }
    }
  },
  "required": ["results"]
}
```

---

## 3. CLI 映射表（同一语义两处表达，保证一致）

> 理由：`plan §5` 接口清单只列 CLI；MCP 双份同源防止两边分叉——映射表一一对应，输出 schema 互相引用 `03-cli` 的 `--json` 结构（已在 §2.1–2.5 声明）。

| MCP 工具 | CLI 命令 | 语义对齐点 |
|---|---|---|
| `pm_validate` | `pm validate [files...] [--json]` | 入参：`files` ↔ CLI `files`；出参：§2.1 ↔ `03-cli §2.2`（`checkedFiles/ok/errors[]{file,field,code,message}`） |
| `pm_create` | `pm new project/requirement/task` | 出参 `created{id,slug?,path}` ↔ `03-cli §3.1/§3.2/§3.3`；输入字段按对应子命令 |
| `pm_move` | `pm move <id> --status X` | 出参 ↔ `03-cli §4.2`（`file/from/to/updatedField/id`）；`status` 取值 = 流转表（`01-数据规范 §3`） |
| `pm_stats` | `pm stats [--json]` | 出参 = `02-core §2.4` `Stats`，双侧同一结构 |
| `pm_check` | `pm check` | 出参 ↔ `03-cli §6.3`（`ok/issues[].code` 相同枚举） |
| `pm_search` | `GET /api/search?q=`（REST，不走 MCP） | 输出 ↔ `02-core §2.6` `SearchResult` |

---

## 4. 代理使用示例

### 4.1 典型工作流（`07-workflow` SOP 交叉引用）

```jsonc
// ① 代理看到新需求（来自人或 inbox）
pm_create({
  type: "requirement",
  projectSlug: "proj",
  title: "支持 OAuth 登录",
  module: "auth",
  source: "inbox:42",
  priority: "P2",
  status: "pool",
})

// ② 用户/需求审阅后 → 提交整理完成
pm_move({ id: "REQ-proj-001", status: "reviewing" })

// ③ 接受 → 派生任务
pm_create({
  type: "task",
  projectSlug: "proj",
  requirement: "[[REQ-proj-001]]",
  title: "实现 OAuth 适配",
  priority: "P1",
  due: "2026-11-30",
})

// ④ 任务开始
pm_move({ id: "TASK-proj-001", status: "doing" })

// ⑤ 任务完成（`updated` 与 `completed` 自动维护）
pm_move({ id: "TASK-proj-001", status: "done" })
```

### 4.2 巡检（`07-workflow`）

```jsonc
pm_validate({ files: ["projects/proj"] })     // 精确报文件+字段
pm_check({})                                   // 全局一致性（悬空链接/编号冲突/日期倒挂）
pm_stats({})                                   // 整体进度速览
```

### 4.3 完成标准（`07-workflow` 周报）

```jsonc
pm_stats({})          // 本周完成率、逾期数（输入材料）
pm_search({ q: "TASK-proj", type: "task" })     // 最近任务一览
```

---

## 5. 调用纪律（代理应遵守）

1. **创建前先确认 id/路径可用**：`pm_create` 失败时按 `details.code` 补全（如 `E_SEQ_EXHAUSTED` → 先归档旧条目）。
2. **流转非法不可重试**：`pm_move` 反馈 `E_INVALID_TRANSITION`，不要反复尝试——必须先 `pm_stats`/`pm_validate` 了解状态。
3. **编号不可瞎编**：所有 id 从 `pm_create` 返回或 `pm_search` 查询得到。
4. **batch 友好**：`pm_validate`/`pm_check`/`pm_stats` 均支持多文件/全局扫描，建议每批次结束后做一次 `pm_check`。

> **理由**：这些纪律是"实施者能直接复用的确定性规则"（`03-cli §5` 的"报错精确到 file+field"继续向下传播到代理调用层）；MCP 是"Agent-first"的执行入口（`00-plan-final §1`）。
