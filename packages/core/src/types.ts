import type { Project, Requirement, Task, InboxEntry, ProjectStatus, ReqStatus, TaskStatus } from "./schema.js";

// ===== 2.1 Config =====
/** `pm.config.json` 结构（plan §7：{ vaultPath, pmRoot }，详设补充） */
export interface Config {
  /** Obsidian Vault 绝对路径 */
  vaultPath: string;
  /** PM 根目录（默认 `<vaultPath>/PM`，02-core §4.1 RAW_CONFIG_DEFAULTS） */
  pmRoot: string;
  /** 编号/任务维护的默认操作者（代理视角）；非必填 */
  defaultAuthor?: string;
}

// ===== 2.2 扫描 =====
export interface FileEntry {
  /** 绝对路径 */
  absPath: string;
  /** 相对 pmRoot 的 POSIX 风格相对路径 */
  relPath: string;
  /** fs.statSync().mtimeMs */
  mtimeMs: number;
  size: number;
}

export interface VaultScan {
  /** 相对 pmRoot 存（便于 watcher 事件比对，02-core §2.3） */
  entries: FileEntry[];
  byPath: Map<string, FileEntry>;
}

// ===== 2.3 数据与索引 =====
export interface BrokenFile {
  file: FileEntry;
  /** ZodIssue 缩略（02-core §2.3） */
  issues: Array<{ path: string; code: string; message: string }>;
  reason: "parse" | "id-path-mismatch" | "unknown-type";
}

export interface UnnumberedFile {
  file: FileEntry;
}

export interface VaultIndex {
  config: Config;
  scan: VaultScan;
  /** 按 slug 升序 */
  projects: Project[];
  /** 按 id 升序 */
  requirements: Requirement[];
  requirementsByProject: Map<string, Requirement[]>;
  /** 按 id 升序 */
  tasks: Task[];
  /** 按 created 倒序（UI 需求，01-数据规范 §7.3 步骤 2） */
  inboxEntries: InboxEntry[];
  /** 已排序，按路径 */
  unnumbered: UnnumberedFile[];
  /** 待修复清单 */
  broken: BrokenFile[];
  /** 反链聚合：REQ id → [TASK id]（01-数据规范 §6.3） */
  requirementTasks: Map<string, string[]>;
  /** relPath → 记录索引（用于 watcher 增量，02-core §2.3） */
  byPath: Map<string, Project | Requirement | Task | InboxEntry | BrokenFile>;
  /** ISO 时间（诊断） */
  builtAt: string;
}

// ===== 2.4 统计（02-core §2.4，plan §4.3 第 2 条；一切从 VaultIndex 计算） =====
export interface TaskStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  /** status ∈ {todo, doing} && due < today（07-workflow §1 日期约定） */
  overdue: number;
  /** 在时间线上未超期的任务数：todo/doing 且 due ≥ today（02-core §8 isPast/overdue） */
  onTrack: number;
}

export interface Progress {
  /** done / total（0 个任务为 0） */
  completedRate: number;
  overdueCount: number;
  totalTasks: number;
  doneTasks: number;
  cancelledTasks: number;
  onTrack: number;
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

/** moveStatus 返回值（design §4.7）：成功返回 MoveOutcome，失败返回 AppError */
export type MoveOutcome =
  | {
      ok: true;
      /** 流转实际写入（rename 后的文件快照，design §4.7） */
      moved: boolean;
      from: ReqStatus | TaskStatus | ProjectStatus;
      to: string;
      /** 副作用：状态流转副作用 updated=today 是否设置（design §4.7, 01-数据规范 §3.1–3.3） */
      updated: boolean;
      /** 副作用：completed=today 是否设置（仅 task 的 todo→done / doing→done，01-数据规范 §3.3） */
      completedSet: boolean;
      file: FileEntry;
      newStatuses: Array<{ id: string; status: string }>;
    }
  | { ok: false; error: AppError };

export interface ValidateResult {
  ok: boolean;
  errors: Array<{
    file: string;
    field?: string;
    code: string;
    message: string;
  }>;
  checkedFiles: number;
}

// ===== 2.5b 一致性检查（03-cli §6.2/§6.3） =====
export type CheckIssueCode =
  | "dangling-wiki"
  | "invalid-link-target"
  | "id-conflict"
  | "date-inverted"
  | "invalid-frontmatter";

export interface CheckIssue {
  /** 绝对路径（03-cli §6.3） */
  file: string;
  /** 具体字段（可选，如 requirement/updated/due/id） */
  field?: string;
  code: CheckIssueCode;
  message: string;
}

export interface CheckResult {
  /** issues 为空 → true（03-cli §6.3） */
  ok: boolean;
  issues: CheckIssue[];
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

// ===== 2.6b inbox 服务（03-cli §7.2/§7.4，01-数据规范 §7） =====
export interface InboxListItem {
  /** 如 INBOX-inbox-001 */
  id: string;
  /** YYYY-MM-DD */
  created: string;
  slug?: string;
  tags: string[];
  source?: string;
  /** 相对 PM 根的 POSIX 路径，如 "inbox/2026-11-19-idea.md" */
  file: string;
  /** 正文第一行（首个非空行；空则空串，03-cli §7.2） */
  bodyFirstLine: string;
  /** 未归档 vs 已归档（03-cli §7.2 status，01-数据规范 §7.4） */
  status: "active" | "archived";
}

export interface InboxListResult {
  /** 按 created 降序（01-数据规范 §7.3 步骤 2） */
  entries: InboxListItem[];
  count: number;
}

export interface InboxArchiveResult {
  archived: {
    id: string;
    /** 原绝对路径（03-cli §7.4） */
    from: string;
    /** 新绝对路径（PM/inbox/archive/<name>） */
    to: string;
    archivedDate: string;
  };
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
  /** 可选：HTTP 状态码映射建议（02-core §3.4） */
  httpStatus?: number;
  /** 可选：文件与字段精确位置（§3.4） */
  file?: string;
  field?: string;
  /** 可选：详细 issues（E_VALIDATION / E_INVALID_TRANSITION） */
  issues?: Array<{ file: string; field: string; code: string; message: string }>;
}

/** 所有核心对外函数一律返回 AppResult（02-core §2.8，理由：统一错误模型） */
export function ok<T>(value: T): AppResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: AppError): AppResult<T> {
  return { ok: false, error };
}

// ===== 2.8 全局工具 =====
/** YYYY-MM-DD（本地时区，07-workflow §1 日期约定） */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 字典序比较 ISO 日期（"2026-12-01" > "2026-11-30"，02-core §8） */
export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function isBefore(a: string, b: string): boolean {
  return a < b;
}

/** overdue 语义：date < today（02-core §2.4 / §8） */
export function isPast(date: string): boolean {
  return date < today();
}

/** 统一分隔符（POSIX 风格，02-core §8） */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
