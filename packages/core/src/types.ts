import type { Project, Requirement, Task, InboxEntry, ProjectStatus, ReqStatus, TaskStatus } from "./schema";

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
