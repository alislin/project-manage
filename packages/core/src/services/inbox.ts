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
 * - file = 相对 PM 根的 POSIX 路径（03-cli §7.2）；bodyFirstLine = 正文首个非空行（空则空串）；
 * - P1-1（m2-acceptance §8）：无 frontmatter 或类型无法识别的 inbox 文件（index.unnumbered
 *   与 broken(reason:parse) 中位于 inbox/ 下的）以"未识别条目"形式追加列出
 *   （unrecognized: true，01-数据规范 §7.5/§7.3 步骤 1"可不带 frontmatter"），让代理能感知纯文本碎片。
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

  // P1-1：未识别条目（归档产物 classifyFile 直接排除，不会出现在 unnumbered/broken 中）
  const unrecognized: Array<{ item: InboxListItem; relPath: string }> = [];
  for (const u of index.unnumbered) {
    if (!u.file.relPath.startsWith("inbox/")) continue;
    unrecognized.push({
      item: {
        id: "",
        created: "",
        tags: [],
        file: u.file.relPath,
        bodyFirstLine: bodyFirstLine(u.file.absPath),
        status: "active",
        unrecognized: true,
        unrecognizedReason: "no-frontmatter",
      },
      relPath: u.file.relPath,
    });
  }
  for (const b of index.broken) {
    if (b.reason !== "parse" || !b.file.relPath.startsWith("inbox/")) continue;
    unrecognized.push({
      item: {
        id: "",
        created: "",
        tags: [],
        file: b.file.relPath,
        bodyFirstLine: bodyFirstLine(b.file.absPath),
        status: "active",
        unrecognized: true,
        unrecognizedReason: "invalid-frontmatter",
      },
      relPath: b.file.relPath,
    });
  }
  unrecognized.sort((a, b) => compareStr(a.relPath, b.relPath)); // 按路径稳定排序（与 unnumbered/broken 一致）
  for (const u of unrecognized) entries.push(u.item);

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

  // frontmatter：archived=<今天>；缺失 type/id 补齐（01-数据规范 §7.3 步骤 4），正文不动；
  // P2-1（m2-acceptance §8）：gray-matter 往返会把无引号 YAML 日期（解析为 Date）序列化成
  // ISO 时间戳（如 2026-11-20T00:00:00.000Z），写回前对已知日期字段还原为 YYYY-MM-DD 纯日期
  const matterFile = matter(raw);
  const newData: Record<string, unknown> = { ...restoreDateFields(matterFile.data), archived: today() };
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

/** 字典序比较（与 indexer.ts byId 内部实现同策略） */
function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// P2-1（m2-acceptance §8）：归档写回的日期格式还原
// ---------------------------------------------------------------------------

/**
 * 已知日期字段（01-数据规范 §1.4：created/updated/due/completed/archived）。
 * gray-matter 解析时 js-yaml 把无引号 YAML 日期解析为 Date，stringify 又序列化为
 * ISO 时间戳（`2026-11-20` → `2026-11-20T00:00:00.000Z`），与 §1.4 的 YYYY-MM-DD
 * 格式不一致。归档写回前把 Date 还原为 YYYY-MM-DD：js-yaml 对 date-only 按 UTC
 * 0 点解析，`toISOString().slice(0, 10)` 在任意时区都能精确还原原日期。
 */
const KNOWN_DATE_FIELDS = ["created", "updated", "due", "completed", "archived"] as const;

function restoreDateFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) };
  for (const k of KNOWN_DATE_FIELDS) {
    const v = out[k];
    if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
  }
  return out;
}
