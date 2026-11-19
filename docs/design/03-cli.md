# 03 · CLI（`pm` 命令）详设

> 依据：`docs/00-plan-final.md`（唯一事实来源，接口清单 §5：`pm validate / new / move / stats / check / inbox / serve`）
> 契约参考：`docs/design/01-数据规范.md`（Zod schema、状态机、编号规则）、`docs/design/02-core.md`（错误码、Stats 类型）

---

## 1. 全局约定

### 1.1 公共开关

- `--json`：全局可用（除 `serve` 外），默认 `false`。`true` 时输出结构化 JSON（下文各命令 JSON schema），人类可读输出与 `--json` 同时到 stdout，错误到 stderr（结构化：`{ ok: false, code, message, issues? }`）。
- `--root <path>`（全局可选）：指定 `pm.config.json` 所在工程根（默认当前目录及其祖先链，详见 `02-core §4.1`）。
- 解析顺序：先 `loadConfig()`（失败 → `E_CONFIG_INVALID`），再 `buildIndex()`，再执行命令逻辑。

### 1.2 命令名（plan §5 接口清单）

| 命令 | 语义 |
|---|---|
| `pm validate` | 全部/指定文件校验，报错精确到 file+field |
| `pm new project` / `pm new requirement` / `pm new task` | 脚手架：自动分配编号、生成合规模板 |
| `pm move <id> --status <new>` | 状态流转：校验状态机，自动维护 updated/completed |
| `pm stats` | 聚合统计：进度、逾期、各状态数量 |
| `pm check` | 一致性检查：悬空 wiki-link、孤儿任务、编号冲突、日期倒挂 |
| `pm inbox list` / `pm inbox archive` / `pm inbox process` | inbox 整理辅助（`01-数据规范 §7`） |
| `pm serve` | 启动 Web 服务 |

> `pm` 无参数或不认识 → 输出全命令表，退出码 2（用法错误）。

### 1.3 Exit codes（统一退出码，跨 CLI/MCP/Web 交叉引用）

> 映射到 core 错误码：`02-core §3.1`；HTTP 状态：`05-server §6.5`（§6.5 为统一错误码↔HTTP 状态表）。

| 退出码 | 含义 | 触发 core 错误码 | HTTP |
|---|---|---|---|
| 0 | 成功 | ok | 200 |
| 1 | 内部/资源错误 | `E_IO`、`E_NOT_FOUND` | 500、404 |
| 2 | 用法错误 / 配置错误 / 巡检发现（`pm check`） | `E_USAGE`、`E_CONFIG_INVALID`、check 非空 `issues` | 400、500 |
| 3 | 冲突（有人改了文件） | `E_CONFLICT` | 409 |
| 4 | 校验/流转失败 | `E_VALIDATION`、`E_INVALID_TRANSITION` | 422、409 |
| 5 | 编号耗尽 | `E_SEQ_EXHAUSTED` | 409 |

---

## 2. `pm validate`

> plan §5："校验全部/指定文件，报错精确到 file+field"

### 2.1 参数表

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `[files...]` | — | string[] | 否 | 全部 | 每个参数可是相对/绝对路径（目录 = 该目录下所有 md） |
| `--json` | — | boolean | 否 | false | 输出结构化 |

### 2.2 `--json` 输出（完整 JSON schema）

```ts
// validate --json
{
  checkedFiles: number;               // 实际校验的文件数（broken 也算数）
  ok: boolean;                        // errors 为空 → true
  errors: Array<{
    file: string;                     // 绝对路径（`file` 精确位置）
    field?: string;                   // 字段路径（如 "status"、"tags[0]"、"requirement"）
    code: string;                     // "E_VALIDATION"（Zod）/ "E_INVALID_TRANSITION"?
                                      // validate 不流转；仅 E_VALIDATION + 一个通用 "E_CONFIG_INVALID"
    message: string;                  // 人类可读描述
  }>;
}
```

> 理由：`validate` 只校验不流转，故错误码为 `E_VALIDATION`（Zod/配置等）；`E_INVALID_TRANSITION` 由 `pm move` 产生（§5）。`ok` 与 `checkedFiles` 给脚本判断用。悬空 wiki-link 引用（如 `requirement: "[[REQ-proj-999]]"`）由 `pm check` 报告（`E_DANGLING_WIKI`，`01-数据规范 §6.2`）；frontmatter 本身 Zod 通过，`pm validate` 不校验悬空。

### 2.3 人类可读输出示例

```
✅ 全部 23 个文件校验通过
```
```
🔍 校验了 23 个文件，发现 2 个问题：
  ✖ E:\repos\project-manage\PM\projects\proj\requirements\REQ-proj-002.md
    status: ["pool"]   — 不是合法枚举值（E_VALIDATION）
  ✖ E:\repos\project-manage\PM\projects\proj\tasks\TASK-proj-003.md
    due: "2026-13-01"   — 不是合法日期（E_VALIDATION）
```

---

## 3. `pm new`

> plan §5："脚手架：自动分配编号、生成合规模板"

### 3.1 `pm new project [flags]`

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--name <name>` | — | string | 是 | — | 项目名；slug 自动规范化（§1 交叉，slug 策略见 `01-数据规范 §1.5`） |
| `--slug <slug>` | — | string | 否 | name 的 slug | 显式覆盖 slug（歧义解析顺序：显式 --slug > --name 规范化） |
| `--period <start> <end>` | — | ISO date ×2 | 否 | `[今天, 今天]` | project.md `period`（校验 `start ≤ end`） |
| `--tags <t1,t2>` | — | string[] | 否 | `[]` | 逗号分隔，trim，去重 |
| `--status <status>` | — | enum | 否 | `active` | 见 `01-数据规范 §1.1` |

`--json` 输出：`{ created: { id: string; slug: string; path: string } }`（`path` 为绝对路径）。

### 3.2 `pm new requirement [flags]`

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--slug <slug>` | — | string | 是 | — | 目标项目 slug（项目目录必须已存在，否则 `E_NOT_FOUND`） |
| `--title <title>` | — | string | 是 | — | requirement.title（非空，≤200） |
| `--module <module>` | — | string | 否 | `""` | 归属模块 |
| `--source <source>` | — | string | 否 | `human` | 来源描述（默认 `human`，非空；`01-数据规范 §1.2` 要求 source 必填非空） |
| `--priority <p>` | — | enum | 否 | `P2` | P0/P1/P2/P3 |
| `--status <status>` | — | enum | 否 | `pool` | 见 `01-数据规范 §1.2` |

`--json` 输出：`{ created: { id: string; path: string } }`。

### 3.3 `pm new task [flags]`

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--slug <slug>` | — | string | 是 | — | 项目 slug（must exist → `E_NOT_FOUND`） |
| `--requirement <REQ id>` | — | string | 是 | — | `requirement` 字段；格式校验 + 目标存在校验（`pm check` 也可发现；此处 fail-fast） |
| `--title <title>` | — | string | 是 | — | task.title |
| `--priority <p>` | — | enum | 否 | `P2` | |
| `--due <date>` | — | ISO date | 是 | — | `due`（必填，见 `01-数据规范 §1.3`） |
| `--status <status>` | — | enum | 否 | `todo` | 通常 `todo`（脚手架语义） |

`--json` 输出：`{ created: { id: string; path: string } }`。

### 3.4 退出码

- `0`：已创建（`created` 含完整 id + path）。
- `2`：`E_USAGE`（缺 `--slug`/`--title`/`--requirement`）、`E_CONFIG_INVALID`。
- `4`：`E_VALIDATION`（字段校验失败，如空 title）。
- `1`：`E_NOT_FOUND`（项目目录不存在 / requirement 不存在）。
- `5`：`E_SEQ_EXHAUSTED`（三位序号耗尽，`01-数据规范 §1.5`）。

### 3.5 人类可读示例

```
$ pm new project --name "我的应用 v2"
✅ 已创建项目: PM/projects/我的应用-v2/project.md
```
```
$ pm new requirement --slug proj --title "支持 OAuth 登录" --module auth --source "inbox:42"
✅ 已创建需求: PM/projects/proj/requirements/REQ-proj-001.md
```
```
$ pm new task --slug proj --requirement REQ-proj-001 --title "实现 OAuth 适配" --priority P1 --due 2026-11-30
✅ 已创建任务: PM/projects/proj/tasks/TASK-proj-001.md
```

---

## 4. `pm move`

> plan §5："状态流转：校验状态机，自动维护 updated/completed"（`01-数据规范 §3` 状态机）

### 4.1 参数表

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `<id>` | — | string | 是 | — | 三种 id（REQ/TASK/项目 project id）均接受；按前缀识别类型（`REQ-`、`TASK-`，或 project id 即 slug 且 `projects/<slug>/project.md` 存在） |
| `--status <status>` | `-s` | enum | 是 | — | 目标状态（§1.2 注 + `01-数据规范 §3` 流转表） |
| `--json` | — | boolean | 否 | false | 输出结构化 |

### 4.2 `--json` 输出

```ts
// move --json
{
  ok: boolean;                    // true
  file: string;                   // 绝对路径
  from: string;                   // 流转前状态
  to: string;                     // 流转后状态
  updatedField: "updated" | "updated+completed";  // 副作用（`01-数据规范 §3`）
  id: string;                     // 操作对象 id
}
```

### 4.3 人类可读输出示例

```
$ pm move REQ-proj-001 --status reviewing
✅ REQ-proj-001: pool → reviewing (updated 维护)
```
```
$ pm move TASK-proj-003 --status done
✅ TASK-proj-003: doing → done (updated, completed 维护)
```

### 4.4 退出码

- `0`：流转成功（状态已写入文件，副作用已维护）。
- `4`：`E_INVALID_TRANSITION`（含拒绝原因，如 "doing → todo 不可逆回退，拒绝流转"；`01-数据规范 §3.4` 非法流转清单）。
- `1`：`E_NOT_FOUND`（id 不存在）。
- `2`：`E_USAGE`（缺 `--status`）。

> 错误 JSON（stderr）：`{ ok: false, code: "E_INVALID_TRANSITION", message, file, field: "status", issues: [{file, field, code, message}] }`。

---

## 5. `pm stats`

### 5.1 参数表

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--json` | — | boolean | 否 | false | 输出结构化 |

### 5.2 `--json` 输出（完整，结构来自 `02-core §2.4`）

```ts
// stats --json ≡ Stats
{
  projects: Array<{
    slug: string;
    name: string;
    status: "active" | "paused" | "done" | "archived";
    progress: {
      completedRate: number;      // 0..1（done/total）
      overdueCount: number;       // overdue 定义见 02-core §2.4
      totalTasks: number;
      doneTasks: number;
      cancelledTasks: number;
      onTrack: number;            // 与 02-core §2.4 Progress.onTrack 同义
    };
  }>;
  totals: {
    requirements: {
      total: number;
      byStatus: { pool: number; reviewing: number; accepted: number; rejected: number; done: number };
    };
    tasks: {
      total: number;
      byStatus: { todo: number; doing: number; done: number; cancelled: number };
      overdue: number;
      onTrack: number;   // 前述 02-core §2.4 onTrack（todo/doing 且 due ≥ today）
    };
  };
}
```

### 5.3 人类可读输出示例

```
📊 my-app (active)
  任务进度: 5/9 完成 (55.6%)
  过期: 2 任务 (TASK-proj-002, TASK-proj-004)
```

### 5.4 退出码

- `0`：成功。
- `1`：`E_CONFIG_INVALID`（无法加载配置）、`E_IO`（扫描失败）。

---

## 6. `pm check`

> plan §5："一致性检查：悬空 wiki-link、孤儿任务、编号冲突、日期倒挂"

### 6.1 参数表

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--json` | — | boolean | 否 | false | 输出结构化 |

### 6.2 检查清单（任务书指定 + `01-数据规范 §4.2` 已定硬错 + §6.2 dangling）

| # | 检查项（`issue.code`） | 触发条件 | 影响范围 |
|---|---|---|---|
| 1 | `dangling-wiki` | wiki-link 目标不存在（无匹配 requirement，或目标不在当前项目） | 悬空 wiki-link（`01-数据规范 §6.2`） |
| 2 | `invalid-link-target` | 链接格式不合法（不匹配 `^\[\[REQ-...\]\]$`） | 跨区域非法关联 |
| 3 | `id-conflict` | 同前缀+slug 编号重复（多个文件 id 相同） | 编号冲突（plan "编号冲突"） |
| 4 | `date-inverted` | `updated < created`（需求/任务）；或 `due < created`（任务） | 日期倒挂（plan "日期倒挂"） |
| 5 | `invalid-frontmatter` | 解析失败/Zod 不通过（非法流转见 `pm move`） | 待修复清单（`02-core §3.2`） |

> 理由：任务书指定 4 类；补 `invalid-link-target`（§4.2 第 2 条强制格式）与 `invalid-frontmatter`（§4.2 第 6 条待修复清单），使 check 对"任何失败"都有覆盖；`id-conflict` 用 scan 的 id→file 索引计算。

### 6.3 `--json` 输出

```ts
// check --json
{
  ok: boolean;                    // issues 为空 → true
  issues: Array<{
    file: string;                 // 绝对路径
    field?: string;               // 具体字段（可选）
    code: "dangling-wiki" | "invalid-link-target" | "id-conflict" | "date-inverted" | "invalid-frontmatter";
    message: string;
  }>;
}
```

### 6.4 人类可读输出示例

```
🔍 检查完成，发现 2 个问题:
  1. [dangling-wiki]      projects/proj/tasks/TASK-proj-003.md: requirement 引用 [[REQ-proj-999]] 不存在
  2. [id-conflict]        projects/proj/requirements/REQ-proj-001.md 与 projects/proj/tasks/TASK-proj-001.md id 重复
```
```
🟢 台账一致性健康（check 发现 0 个问题）
```

### 6.5 退出码

- `0`：无问题。
- `2`：发现问题（issues 非空；警告级，以 exit=2 让脚本/CI 能发现）。
- `1`：`E_CONFIG_INVALID`（无法加载配置）。

---

## 7. `pm inbox`

> plan §4.1：`inbox/` 收集箱；详设见 `01-数据规范 §7`（整理流程/归档规则）

### 7.1 子命令

| 命令 | 参数 | 描述 |
|---|---|---|
| `pm inbox list` | `--json` | 列出未归档 inbox 条目（`01-数据规范 §7.3` 步骤 2，按 `created` 降序） |
| `pm inbox process` | `--json` | 预览待处理条目（给 agent 看；默认只列前 N 条，见下） |
| `pm inbox archive <id>` | `--json` | 归档条目（`01-数据规范 §7.4`） |

### 7.2 `pm inbox list --json` 输出

```ts
{
  entries: Array<{
    id: string;                   // 如 INBOX-inbox-001
    created: string;              // YYYY-MM-DD
    slug?: string;
    tags: string[];
    source?: string;
    file: string;                 // 相对 PM 根的路径，如 "inbox/2026-11-19-idea.md"
    bodyFirstLine: string;        // 正文第一行（空则空串）
    status: "active" | "archived";// 未归档 vs 已归档（§7.4）
  }>;
  count: number;
}
```

### 7.3 `pm inbox process [--limit <n>] [--all] [--dry-run]`

- 默认：列出 `limit`（默认 20）条未归档条目的"摘要预览"（id/created/tags/file/首行）。
- `--all`：不限条数。
- `--dry-run`：只预览，不做任何写入/归档。
- 输出：`--json` 时同 §7.2 结构；人类输出示例：
```
📥 inbox 未处理（2 条）
  1. INBOX-inbox-001  2026-11-19  file=inbox/2026-11-19-idea.md
     首行: 需要加 OAuth 登录
  2. INBOX-proj-002    2026-11-18  file=inbox/old.md
     首行: 支付回调失败
```
- 退出码：`0`；`2`（`E_USAGE`）如 `--limit` 非正数。

### 7.4 `pm inbox archive <id> --json` 输出

```ts
{
  archived: {
    id: string;
    from: string;   // 原绝对路径
    to: string;     // 新绝对路径（PM/inbox/archive/<name>）
    archivedDate: string;
  },
}
```
- 退出码：`0`；`1`（`E_NOT_FOUND`）编号不存在。

### 7.5 人类可读输出示例

```
✅ INBOX-inbox-001 已归档至 PM/inbox/archive/2026-11-19-idea.md
```

---

## 8. `pm serve`

| 参数 | 缩写 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|---|
| `--port <n>` | `-p` | integer | 否 | `3000` | 监听端口 |
| `--host <host>` | `-H` | string | 否 | `127.0.0.1` | 监听地址 |
| `--watch <seconds>` | — | number | 否 | 见 `05-server §5.2` | SSE 推送延迟上限（≤2s） |

- 运行时长：阻塞直到被中断（Ctrl-C → 退出码 0）。
- `--json` 不适用（serve 省略全局 `--json`）。
- 启动输出：`ℹ️  启动 PM Web 服务 http://127.0.0.1:3000/ （静态托管 apps/web/dist）`。
- 详见：`05-server §5`（SSE 推送时序、静态托管/开发代理）。

---

## 9. 典型使用示例

### 9.1 人类视角（`01-数据规范 §7.3` 异常处理一致使用）

```bash
# 新建项目（slug 自动规范化）
pm new project --name "我的应用 v2"

# 新建需求
pm new requirement --slug 我的应用-v2 --title "支持 OAuth 登录" --module auth --source "inbox:42"

# 提交整理完成
pm move REQ-我的应用-v2-001 --status reviewing

# 校验台账
pm validate
pm check
```

### 9.2 代理视角（AGENTS.md 速查版，`07-workflow`）

```bash
# 整理 inbox：看未处理条目
pm inbox list --json
# 产生需求
pm new requirement --slug proj --title "实现 OAuth 适配" --module auth --source "inbox:42"
# 归档已处理条目
pm inbox archive INBOX-inbox-001

# 派生任务
pm new task --slug proj --requirement REQ-proj-001 --title "实现 OAuth 适配" --priority P1 --due 2026-11-30

# 巡检（§6.2 SOP）
pm validate --json
pm check --json

# 状态流转
pm move TASK-proj-001 --status doing
pm move TASK-proj-001 --status done

# 统计
pm stats --json
```

---

## 10. 交叉引用清单（全局一致性）

- 退出码 ↔ core 错误码：本表（`03-cli §1.3`）↔ `02-core §3.1`
- `E_INVALID_TRANSITION` 的 HTTP 状态：409（本表）；CLI 入口：4
- `E_CONFLICT` 的 HTTP 状态：409；CLI 入口：3
- `pm validate` 的 error.code ∈ `E_VALIDATION`；`pm check` 的 issue.code ∈ {dangling-wiki, invalid-link-target, id-conflict, date-inverted, invalid-frontmatter}
- `pm new` 的 id/path 字段名 = `02-core §2.2`（`FileEntry`，路径型）+ `02-core §2.7`（流转结果含 `file`）
- `pm stats --json` 结构 = `02-core §2.4`（`Stats`）
