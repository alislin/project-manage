import fs from "node:fs";
import path from "node:path";
import { E_CONFLICT } from "./errors.js";
import { normalizePath, type AppError, type FileEntry, type WriteConflict } from "./types.js";

/**
 * 写入选项（design §4.6/§6.1）：
 * - expectedMtimeMs：预期当前 mtimeMs（02-core §4.6）
 * - pmRoot：索引根，用于生成 WriteResult.written.relPath（design §2.2）
 */
export interface WriteOpts {
  expectedMtimeMs?: number;
  pmRoot?: string;
}

export type WriteResult =
  | { ok: true; path: string; written: FileEntry }
  | { ok: false; error: AppError };

// ---------------------------------------------------------------------------
// @pm 自写缓存（design §5.3）
// ---------------------------------------------------------------------------

/** @pm 自写缓存：absPath → mtimeMs；最多保留 64 条 FIFO 淘汰（design §5.3） */
const selfWriteCache = new Map<string, number>();
const SELF_WRITE_CACHE_MAX = 64;

/** 登记一次本进程写入（最多保留 64 条，FIFO 淘汰）（design §5.3） */
export function registerSelfWrite(absPath: string, mtimeMs: number): void {
  // 删除旧条目后重新 set，刷新 FIFO 顺序
  selfWriteCache.delete(absPath);
  selfWriteCache.set(absPath, mtimeMs);
  while (selfWriteCache.size > SELF_WRITE_CACHE_MAX) {
    const oldest = selfWriteCache.keys().next();
    if (oldest.done) break;
    selfWriteCache.delete(oldest.value);
  }
}

/** watcher 事件到达时：相同 path + mtime → 返回 true（忽略）（design §5.3） */
export function isSelfWrite(absPath: string, mtimeMs: number): boolean {
  return selfWriteCache.get(absPath) === mtimeMs;
}

// ---------------------------------------------------------------------------
// 原子写（design §6.1）
// ---------------------------------------------------------------------------

let counter = 0;
/** mtime 比较 epsilon：文件系统时钟/缓存误差（design §6.1 注） */
const MTIME_EPSILON_MS = 1;

/**
 * 原子写：临时文件（同目录，确保 rename 同文件系统）+ writeFileSync + fs.renameSync（design §6.1）。
 * - 写前 mtime 冲突检测：expectedMtimeMs 非空且当前 stat.mtimeMs 不匹配 → 返回 { ok:false, E_CONFLICT }
 *   （expectedMtimeMs/currentMtimeMs 写入 error，design §3.3 示例）。
 * - 写后再次复查（收窄 race 窗；再次 stat + selfWrite 过滤自写，design §6.1 注）。
 * - 写后：writer 向 writer/self-ignore 注册（design §5.3）。
 */
export function atomicWriteFile(absPath: string, content: string, opts: WriteOpts = {}): WriteResult {
  const dir = path.dirname(absPath);
  const name = path.basename(absPath);

  // 1) mtime 预检（design §6.1）
  let currentMtimeMs: number | undefined;
  try {
    currentMtimeMs = fs.statSync(absPath).mtimeMs;
  } catch {
    /* 文件不存在：跳过预检 */
  }
  if (
    opts.expectedMtimeMs !== undefined &&
    currentMtimeMs !== undefined &&
    Math.abs(currentMtimeMs - opts.expectedMtimeMs) > MTIME_EPSILON_MS
  ) {
    const error: AppError & WriteConflict = {
      code: E_CONFLICT as "E_CONFLICT",
      message: "文件已被外部修改，请刷新后重试",
      file: absPath,
      path: absPath,
      expectedMtimeMs: opts.expectedMtimeMs,
      currentMtimeMs,
      httpStatus: 409,
    };
    return { ok: false, error };
  }

  // 2) 写临时文件（同目录，确保 rename 同文件系统）+ rename（design §6.1）
  const tmpName = `.${name}.tmp-${process.pid}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const tmpPath = path.join(dir, tmpName);
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, absPath);

  // 3) 写后登记自写 + 复查（收窄 race 窗）
  const afterMtimeMs = fs.statSync(absPath).mtimeMs;
  registerSelfWrite(absPath, afterMtimeMs);
  if (
    opts.expectedMtimeMs !== undefined &&
    Math.abs(afterMtimeMs - opts.expectedMtimeMs) > MTIME_EPSILON_MS &&
    !isSelfWrite(absPath, afterMtimeMs)
  ) {
    const error: AppError & WriteConflict = {
      code: E_CONFLICT as "E_CONFLICT",
      message: "写入后检测到文件仍有并发修改",
      file: absPath,
      path: absPath,
      expectedMtimeMs: opts.expectedMtimeMs,
      httpStatus: 409,
    };
    return { ok: false, error };
  }

  const entry: FileEntry = {
    absPath,
    relPath: normalizePath(path.relative(opts.pmRoot ?? process.cwd(), absPath)),
    mtimeMs: afterMtimeMs,
    size: content.length,
  };
  return { ok: true, path: absPath, written: entry };
}
