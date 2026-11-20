# 02 · `@pm/core` 详设

> 依据：`docs/00-plan-final.md`（唯一事实来源）
> 范围：`@pm/core` —— 唯一业务实现，CLI/MCP/Web 各包均为薄封装（plan §3）
> 契约参考：`docs/design/01-数据规范.md`（`ZProject`/`ZRequirement`/`ZTask`/`ZInboxEntry`、状态机、编号规则）

---

## 1. 模块划分（plan §3：config/scanner/parser/indexer/watcher/writer/services）

| 模块 | 职责 | 文件位置 |
|---|---|---|
| `config` | 读取 `pm.config.json`（`vaultPath`/`pmRoot`），提供默认值（`Config` 接口） | `packages/core/src/config/index.ts` |
| `scanner` | 目录树递归扫描（`scanTree`），产出 `FileEntry[]`（不含自忽略判定） | `packages/core/src/scanner/walk.ts` |
| `parser` | frontmatter 解析（gray-matter + Zod），产出 `ParseResult<T>`（含 issues 详情） | `packages/core/src/parser/frontmatter.ts` |
| `indexer` | 全量/增量索引构建（`buildIndex`、`reindexFile`、`applyChange`），组装 `VaultIndex`（含反链聚合） | `packages/core/src/indexer/index.ts` |
| `watcher` | chokidar 文件监听 + 防抖 + 自忽略，转发事件给订阅者 | `packages/core/src/watcher/index.ts` |
| `writer` | 原子写（临时文件 + `rename`）+ mtime 冲突检测 | `packages/core/src/writer/atomic.ts` |
| `services` | 业务服务：状态机校验/流转、统计聚合、编号分配、错误模型、日期工具 | `packages/core/src/services/*.ts` |

其它规范目录：`packages/core/src/schema/`（Zod schema，对应 01-数据规范 §5）。

---

## 2. 核心类型定义（Types 清单）

```ts
// packages/core/src/types.ts（部分在 schema 模块再导出）
import type { Project, Requirement, Task, InboxEntry, ProjectStatus, ReqStatus, TaskStatus, Priority } from "./schema/index";
import { z } from "zod";

// ===== 2.1 Config =====
/** `pm.config.json` 结构（plan §7：{ vaultPath, pmRoot }，详设补充） */
export interface Config {
  /** Obsidian Vault 绝对路径 */
  vaultPath: string;
  /** PM 根目录（默认 `<vaultPath>/PM`；除非配置覆盖，详见 config/loadDefaultConfig） */
  pmRoot: string;
  /** 编号/任务维护的默认操作者（代理视角）；非必填 */
  defaultAuthor?: string;
}

// ===== 2.2 扫描 =====
export interface FileEntry {
  absPath: string;        // 绝对路径
  relPath: string;        // 相对 pmRoot 的 POSIX 风格相对路径
  mtimeMs: number;        // fs.statSync().mtimeMs
  size: number;
}

export interface VaultScan {
  entries: FileEntry[];   // 相对 pmRoot 存（便于 watcher 事件比对）
  byPath: Map<string, FileEntry>;  // relPath → entry（冲突时以较大 mtimeMs 为准）
}

// ===== 2.3 数据与索引 =====
export interface BrokenFile {
  file: FileEntry;
  issues: Array<{ path: string; code: string; message: string }>; // ZodIssue 缩略
  reason: "parse" | "id-path-mismatch" | "unknown-type";
}

export interface UnnumberedFile { file: FileEntry; }

export interface VaultIndex {
  config: Config;
  scan: VaultScan;
  projects: Project[];                       // 按 slug 升序
  requirements: Requirement[];               // 按 id 升序
  requirementsByProject: Map<string, Requirement[]>;
  tasks: Task[];                             // 按 id 升序
  inboxEntries: InboxEntry[];                // 按 created 倒序（UI 需求，`01-数据规范 §7.3` 步骤 2）
  unnumbered: UnnumberedFile[];              // 已排序，按路径
  broken: BrokenFile[];                      // 待修复清单
  requirementTasks: Map<string, string[]>;   // 反链聚合：REQ id → [TASK id]（§6.3）
  /** relPath → 记录索引（用于 watcher 增量删除/修改，见 §5） */
  byPath: Map<string, Project | Requirement | Task | InboxEntry | BrokenFile>;
  builtAt: string;                           // ISO 时间（诊断）
}

// ===== 2.4 统计（进度为派生值，plan §4.3 第 2 条；一切从 VaultIndex 计算） =====
export interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;      // todo/doing/done/cancelled
  overdue: number;                           // status ∈ {todo, doing} && due < today（07-workflow §1 日期约定）
  onTrack: number;                           // 在时间线上未超期的任务数：todo/doing 且 due ≥ today（02-core §8 isPast/overdue）
}

export interface Progress {
  completedRate: number;     // done / total（0 个任务为 0）
  overdueCount: number;
  totalTasks: number;
  doneTasks: number;
  cancelledTasks: number;
  onTrack: number;           // 与 TaskStats.onTrack 同义（02-core §2.4）
}

export interface Stats {
  projects: Array<{ slug: string; name: string; status: ProjectStatus; progress: Progress; }>;
  totals: {
    requirements: { total: number; byStatus: Record<ReqStatus, number> };
    tasks: TaskStats;
  };
}

// ===== 2.5 流转与校验 =====
export interface MoveResult {
  ok: true;
  file: FileEntry;
  from: string;
  to: string;
  updatedField: "updated" | "updated+completed";
}

export interface ValidateResult {
  ok: boolean;
  errors: Array<{
    file: string;             // 绝对路径
    field?: string;           // 详细字段（file+field 精确到字段，03-cli §1）
    code: string;             // 与错误码体系一致（§3.4）
    message: string;
  }>;
  checkedFiles: number;
}

// ===== 2.6 搜索 =====
export interface SearchResult {
  id: string;
  type: "project" | "requirement" | "task" | "inbox";
  slug: string;
  relPath: string;
  title: string;
  highlight?: string;
}

export interface SearchHit {
  q: string;
  results: SearchResult[];
}

// ===== 2.7 写冲突 =====
export interface WriteConflict {
  code: "E_CONFLICT";
  path: string;
  expectedMtimeMs?: number;
  currentMtimeMs?: number;
  message: string;
}

export type AppResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface AppError {
  code: string;
  message: string;
  /** 可选：HTTP 状态码映射建议（02-core §3.4，与 03-cli 退出码对应） */
  httpStatus?: number;
  /** 可选：文件与字段精确位置（§3.4） */
  file?: string;
  field?: string;
  /** 可选：详细 issues（E_VALIDATION / E_INVALID_TRANSITION） */
  issues?: Array<{ file: string; field: string; code: string; message: string }>;
}

/** 所有核心对外函数一律返回 AppResult（除需抛异常的底层 API，理由：统一错误模型） */
export function ok<T>(value: T): AppResult<T>;
export function err<T = never>(error: AppError): AppResult<T>;

// ===== 2.8 全局工具 =====
export function today(): string;            // YYYY-MM-DD（本地时区）
export function maxDate(a: string, b: string): string;
export function isBefore(a: string, b: string): boolean;
export function isPast(date: string): boolean;  // date < today（用于 overdue）
export function normalizePath(p: string): string; // 统一分隔符（POSIX 风格）
```

> **理由**：类型清单与 plan §4.2/§4.3 字段严格对应（`VaultIndex` 一份代码，CLI/MCP/Web 共享）；`AppResult` 返回统一错误模型（§3.4）。

---

## 3. 统一错误模型（02-core §3）

> 索引约定：本节为错误模型主体（有的旧引用里的 "02-core §3.4" 即指本节）；`§3.1` = 错误码清单 + 语义 + 呈现方式；`§3.2` = 错误呈现；`§3.3` = 统一错误形状示例（含 `E_INVALID_TRANSITION` 示例）。
> CLI/HTTP 映射 = `03-cli §1.3` / `05-server §6.5`，统一在对应端点/命令表里谈论，不重复说明。

### 3.1 错误码清单 + 语义 + 呈现方式

| 错误码 | 语义 | 呈现（CLI 退出码 / HTTP 状态） | 场景 |
|---|---|---|---|
| `E_CONFIG_INVALID` | `pm.config.json` 缺失/非法 | 2 / 500 | loadConfig 失败；全局性，用户需修理配置 |
| `E_USAGE` | 参数/用法错误（未知命令、缺必填参数、参数取值非法） | 2 / 400 | `pm move` 无 `--status`；CLI 层校验 |
| `E_NOT_FOUND` | 引用的 id/文件/项目不存在 | 1 / 404 | `pm move REQ-x-999` 找不到文件；`GET /api/.../x` 404 |
| `E_VALIDATION` | frontmatter/Zod 校验失败（精确到 file+field） | 4 / 422 | `pm validate`、接口 PATCH 校验失败 |
| `E_INVALID_TRANSITION` | 非法状态流转（§3.1–3.3） | 4 / 409 | `pm move doing → todo` |
| `E_CONFLICT` | mtime 冲突（写冲突，由前端提示） | 3 / 409 | `atomicWriteFile` 检测到外部修改；`PUT/PATCH` 并发 |
| `E_SEQ_EXHAUSTED` | 编号池耗尽（>999） | 5 / 409 | `allocateId` 池用尽（§1.5） |
| `E_DANGLING_WIKI` | 悬空 wiki-link（`pm check` 报告） | —（check 以 `issues` 见下） | 链接目标不存在或跨项目（`01-数据规范 §6.2`） |
| `E_IO` | 其它文件 IO 错误（权限/磁盘） | 1 / 500 | scan/write IO 失败 |
| `E_UNKNOWN_TYPE` | 文件不可识别（`unnumbered`，`02-core §4.4` 分类规则 + `01-数据规范 §7.5` 降级） | —（check 以 `issues` 见下） | 无法识别类型的 md 文件 |

> **理由**：
> - `E_DANGLING_WIKI` / `E_UNKNOWN_TYPE` 是 `pm check` 的报告类问题：CLI 以 `issues` 输出且退出码 2（`03-cli §6`），`pm validate` 的 `broken` 清单也可见；Web 通过 `broken`/`check` 端点（`05-server §5.5`）展示警示。
> - 退出码/HTTP 状态与 03-cli.md §"exit codes"（`03-cli §1.3`）与 05-server.md "错误码" 表（`05-server §6.5`）完全统一——`E_INVALID_TRANSITION` = CLI 4 / HTTP 409；`E_CONFLICT` = CLI 3 / HTTP 409；`E_VALIDATION` = CLI 4 / HTTP 422。

### 3.2 错误呈现

- CLI：`AppError` → `console.error(message)`，退出码 = 映射表（`03-cli §1.3`）；`--json` 模式错误输出 `{ ok: false, code, message, ...issues }`。
- MCP：返回 `isError: true` 的 ToolResult，`content[0].text` 为 `[<code>] <message>`（`04-mcp §1.1`），`details` 含 issues（`04-mcp §1.1`）。
- Web：`AppError.httpStatus` → HTTP 状态码 + JSON body `{ ok: false, error: { code, message, file?, field?, issues? } }`（`05-server §1.1`/§6.4）。

### 3.3 统一错误形状示例（`AppError`）

```ts
// 非法流转（E_INVALID_TRANSITION）示例——呈现形状 = §3.2 的三处各一份（CLI/MCP/Web）
interface AppError {
  code: string;                 // "E_INVALID_TRANSITION"
  message: string;              // "非法状态流转: doing -> todo 不可逆回退，拒绝流转"（§3，01-数据规范 §3.4 定义流转前置表）
  file: string;                 // 目标文件绝对路径（由 services/status 编译）
  field: string;                // "status"（精确字段）
  issues: Array<{ file: string; field: string; code: string; message: string }>; // 详情清单
}

// 冲突（E_CONFLICT）示例——HTTP 409 body 形状（`05-server §6.4`）
{
  ok: false,
  error: {
    code: "E_CONFLICT",
    message: "文件已被外部修改",
    file: "E:\\repos\\project-manage\\PM\\projects\\proj\\requirements\\REQ-proj-001.md",
    expectedMtimeMs: 1710000000000,
    currentMtimeMs: 1710000100000,
    httpStatus: 409,
  },
}
```

> **理由**：此前 `02-core` 内部多处引用 `02-core §3.4` 指代这个统一错误形状示例，本节补齐为可直接引用的"非法流转示例 + 冲突示例"，实现者用它验证三处呈现一致性。

---

## 4. 模块职责与流程

### 4.1 `config/loadConfig`

```ts
// packages/core/src/config/index.ts
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { ok, err, type AppResult, type Config } from "../types";
import { E_CONFIG_INVALID } from "../errors";

export const ZConfig = z.object({
  vaultPath: z.string().min(1),
  pmRoot: z.string().min(1),
  defaultAuthor: z.string().optional(),
});

/** pm.config.json 内容（plan §7 扩展：vaultPath、pmRoot、可选 defaultAuthor） */
export const RAW_CONFIG_DEFAULTS = (vaultPath: string): Config => ({
  vaultPath,
  pmRoot: path.join(vaultPath, "PM"),
});

export function loadConfig(projectRoot?: string): AppResult<Config> {
  const root = projectRoot ?? process.cwd();
  const cfgPath = path.join(root, "pm.config.json");
  try {
    if (!fs.existsSync(cfgPath)) return ok(RAW_CONFIG_DEFAULTS(process.cwd() === root ? resolve(vaultGuess()) : vaultFromGuess()));
    // 省略细节：校验并合并默认
  } catch {
    return err({ code: "E_CONFIG_INVALID", message: "读取 pm.config.json 失败" });
  }
  // ... 见实现（packages/core/src/config/index.ts）
}
```

> **注**：`vaultPath` 解析逻辑 = 优先 `pm.config.json`，否则从 `packages/core` 的祖先链找带 `PM/` 的仓库，再回退 `vaultPath = process.cwd()`（简述，实现见 config/index.ts）。关键点：vaultPath/pmRoot 必须解析到实际存在的 Obsidian Vault。

### 4.2 `scanner/walk` — 扫描

```ts
export interface VaultScan { entries: FileEntry[]; byPath: Map<string, FileEntry>; }

/** 递归扫描目录。跳过：隐藏文件/目录（名以 `.`/`_` 开头？Obsidian `.obsidian`），以及 @pm 自忽略路径（§5.3）。理由：Vault 第三方目录（`.obsidian`）与应用自身产物（`pm.config.json` 在仓库根而非 PM 内）不是数据。 */
export function scanTree(dir: string): FileEntry[];
```

- 输入：`config.pmRoot`（扫描以 PM 为根）。
- 输出：排序后的 `FileEntry[]`（按 relPath 升序，确定性），`byPath: Map<relPath, FileEntry>`。
- 自忽略：writer 写入时记录 `writtenPaths.add(relPath, mtimeMs)`，scanner 过滤 `byPath` 中该 mtime 匹配的条目（§5.3）。

### 4.3 `parser/frontmatter` — 解析

```ts
// packages/core/src/parser/frontmatter.ts
import { z, type ZodTypeAny, type ZodIssue } from "zod";
import { parse } from "gray-matter";

export type ParseResult<T> =
  | { ok: true; data: T; body: string; mtimeMs: number }
  | { ok: false; issues: ZodIssue[]; raw: string; body: string; mtimeMs: number };

export function parseFile<T extends ZodTypeAny>(absPath: string, schema: T): ParseResult<z.infer<T>> {
  const raw = fs.readFileSync(absPath, "utf8");
  const res = parse(raw);              // gray-matter（plan）
  const parsed = schema.safeParse(res.data);
  if (parsed.success) return { ok: true, data: parsed.data, body: res.content, mtimeMs: statMtime(absPath) };
  return { ok: false, issues: parsed.error.issues, raw, body: res.content, mtimeMs: statMtime(absPath) };
}
```

> **注**：`Zod` 用 `safeParse`（不抛异常），issues 转入 `BrokenFile`（§3.2/§6.2）。`id 与目录名一致` 这类跨文件校验在 indexer 层做（§5.2），因为 parser 单文件无法知道目录名。

### 4.4 `indexer/index` — 构建与增量索引

```ts
// packages/core/src/indexer/index.ts
import { parseFile } from "../parser/frontmatter";
import { ZProject, ZRequirement, ZTask, ZInboxEntry, type Project, type Requirement, type Task, type InboxEntry } from "../schema";

/** 全量：scanTree → parseFile(每个 md) → 分类（projects/requirements/tasks/inboxEntries/unnumbered/broken）→ buildRequirementTasks（反链聚合）→ byPath */
export function buildIndex(config: Config): VaultIndex;

/** 增量：单文件变更后用（watcher 触发或显式调用）。交给 getGlobalIndex / GlobalIndex 处理，详见 §5.4 */
export function reindexFile(index: VaultIndex, absPath: string): void;

/** 反链聚合（01-数据规范 §6.3）：纯函数，从 tasks 推出 map。值 = TASK id 升序。 */
export function deriveRequirementTasks(tasks: Task[]): Map<string, string[]>;

/** 分类规则（§5.1–5.4）：见下文 */
export function classifyFile(relPath: string, data: unknown, isDirectoryFile: boolean): "project" | "requirement" | "task" | "inbox" | "unnumbered" | "broken";
```

**分类规则（§5.1–5.4）（`classifyFile` 实现细节）：**

| 规则 | 判定 | 结果 |
|---|---|---|
| project.md | `type === "project"` 且路径 == `projects/<slug>/project.md`，id == slug | `projects[]` |
| requirement | `type === "requirement"` 且路径在 `projects/*/requirements/` 下 | `requirements[]` |
| task | `type === "task"` 且路径在 `projects/*/tasks/` 下 | `tasks[]` |
| inbox | `type === "inbox"` 且路径在 `inbox/` 根（`inbox/archive/` 排除，归档产物不进索引） | `inboxEntries[]` |
| 归档排除 | 路径在 `inbox/archive/` 下 | （排除：归档产物不进索引，也不算 `unnumbered`，见 §5.2.7） |
| 跨区域类型 | 路径在 projects 下，但 type 不符（或 id 与目录名不一致） | `broken`（reason: id-path-mismatch） |
| 未识别 | md 文件（递归）但无 frontmatter 或 `type` 不是上述字面量 | `unnumbered[]`（或 `broken` reason: unknown-type 若携带 type 但无效） |
| 解析失败 | frontmatter 非法 | `broken`（reason: parse） |

> **理由**：分类规则把"Obsidian 手建的无编号文件降级展示为'未识别编号'"（plan §4.3）变成具体可编码的三态（unnumbered/broken/各业务类型），UI/CLI 可逐一处理，不崩溃。

### 4.5 `watcher/index` — 监听与防抖

```ts
export interface WatcherEvents {
  /** 增加或变化（paths 递归已有的 .md 文件） */
  onChange(paths: string[]): void;
  /** 删除 */
  onUnlink(paths: string[]): void;
}

export interface StartOptions {
  /** 防抖窗口（理由：见 §5.3） */
  debounceMs?: number; // 默认 250
  /** 自写忽略开关（§5.3） */
  ignoreSelfWrites?: boolean; // 默认 true
}

export function startWatcher(config: Config, events: WatcherEvents, opts?: StartOptions): { stop(): void };
```

- 实现：chokidar（`chokidar` 依赖 plan §2）监听 `config.pmRoot`；防抖合并；`onChange` 合并为唯一路径集；`ignoreSelfWrites` 维护 `Map<relPath, mtimeMs>`，mtime 匹配则跳过。

### 4.6 `writer/atomic` — 原子写（plan §4.3 原子写）

```ts
export interface WriteOpts {
  /** 预期当前 mtimeMs（详见 §4.7） */
  expectedMtimeMs?: number;
}

export type WriteResult =
  | { ok: true; path: string; written: FileEntry }
  | { ok: false; error: AppError };   // E_CONFLICT（409）

/**
 * 原子写：临时文件（同目录，`.tmp-<pid>-<n>`）+ writeFileSync + fs.renameSync；
 * 写前 mtime 冲突检测：若 `expectedMtimeMs` 非空且当前 stat.mtimeMs 不匹配 → 返回 { ok:false, E_CONFLICT }。
 * 复查：rename 前再次 stat 与 expected 比对（理由：rename 非原子时间窗内仍可能被并发覆盖，理论值：rename 与 stat 的 TOCTOU，用 2 次复查缩小）。
 * 写后：writer 向 writer/self-ignore 注册（§5.3）。
 */
export function atomicWriteFile(absPath: string, content: string, opts?: WriteOpts): WriteResult;
```

### 4.7 `services/*` — 核心业务服务

```ts
// services/status.ts — 状态机 + 流转（§3.1–3.3）
import { parseFile } from "../parser/frontmatter";
import { ZRequirement, ZTask } from "../schema";

export type MoveOutcome =
  | { ok: true; moved: boolean; from: ReqStatus | TaskStatus | ProjectStatus; to: string; updated: boolean; completedSet: boolean; file: FileEntry; newStatuses: { id: string; status: string } }
  | { ok: false; error: AppError };

/** 校验流转合法性（§3.1–3.3 表）。 */
export function isValidTransition(from: string, to: string, index: VaultIndex): boolean;

/** 状态流转核心（`pm move` 的共用实现）：
 * 1. 查记录（byPath）；不存在 → E_NOT_FOUND
 * 2. isValidTransition 检查 → E_INVALID_TRANSITION（message 含拒绝原因）
 * 3. 更新 frontmatter（`status` + 副作用 `updated=today`，`completed=today` 条件）
 * 4. atomicWriteFile（`expectedMtimeMs` 复查，冲突返回 E_CONFLICT）；成功则 reindex（§5.4）
 * 5. 返回 MoveOutcome（新状态、是否置 completed）；步骤 1–4 在按路径 move 锁（§4.7.1）内串行
 */
export function moveStatus(index: VaultIndex, id: string, next: string): AppResult<MoveOutcome>;

// services/stats.ts — 统计（§2.4, plan §4.3 第 2 条）
export function deriveStats(index: VaultIndex): Stats;

// services/allocate.ts — 编号分配（01-数据规范 §1.5, §2.6）
export function allocateId(index: VaultIndex, prefix: "REQ" | "TASK" | "INBOX" | "project", slug: string): string;
// 规则：扫同前缀+slug 最大序号+1（000 或 001 起）；序号 > 999 → E_SEQ_EXHAUSTED；写前无需在此分配（调用方调 atomicWriteFile，冲突重试时重新 allocate）。

// services/validate.ts — 校验聚合（§4.1, plan §4.3 第 6 条）
/** 校验聚合（§4.1, plan §4.3 第 6 条）：
 * - 纳入：`broken`（Zod/id-path-mismatch）与 `unnumbered`（unknown-type，`01-数据规范 §7.5`）；
 * - `unnumbered` 每个条目输出：`{ file: <relPath>, field: "type", code: "E_VALIDATION", message: "无法识别的类型（`01-数据规范 §7.5`）" }`（精确到 file+field）。
 */
export function validateAll(index: VaultIndex): ValidateResult;

// services/search.ts — 检索（05-server GET /api/search）
export function search(index: VaultIndex, q: string): SearchResult[];

// services/fix.ts — 一键修复（§3.4 呈现）
export function applyFirstIssue(index: VaultIndex, file: FileEntry, issueIdx: number): WriteResult;
```

> **理由**：所有核心对外 API 均为 `AppResult`（§2.8），错误模型统一（03-cli/05-server 直接映射，见交叉引用）；`moveStatus` 让 CLI/MCP/Web 三端"台账巡检"（§6.2 SOP）同源。

### 4.7.1 `moveStatus` 串行化（02-core §4.7）

- 查找 + 校验 + 写入 在按路径 move 锁（`moveLocks: Map<string, Promise<void>>`，以 `FileEntry.relPath` 为 key）内串行完成；
- 锁内 `atomicWriteFile` 携带 `expectedMtimeMs`（= `byPath` 记录的 `mtimeMs`），冲突返回 `E_CONFLICT`（409），调用方刷新重试（§6.1 / §3.2）；
- Web/CLI/MCP 三端统一经 `moveStatus`（§4.7），外部写锁（05-server §6.2）与内部锁共同串行。

---

## 5. 扫描与增量索引流程（自忽略）

### 5.1 启动流程

```
loadConfig()
  → scanTree(pmRoot)                      // FileEntry[]（自忽略已经生效）
  → buildIndex(config, scan)
       parseFile(every .md)  → 分类（§4.4 表）
       deriveRequirementTasks（反链聚合）
       byPath 建立
  → startWatcher(config)                  // chokidar，开启运行期监听
```

### 5.2 `buildIndex` 详细步骤

1. 并行解析所有 `*.md`（Promise.all），得到 `{file, result: ParseResult}` 数组。
2. 按 relPath 稳定排序。
3. 分类（§4.4 表）：把解析结果交给 indexer 的内部分类器（按路径与 `data.type`）。
4. `projects`：`id` 必须 === 目录 slug（`projects/<slug>/` 中的 `<slug>`），否则 `broken`。
5. `requirements`：跨文件链接校验（§6.2）：`id` 中 slug 必须与所在 `projects/<slug>/` 一致，目标 id 必须存在于同项目 requirements（悬空 → `pm check` 报告，聚合时跳过）。
6. `tasks`：wiki-link 校验（同上）+ `estimate` 类型防御（parser 用 Zod 已校验）。
7. `inboxEntries`：`inboxEntries` 按 created 倒序（`01-数据规范 §7.3` 步骤 2）；`inbox/archive/` 下的文件排除（归档产物不进索引，不算 `unnumbered`，`01-数据规范 §7.2/§7.4`）。
8. `broken`：含 `parse` 失败、`id-path-mismatch`、`unknown-type`（但带 frontmatter 且为 md）。
9. `requirementTasks = deriveRequirementTasks(tasks)`（01-数据规范 §6.3）。
10. `byPath`：以 `FileEntry.absPath` 为 key 的 `Map`（`Project/Requirement/Task/InboxEntry/BrokenFile`）。

### 5.3 自忽略

`writer/atomic.ts` 维护（静态导出 `selfWriteCache: Map<string, number>`，或实例注入）：

```ts
/** 登记一次本进程写入（最多保留 64 条，FIFO 淘汰） */
export function registerSelfWrite(absPath: string, mtimeMs: number): void;

/** watcher 事件到达时：相同 path + mtime → 返回 true（忽略） */
export function isSelfWrite(absPath: string, mtimeMs: number): boolean;
```

- `startWatcher(events)` 包装 chokidar：`on(all)` → `events.onChange` / `onUnlink` 之前先 `isSelfWrite` 过滤。
- **理由**：自写（atomWrite + rename 后）必然触发 chokidar 变化事件，不过滤会导致所有操作都触发 `reindexFile` 与 SSE 推送，破坏 plan §3 "应用写 → 落盘 → watcher 自忽略" 的双向同步语义；缓存 64 条比无限过滤（过期条目需要 Obsidian 外部修改也能正确收到）。

### 5.4 `reindexFile`（watcher 增量）

```ts
// packages/core/src/indexer/index.ts
export function reindexFile(index: VaultIndex, absPath: string): void {
  // 更新：对应路径，直接重新 parse，再更新 index 的 byPath/projects/requirements/tasks/inboxEntries
  // 删除：absPath 不存在 → 从 byPath + 三类数组移除
  // 排序稳定：重新整体排序（数据小，更简单安全）
  // 不触发 SSE（由 watcher/server 层决定是否推送，见 05-server §5.2）
}
```

- watcher `onChange` 防抖 250ms 后逐文件 `reindexFile`。

### 5.5 防抖窗口选择

- `debounceMs = 250`（默认），因 `云盘同步`（Obsidian 端多分解现象需要一点稳，2s 过长会让 UI 刷新超过 plan 前端"≤2s"语义，理由：plan §3 双向同步 ≤2s 是对前端刷新的约定，250ms 极佳服务）。

---

## 6. 写回器原子写方案（含 mtime 冲突检测）

> plan §4.3："临时文件 + `fs.rename`；写前比对 mtime，冲突返回 409 由前端提示。"

### 6.1 实现（`packages/core/src/writer/atomic.ts`）

```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isSelfWrite, registerSelfWrite } from "./selfWrite";

let counter = 0;

/** 核心写入：原子、防冲突、全局自忽略登记 */
export function atomicWriteFile(absPath: string, content: string, opts: WriteOpts = {}): WriteResult {
  const dir = path.dirname(absPath);
  const name = path.basename(absPath);

  // 1) mtime 预检（可选期望值）
  if (opts.expectedMtimeMs !== undefined && fs.existsSync(absPath)) {
    const cur = fs.statSync(absPath).mtimeMs;
    if (Math.abs(cur - opts.expectedMtimeMs) > 1 /* 秒级缓存/文件系统时钟误差用小 epsilon，实现可调 */) {
      return {
        ok: false,
        error: {
          code: "E_CONFLICT",
          message: "文件已被外部修改，请刷新后重试",
          file: absPath,
          expectedMtimeMs: opts.expectedMtimeMs,
          currentMtimeMs: cur,
          httpStatus: 409,
        },
      };
    }
  }

  // 2) 写临时文件（同目录，确保 rename 同文件系统）；try/finally 保证失败路径清理残留临时文件
  const tmpName = `.${name}.tmp-${process.pid}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const tmpPath = path.join(dir, tmpName);
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, content, "utf8");

    // 3) rename 前 mtime 复查（收窄 race 窗；过滤自写，检测到并发修改即中止覆盖，保留外部变更）
    if (opts.expectedMtimeMs !== undefined && fs.existsSync(absPath)) {
      const cur = fs.statSync(absPath).mtimeMs;
      if (Math.abs(cur - opts.expectedMtimeMs) > 1 && !isSelfWrite(absPath, cur)) {
        return { ok: false, error: { code: "E_CONFLICT", message: "rename 前复查检测到并发修改，已中止写入", file: absPath, httpStatus: 409 } };
      }
    }

    // 4) rename
    fs.renameSync(tmpPath, absPath);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmpPath); } catch { /* tmp 不存在：忽略 */ }
    }
  }

  // 5) rename 成功后登记自写（§5.3；登记晚于复查，避免 isSelfWrite 恒真使复查分支永不触发）
  registerSelfWrite(absPath, fs.statSync(absPath).mtimeMs);

  const entry: FileEntry = {
    absPath,
    relPath: toPosix(path.relative(config.pmRoot, absPath)),
    mtimeMs: fs.statSync(absPath).mtimeMs,
    size: Buffer.byteLength(content, "utf8"), // 字节数而非 UTF-16 码元数
  };
  return { ok: true, path: absPath, written: entry };
}
```

> **理由**：`rename` 在同文件系统上原子，所以临时文件在同目录更安全；两次 mtime 复查缩小 TOCTOU；`expectedMtimeMs` 由调用方从 `byPath` 读取（§5.2.10），前端收到 409 后提示刷新（05-server §6.4）；`E_CONFLICT` 统一 HTTP 409（02-core §3.1，跨引用 05-server §6.5）。

---

## 7. 内存索引数据结构

`VaultIndex`（§2.3）以下是部分重点数据结构细节：

| 字段 | 结构 | 维护策略 |
|---|---|---|
| `byPath` | `Map<string, Project \| Requirement \| Task \| InboxEntry \| BrokenFile>` | 增量（§5.4）：set/delete |
| `projects` | `Project[]` | 全量 sort；`reindexFile` 整理重排（数据小，更简单安全） |
| `requirements` | `Requirement[]` | 同上 |
| `requirementsByProject` | `Map<string, Requirement[]>` | 同上 |
| `tasks` | `Task[]` | 同上 |
| `inboxEntries` | `InboxEntry[]`（created 降序） | 同上 |
| `unnumbered` | `UnnumberedFile[]`（path 升序） | 同上 |
| `broken` | `BrokenFile[]`（path 升序） | 同上 |
| `requirementTasks` | `Map<string, string[]>` | 每次 `reindexFile`/`buildIndex` 全量重算（源数据小，无增量复杂度） |
| `writtenSelf` | 见 §5.3（writer 模块内静态缓存） | — |

> **理由**：内存索引是"单份真实数据，逐次降序/升序整理"的策略。理由：Vault 项目数据量小（几十个 Requirement/Tasks），整理重排 O(n log n) 用于 watcher 增量优化反而引入不一致风险；`requirementTasks` 是纯函数重算（§4.4 `deriveRequirementTasks`），每次重算避免增量维护两处状态。

---

## 8. 常用内部工具

```ts
// 两个：常用工具（computed抽离防重复）
// - today(): 本地时区当前 YYYY-MM-DD，状态机所有副作用（§3.1–3.3）共用，
//   前端 ECharts 显示也用它（06-web §7 任务趋势折线）
// - maxDate(a, b): 字典序比较 ISO 日期（"2026-12-01" > "2026-11-30"），
//   overdue 判定与 stats 用（§2.4，05-server §5.5）
// - isPast(date): date < today（ overdue 语义：未完成任务 due < 今天）
// - normalizePath(p): 统一 `\` → `/`，跨平台比较（obsidian 路径）
```

> **实现注**：`today()` 用 `new Date().toLocaleDateString("sv-SE")`（浏览器/Node 通用确定性格式）或 `toISOString().slice(0, 10)`（本地 vs UTC：任务 due 在工作时区，以本地为准）。
