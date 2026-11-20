// 公共导出（design §2 核心类型定义 + 模块职责）
export { ok, err, today, maxDate, isBefore, isPast, normalizePath } from "./types.js";
export type {
  Config,
  FileEntry,
  VaultScan,
  BrokenFile,
  UnnumberedFile,
  VaultIndex,
  TaskStats,
  Progress,
  Stats,
  MoveResult,
  MoveOutcome,
  ValidateResult,
  CheckIssueCode,
  CheckIssue,
  CheckResult,
  SearchResult,
  SearchHit,
  InboxListItem,
  InboxListResult,
  InboxArchiveResult,
  WriteConflict,
  AppResult,
  AppError,
} from "./types.js";
export { loadConfig, ZConfig, RAW_CONFIG_DEFAULTS } from "./config.js";
// 纯新增导出（S5 server 阶段消费）：schema 校验器与错误码常量（02-core §5 / §3.1）
export { IsoDate, Slug, ProjectStatus, ReqStatus, TaskStatus, Priority } from "./schema.js";
export type { Project, Requirement, Task, InboxEntry } from "./schema.js";
export {
  E_CONFIG_INVALID,
  E_USAGE,
  E_NOT_FOUND,
  E_VALIDATION,
  E_INVALID_TRANSITION,
  E_CONFLICT,
  E_SEQ_EXHAUSTED,
  E_IO,
} from "./errors.js";
export { scanTree, classifyFile, type Classification } from "./scanner.js";
export { parseFile, type ParseResult } from "./parser.js";
export { buildIndex, reindexFile, deriveRequirementTasks, parseWikiLinks } from "./indexer.js";
export { moveStatus, isValidTransition, moveLocks, runExclusive } from "./services/status.js";
export { deriveStats } from "./services/stats.js";
export { search } from "./services/search.js";
export { runCheck } from "./services/check.js";
export { listInbox, archiveInboxEntry } from "./services/inbox.js";
export { allocateId } from "./services/seq.js";
export { atomicWriteFile, registerSelfWrite, isSelfWrite, type WriteOpts, type WriteResult } from "./writer.js";
export { startWatcher, type WatcherEvents, type StartOptions } from "./watcher.js";

// 占位：CORE_NAME 与 CORE_VERSION 按 docs/design/01（包名）与 docs/design/02（版本）确认后填充。
export const CORE_NAME = "pm-core";
export const CORE_VERSION = "0.0.0";
