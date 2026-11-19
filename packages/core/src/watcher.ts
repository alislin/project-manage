import fs from "node:fs";
import chokidar from "chokidar";
import { isSelfWrite } from "./writer";
import { normalizePath, type Config } from "./types";

/** 监听事件（design §4.5：onChange 增加或变化，onUnlink 删除） */
export interface WatcherEvents {
  /** 增加或变化（paths 递归已有的 .md 文件）；路径为 POSIX 风格相对 pmRoot 的绝对路径 */
  onChange(paths: string[]): void;
  /** 删除 */
  onUnlink(paths: string[]): void;
}

export interface StartOptions {
  /** 防抖窗口（默认 250，design §4.5/§5.5） */
  debounceMs?: number;
  /** @default true */
  ignoreSelfWrites?: boolean;
}

function statMtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return Number.NaN;
  }
}

/**
 * 监听与防抖（design §4.5/§5.3）：
 * - chokidar 监听 config.pmRoot
 * - 防抖合并：onChange 合并为唯一路径集（Set + 定时器）
 * - ignoreSelfWrites：isSelfWrite 过滤（design §5.3，mtime 匹配跳过）
 */
export function startWatcher(config: Config, events: WatcherEvents, opts: StartOptions = {}): { stop(): void } {
  const debounceMs = opts.debounceMs ?? 250;
  const ignoreSelfWrites = opts.ignoreSelfWrites ?? true;
  const changePaths = new Set<string>();
  const unlinkPaths = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const watcher = chokidar.watch(config.pmRoot, { ignoreInitial: true });

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (changePaths.size > 0) {
        const paths = [...changePaths].sort();
        changePaths.clear();
        events.onChange(paths);
      }
      if (unlinkPaths.size > 0) {
        const paths = [...unlinkPaths].sort();
        unlinkPaths.clear();
        events.onUnlink(paths);
      }
    }, debounceMs);
  };

  // design §5.3：on(all) → events.onChange / onUnlink 之前先 isSelfWrite 过滤
  watcher.on("all", (event, p) => {
    if (ignoreSelfWrites && isSelfWrite(p, statMtime(p))) return;
    if (event === "unlink" || event === "unlinkDir") {
      unlinkPaths.add(normalizePath(p));
      flush();
    } else if (event === "add" || event === "change") {
      changePaths.add(normalizePath(p));
      flush();
    }
  });

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      void watcher.close();
    },
  };
}
