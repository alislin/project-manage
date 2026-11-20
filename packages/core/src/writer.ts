import fs from "node:fs";
import path from "node:path";
import { E_CONFLICT, E_IO } from "./errors.js";
import { normalizePath, type AppError, type FileEntry, type WriteConflict } from "./types.js";

/**
 * 写入选项（design §4.6/§6.1）：
 * - expectedMtimeMs：预期当前 mtimeMs（02-core §4.6）
 * - pmRoot：索引根，用于生成 WriteResult.written.relPath（design §2.2）
 */
export interface WriteOpts {
  expectedMtimeMs?: number;
  pmRoot?: string;
  /**
   * @internal 仅供测试注入：在「预检与 rename 之间」的窗口内模拟外部写入，
   * 用于覆盖 rename 前 mtime 复查分支（review-m1 round1 major#1）。生产代码不得传入。
   */
  _injectExternalWrite?: () => void;
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
 * - rename 前 mtime 复查（收窄 race 窗，02-core §4.6 "rename 前再次 stat 与 expected 比对"）：
 *   检测到并发修改时中止覆盖（外部变更得以保留）；复查先于 registerSelfWrite，
 *   避免登记后 isSelfWrite 恒真导致复查分支永不触发（review-m1 round1 major#1）。
 * - rename 成功后：writer 向 writer/self-ignore 注册（design §5.3）。
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

  // 2) 写临时文件（同目录，确保 rename 同文件系统）+ rename（design §6.1）；
  //    try/finally 保证失败路径清理残留临时文件（review-m1 round1 minor）
  const tmpName = `.${name}.tmp-${process.pid}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const tmpPath = path.join(dir, tmpName);
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, content, "utf8");

    // 测试注入点：模拟外部写入落在「预检与 rename 之间」的窗口（review-m1 round1 major#1）
    opts._injectExternalWrite?.();

    // 3) rename 前 mtime 复查（收窄 race 窗；再次 stat + selfWrite 过滤自写，design §6.1 注）。
    //    仅当预检时文件已存在才复查（新建文件场景无需复查）。
    if (opts.expectedMtimeMs !== undefined && currentMtimeMs !== undefined) {
      let deletedInWindow = false;
      let recheckMtimeMs = 0;
      try {
        recheckMtimeMs = fs.statSync(absPath).mtimeMs;
      } catch {
        deletedInWindow = true; // 预检时存在、rename 前消失 → 外部并发删除
      }
      if (
        deletedInWindow ||
        (Math.abs(recheckMtimeMs - opts.expectedMtimeMs) > MTIME_EPSILON_MS &&
          !isSelfWrite(absPath, recheckMtimeMs))
      ) {
        const error: AppError & WriteConflict = {
          code: E_CONFLICT as "E_CONFLICT",
          message: "rename 前复查检测到文件并发修改，已中止写入，请刷新后重试",
          file: absPath,
          path: absPath,
          expectedMtimeMs: opts.expectedMtimeMs,
          ...(deletedInWindow ? {} : { currentMtimeMs: recheckMtimeMs }),
          httpStatus: 409,
        };
        return { ok: false, error };
      }
    }

    // 4) rename（design §6.1）；异常映射为 E_IO 结构化错误而非裸抛（review-m1 round1 minor）
    try {
      fs.renameSync(tmpPath, absPath);
      renamed = true;
    } catch (e) {
      const error: AppError = {
        code: E_IO,
        message: `重命名临时文件失败: ${e instanceof Error ? e.message : String(e)}`,
        file: absPath,
        httpStatus: 500,
      };
      return { ok: false, error };
    }
  } finally {
    // 未完成 rename 时清理残留临时文件（写入失败/复查冲突/rename 失败路径；rename 成功后 tmp 已不存在）
    if (!renamed) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* tmp 不存在：忽略 */
      }
    }
  }

  // 5) rename 成功后登记自写（design §5.3；登记晚于复查，避免过滤掉真实冲突）
  const afterMtimeMs = fs.statSync(absPath).mtimeMs;
  registerSelfWrite(absPath, afterMtimeMs);

  const entry: FileEntry = {
    absPath,
    relPath: normalizePath(path.relative(opts.pmRoot ?? process.cwd(), absPath)),
    mtimeMs: afterMtimeMs,
    size: Buffer.byteLength(content, "utf8"), // 字节数而非 UTF-16 码元数（review-m1 round1 minor）
  };
  return { ok: true, path: absPath, written: entry };
}
