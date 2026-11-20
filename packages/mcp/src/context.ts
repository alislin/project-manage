import fs from "node:fs";
import path from "node:path";
import { buildIndex, loadConfig, normalizePath, reindexFile, type AppError, type Config, type FileEntry, type VaultIndex } from "@pm/core";

/**
 * 工具运行上下文（04-mcp §1.2 全局运行环境）：
 * - 工具先 loadConfig()（缺失/非法 → E_CONFIG_INVALID），再 buildIndex()；
 * - MCP server 是长驻进程：同一工程根的 Config/VaultIndex 全程唯一实例（05-server §5.4 第 4 条同策略），
 *   每次 openContext 做增量重同步（外部变更 → reindexFile；比 chokidar 防抖无竞态，确定性可见）。
 * - 自写文件（create/move/archive）写后即时 reindexFile + 同步 scan 条目，resync 不依赖 isSelfWrite 过滤。
 */
export interface ToolContext {
  /** 工程根（pm.config.json 所在目录；--root 启动参数指定，缺省 = cwd，03-cli §1.1） */
  root?: string;
}

export interface OpenContext {
  config: Config;
  index: VaultIndex;
}

type OpenResult = { ok: true; value: OpenContext } | { ok: false; error: AppError };

// ---------------------------------------------------------------------------
// 进程级会话：resolved root → { config, index }（长驻进程唯一实例）
// ---------------------------------------------------------------------------

interface RootSession {
  config: Config;
  index: VaultIndex;
}

const sessions = new Map<string, RootSession>();

function resolveRootKey(root?: string): string {
  return path.resolve(root ?? process.cwd()).toLowerCase(); // Windows 大小写不敏感
}

/** loadConfig → buildIndex（04-mcp §1.2；TC-04-014：缺失/非法 pm.config.json → E_CONFIG_INVALID） */
export function openContext(ctx: ToolContext): OpenResult {
  const key = resolveRootKey(ctx.root);
  const existing = sessions.get(key);
  if (!existing) {
    const cfg = loadConfig(ctx.root);
    if (!cfg.ok) return cfg;
    const session: RootSession = { config: cfg.value, index: buildIndex(cfg.value) };
    sessions.set(key, session);
    return { ok: true, value: { config: session.config, index: session.index } };
  }
  resyncIndex(existing.index); // 外部写入/删除的增量同步（自写文件已在写后 reindex）
  return { ok: true, value: { config: existing.config, index: existing.index } };
}

/** 测试/收尾用：丢弃某工程根的会话（下次 openContext 重新 loadConfig + buildIndex） */
export function disposeSession(root?: string): void {
  sessions.delete(resolveRootKey(root));
}

// ---------------------------------------------------------------------------
// scan 条目同步（与 05-server state.ts 同策略）
// ---------------------------------------------------------------------------

function compareRelPath(a: FileEntry, b: FileEntry): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

/** 同步 scan 条目：写入/新增后更新 mtimeMs/size，新文件追加（relPath 升序，scanner §4.2 不变量） */
export function syncScanEntry(index: VaultIndex, absPath: string): void {
  const relPath = normalizePath(path.relative(index.config.pmRoot, absPath));
  let entry = index.scan.entries.find((e) => e.absPath === absPath);
  try {
    const st = fs.statSync(absPath);
    const mtimeMs = Math.round(st.mtimeMs); // S5R1 OBS-4：整数毫秒（core writer.statMtimeMs 同口径）
    if (entry) {
      entry.mtimeMs = mtimeMs;
      entry.size = st.size;
      entry.relPath = relPath;
    } else {
      entry = { absPath, relPath, mtimeMs, size: st.size };
      index.scan.entries.push(entry);
      index.scan.entries.sort(compareRelPath);
    }
    index.scan.byPath.set(relPath, entry);
  } catch {
    removeScanEntry(index, absPath);
  }
}

/** 移除 scan 条目（文件被删除时） */
function removeScanEntry(index: VaultIndex, absPath: string): void {
  const i = index.scan.entries.findIndex((e) => e.absPath === absPath);
  if (i >= 0) {
    const [entry] = index.scan.entries.splice(i, 1);
    index.scan.byPath.delete(entry.relPath);
  }
}

// ---------------------------------------------------------------------------
// 增量重同步（磁盘现状 ↔ index.scan 对账）：外部变更可见，且无自写过滤竞态
// ---------------------------------------------------------------------------

interface DiskFile {
  absPath: string;
  mtimeMs: number;
  size: number;
}

/** 磁盘 .md 之外的文件也入 scan（与 scanTree 同口径），仅跳过隐藏/`_` 前缀条目（scanner §4.2） */
function walkDisk(dir: string, pmRoot: string, out: Map<string, DiskFile>): void {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 不可读/不存在 → 空结果
  }
  for (const e of dirents) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const absPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDisk(absPath, pmRoot, out);
      continue;
    }
    if (!e.isFile()) continue;
    try {
      const st = fs.statSync(absPath);
      out.set(normalizePath(path.relative(pmRoot, absPath)), {
        absPath,
        mtimeMs: Math.round(st.mtimeMs),
        size: st.size,
      });
    } catch {
      /* stat 失败（并发删除）：跳过 */
    }
  }
}

export function resyncIndex(index: VaultIndex): void {
  const disk = new Map<string, DiskFile>();
  walkDisk(index.config.pmRoot, index.config.pmRoot, disk);

  // 1) 已删/已改：索引 scan 里有、磁盘上没有或已变化 → reindexFile（删除分支/重新解析）
  for (const entry of [...index.scan.entries]) {
    const cur = disk.get(entry.relPath);
    if (!cur) {
      reindexFile(index, entry.absPath); // absPath 不存在 → 删除分支（02-core §5.4）
      removeScanEntry(index, entry.absPath);
    } else if (cur.mtimeMs !== entry.mtimeMs || cur.size !== entry.size) {
      reindexFile(index, entry.absPath);
      syncScanEntry(index, entry.absPath);
    }
  }

  // 2) 新增：磁盘上有、scan 里没有 → 入 scan；.md 再 reindexFile（非 .md 与全量 buildIndex 同口径不入 byPath）
  for (const [relPath, cur] of disk) {
    if (index.scan.byPath.has(relPath)) continue;
    syncScanEntry(index, cur.absPath);
    if (relPath.endsWith(".md")) reindexFile(index, cur.absPath);
  }
}
