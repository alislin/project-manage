import type { VaultIndex } from "../types.js";

/** 记录 → 文件位置（absPath + relPath，02-core §5.2.10 byPath 以 absPath 为键） */
export interface RecordLocation {
  absPath: string;
  relPath: string;
}

/**
 * 建立「索引记录对象 → 文件位置」映射（services/check、services/inbox 共用）：
 * - relPath 来自 scan.entries（POSIX 风格，02-core §2.2 FileEntry）
 * - absPath 来自 byPath 键（02-core §5.2.10）
 * 记录对象与 byPath 值是同一引用（indexer insertRecord），身份匹配成立。
 */
export function locateRecords(index: VaultIndex): Map<object, RecordLocation> {
  const relByAbs = new Map<string, string>();
  for (const e of index.scan.entries) relByAbs.set(e.absPath, e.relPath);
  const out = new Map<object, RecordLocation>();
  for (const [absPath, rec] of index.byPath) {
    const relPath = relByAbs.get(absPath);
    if (relPath !== undefined) out.set(rec, { absPath, relPath });
  }
  return out;
}
