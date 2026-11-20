import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { E_IO, E_NOT_FOUND } from "../errors.js";
import { reindexFile } from "../indexer.js";
import { atomicWriteFile } from "../writer.js";
import { locateRecords } from "./locate.js";
import { err, ok, today, type AppResult, type InboxArchiveResult, type InboxListItem, type InboxListResult, type VaultIndex } from "../types.js";

/**
 * 收集箱列表（`pm inbox list/process` 共用实现，03-cli §7.2 + 01-数据规范 §7.3 步骤 2）：
 * - 默认只列未归档条目（`includeArchived` 供扩展）；index.inboxEntries 已按 created 倒序（02-core §7）；
 * - file = 相对 PM 根的 POSIX 路径（03-cli §7.2）；bodyFirstLine = 正文首个非空行（空则空串）。
 */
export function listInbox(index: VaultIndex, opts: { includeArchived?: boolean } = {}): InboxListResult {
  const loc = locateRecords(index);
  const entries: InboxListItem[] = [];
  for (const e of index.inboxEntries) {
    const archived = e.archived !== null;
    if (archived && !opts.includeArchived) continue; // 03-cli §7.2：list 列出未归档条目
    const l = loc.get(e);
    entries.push({
      id: e.id,
      created: e.created,
      slug: e.slug,
      tags: [...e.tags],
      source: e.source,
      file: l?.relPath ?? "",
      bodyFirstLine: l ? bodyFirstLine(l.absPath) : "",
      status: archived ? "archived" : "active",
    });
  }
  return { entries, count: entries.length };
}

/**
 * 归档条目（`pm inbox archive` 共用实现，03-cli §7.4 + 01-数据规范 §7.4）：
 * 1. 按 id 查找（未知/非法 id 一律 E_NOT_FOUND，TC-03-039/040：归档前先按 id 查找）
 * 2. frontmatter 置 `archived=<今天>` 并补齐缺失的 type/id（01-数据规范 §7.3 步骤 4），正文保留
 * 3. 移动到 `PM/inbox/archive/<原文件名>`（文件名保持原样，03-cli §7.4 to；原子写 + 自写登记）
 * 4. 删除原文件并同步索引（归档产物不入索引：01-数据规范 §7.5 classifyFile "archived" 排除）
 */
export function archiveInboxEntry(index: VaultIndex, id: string): AppResult<InboxArchiveResult> {
  const entry = index.inboxEntries.find((e) => e.id === id);
  if (!entry) {
    return err({ code: E_NOT_FOUND, message: `INBOX 条目 ${id} 不存在（03-cli §7.4，TC-03-039/040）` });
  }
  const loc = locateRecords(index).get(entry);
  if (!loc) {
    return err({ code: E_NOT_FOUND, message: `INBOX 条目 ${id} 的源文件不在扫描结果中（02-core §5.2.10）` });
  }
  const fromAbs = loc.absPath;
  const archiveDir = path.join(index.config.pmRoot, "inbox", "archive");
  const toAbs = path.join(archiveDir, path.basename(fromAbs)); // 文件名保持原样（03-cli §7.4）

  let raw: string;
  try {
    raw = fs.readFileSync(fromAbs, "utf8");
  } catch (e) {
    return err({ code: E_IO, message: `读取 ${fromAbs} 失败: ${e instanceof Error ? e.message : String(e)}`, file: fromAbs, httpStatus: 500 });
  }

  // frontmatter：archived=<今天>；缺失 type/id 补齐（01-数据规范 §7.3 步骤 4），正文不动
  const matterFile = matter(raw);
  const newData: Record<string, unknown> = { ...matterFile.data, archived: today() };
  if (newData.type === undefined) newData.type = "inbox";
  if (newData.id === undefined) newData.id = entry.id;
  const content = matter.stringify(matterFile, newData);

  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch (e) {
    return err({ code: E_IO, message: `创建归档目录失败: ${e instanceof Error ? e.message : String(e)}`, file: archiveDir, httpStatus: 500 });
  }

  // 原子写归档文件（自写登记，02-core §6.1/§5.3），随后删除原文件完成"移动"
  const written = atomicWriteFile(toAbs, content, { pmRoot: index.config.pmRoot });
  if (!written.ok) return written;
  try {
    fs.unlinkSync(fromAbs);
  } catch (e) {
    return err({ code: E_IO, message: `删除原文件失败: ${e instanceof Error ? e.message : String(e)}`, file: fromAbs, httpStatus: 500 });
  }

  // 同步索引：原条目移除（02-core §5.4 删除分支）；归档产物不进 scan/索引（01-数据规范 §7.5）
  reindexFile(index, fromAbs);
  const si = index.scan.entries.findIndex((x) => x.absPath === fromAbs);
  if (si >= 0) index.scan.entries.splice(si, 1);
  index.scan.byPath.delete(loc.relPath);

  return ok({ archived: { id: entry.id, from: fromAbs, to: toAbs, archivedDate: today() } });
}

/** 正文首个非空行（03-cli §7.2 bodyFirstLine「空则空串」；不可读降级为空串） */
function bodyFirstLine(absPath: string): string {
  try {
    const body = matter(fs.readFileSync(absPath, "utf8")).content ?? "";
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length > 0) return t;
    }
    return "";
  } catch {
    return "";
  }
}
