import fs from "node:fs";
import path from "node:path";
import { normalizePath, reindexFile, startWatcher, type Config, type FileEntry, type VaultIndex, type WatcherEvents } from "@pm/core";
import { SseHub } from "./sse.js";

/** server 运行态（05-server §5.4 第 4 条：Server 持有 VaultIndex 唯一实例） */
export interface ServerState {
  config: Config;
  index: VaultIndex;
  hub: SseHub;
  watcher: { stop(): void };
  /** 静态托管目录（apps/web/dist 不存在时为 undefined，05-server §7.1） */
  webDist?: string;
}

/** absPath → 相对 pmRoot 的 POSIX 路径（SSE changes 载荷用，05-server §5.2） */
export function relPathOf(index: VaultIndex, absPath: string): string {
  return normalizePath(path.relative(index.config.pmRoot, absPath));
}

function compareRelPath(a: FileEntry, b: FileEntry): number {
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

/**
 * 同步 scan 条目（server 侧索引维护）：写入/外部变更后更新 FileEntry 的 mtimeMs/size，
 * 新文件追加（保持 relPath 升序，scanner §4.2 不变量）。此后 GET 的 mtimeMs 与
 * moveStatus 的 expectedMtimeMs 基准（scan entry）保持新鲜。
 */
export function syncScanEntry(index: VaultIndex, absPath: string): void {
  const relPath = relPathOf(index, absPath);
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
export function removeScanEntry(index: VaultIndex, absPath: string): void {
  const i = index.scan.entries.findIndex((e) => e.absPath === absPath);
  if (i >= 0) {
    const [entry] = index.scan.entries.splice(i, 1);
    index.scan.byPath.delete(entry.relPath);
  }
}

/**
 * chokidar 接线（05-server §5.4）：
 * - onChange：先查 byPath 分类 op（add/change）→ reindexFile → 同步 scan 条目 → 推送 SSE；
 * - onUnlink：reindexFile 删除分支 → 移除 scan 条目 → 推送 unlink；
 * - 自写过滤与防抖沿用 core（startWatcher §5.3/§5.5，本进程写入不触发推送）。
 * chokidar 路径在 Windows 为 POSIX 风格绝对路径，统一 path.normalize 后与索引键对齐。
 */
export function wireWatcher(state: Omit<ServerState, "watcher">, debounceMs: number): { stop(): void } {
  const events: WatcherEvents = {
    onChange(paths) {
      for (const p of paths) {
        const absPath = path.normalize(p);
        const op = state.index.byPath.has(absPath) ? "change" : "add";
        reindexFile(state.index, absPath);
        syncScanEntry(state.index, absPath);
        state.hub.recordChange(op, relPathOf(state.index, absPath));
      }
    },
    onUnlink(paths) {
      for (const p of paths) {
        const absPath = path.normalize(p);
        reindexFile(state.index, absPath); // absPath 不存在 → 删除分支（02-core §5.4）
        removeScanEntry(state.index, absPath);
        state.hub.recordChange("unlink", relPathOf(state.index, absPath));
      }
    },
  };
  return startWatcher(state.config, events, { debounceMs });
}
