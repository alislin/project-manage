// 公共导出（design §2 核心类型定义 + 模块职责）
export { ok, err, today, maxDate, isBefore, isPast, normalizePath } from "./types";
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
  SearchResult,
  SearchHit,
  WriteConflict,
  AppResult,
  AppError,
} from "./types";
export { loadConfig, ZConfig, RAW_CONFIG_DEFAULTS } from "./config";
export { scanTree, classifyFile, type Classification } from "./scanner";
export { parseFile, type ParseResult } from "./parser";
export { buildIndex, reindexFile, deriveRequirementTasks, parseWikiLinks } from "./indexer";
export { moveStatus, isValidTransition, moveLocks } from "./services/status";
export { deriveStats } from "./services/stats";
export { allocateId } from "./services/seq";
export { atomicWriteFile, registerSelfWrite, isSelfWrite, type WriteOpts, type WriteResult } from "./writer";
export { startWatcher, type WatcherEvents, type StartOptions } from "./watcher";

// 占位：CORE_NAME 与 CORE_VERSION 按 docs/design/01（包名）与 docs/design/02（版本）确认后填充。
export const CORE_NAME = "pm-core";
export const CORE_VERSION = "0.0.0";
