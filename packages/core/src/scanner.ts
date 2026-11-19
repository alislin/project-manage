import fs from "node:fs";
import path from "node:path";
import { isSelfWrite } from "./writer.js";
import { normalizePath, type FileEntry, type VaultScan } from "./types.js";

/** 文件分类结果（design §4.4 表 + 用户要求 classifyFile 含 inbox/archive 排除） */
export type Classification =
  | "project"
  | "requirement"
  | "task"
  | "inbox"
  /** inbox/archive/ 下的文件：归档产物不进索引、不算 unnumbered（design §4.4 表 + design §5.2.7） */
  | "archived"
  | "unnumbered"
  | "broken";

const KNOWN_TYPES = new Set(["project", "requirement", "task", "inbox"]);

/**
 * 递归扫描（design §4.2）：
 * - 输入：config.pmRoot（扫描以 PM 为根）
 * - 输出：排序后的 FileEntry[]（按 relPath 升序，确定性）+ byPath（design §2.3：冲突时以较大 mtimeMs 为准）
 * - 跳过：隐藏文件/目录（名以 "."/"_" 开头，如 .obsidian）与 @pm 自忽略条目（design §4.2, design §5.3）
 */
export function scanTree(dir: string): VaultScan {
  const entries: FileEntry[] = [];
  const walk = (d: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // 不可读/不存在 → 空扫描结果
    }
    for (const e of dirents) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue; // 隐藏文件/目录（.obsidian、_config.md）
      const absPath = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!e.isFile()) continue;
      const st = fs.statSync(absPath);
      const relPath = normalizePath(path.relative(dir, absPath));
      if (isSelfWrite(absPath, st.mtimeMs)) continue; // @pm 自忽略（design §4.2, design §5.3）
      entries.push({ absPath, relPath, mtimeMs: st.mtimeMs, size: st.size });
    }
  };
  walk(dir);
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const byPath = new Map<string, FileEntry>();
  for (const e of entries) {
    const existing = byPath.get(e.relPath);
    if (!existing || e.mtimeMs > existing.mtimeMs) byPath.set(e.relPath, e); // design §2.3：冲突时以较大 mtimeMs 为准
  }
  return { entries, byPath };
}

/**
 * 分类规则（design §4.4 表，design §5.2.7）：
 * - project.md | type === "project" 且路径 == projects/<slug>/project.md，id == slug → "project"
 * - requirement | type === "requirement" 且路径在 projects/<slug>/requirements/ 下 → "requirement"
 * - task | type === "task" 且路径在 projects/<slug>/tasks/ 下 → "task"
 * - inbox | type === "inbox" 且路径在 inbox/ 根（inbox/archive/ 排除，归档产物不进索引）→ "inbox"
 * - 归档排除 | 路径在 inbox/archive/ 下 → "archived"（不进索引、不算 unnumbered，design §5.2.7）
 * - 跨区域类型 | 路径在 projects 下，但 type 不符（或 id 与目录名不一致）→ "broken"（reason: id-path-mismatch）
 * - 未识别 | md 文件（递归）但无 frontmatter 或 type 不是上述字魄 → "unnumbered"（或 broken reason: unknown-type）
 * - 解析失败 | frontmatter 非法 → "broken"（reason: parse，design §4.3/§5.2）
 *
 * isDirectoryFile = 路径 == projects/<slug>/project.md（design §4.4 第一行判定依据）。
 */
export function classifyFile(relPath: string, data: unknown, isDirectoryFile: boolean): Classification {
  const p = normalizePath(relPath);
  const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type : undefined;

  // 归档排除（design §4.4 表 + design §5.2.7）
  if (p.startsWith("inbox/archive/")) return "archived";

  if (isDirectoryFile) {
    // project.md：type === "project" && id === 目录 slug（design §4.4, design §5.2.4）
    const slug = /^projects\/([^/]+)\/project\.md$/.exec(p)?.[1] ?? "";
    if (type === "project" && typeof rec.id === "string" && rec.id === slug) return "project";
    return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken"; // id 不符/类型不符 → broken(id-path-mismatch)
  }
  if (/^projects\/[^/]+\/requirements\//.test(p)) {
    if (type === "requirement") return "requirement";
    return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken"; // 跨区域类型 → broken
  }
  if (/^projects\/[^/]+\/tasks\//.test(p)) {
    if (type === "task") return "task";
    return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken"; // 跨区域类型 → broken
  }
  if (/^projects\/[^/]+\//.test(p)) {
    // projects/<slug>/下其他路径（journal/ 等）：跨区域类型 → broken（design §4.4）
    return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken";
  }
  if (/^inbox\/[^/]+\.md$/.test(p)) {
    if (type === "inbox") return "inbox";
    return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken"; // 跨区域类型 → broken
  }
  // 非 projects/inbox 路径：type 不符 → broken；无 frontmatter/未知类型 → unnumbered
  return type === undefined || !KNOWN_TYPES.has(type) ? "unnumbered" : "broken";
}
