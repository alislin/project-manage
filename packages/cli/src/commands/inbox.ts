import path from "node:path";
import {
  archiveInboxEntry,
  buildIndex,
  listInbox,
  loadConfig,
  normalizePath,
  type InboxListResult,
} from "@pm/core";
import { exitCodeFor, failWith, usageError } from "./helpers.js";

export interface InboxListArgs {
  /** `--json`：输出 { entries: [{id, created, slug?, tags, source?, file, bodyFirstLine, status}], count }（03-cli §7.2） */
  json?: boolean;
  /** 工程根（测试用；CLI 默认经全局 --root/cwd 解析，03-cli §1.1） */
  root?: string;
}

export interface InboxProcessArgs {
  /** `--limit <n>`（默认 20；非正数 → E_USAGE exit 2，03-cli §7.3） */
  limit?: number;
  /** `--all`：不限条数 */
  all?: boolean;
  /** `--dry-run`：只预览不写入（process 本身只读，语义上等价） */
  dryRun?: boolean;
  json?: boolean;
  root?: string;
}

export interface InboxArchiveArgs {
  /** `<id>`：如 INBOX-inbox-001（必填；未知/非法 id → E_NOT_FOUND exit 1，TC-03-039/040） */
  id?: string;
  /** `--json`：输出 { archived: {id, from, to, archivedDate} }（03-cli §7.4） */
  json?: boolean;
  root?: string;
}

/** 人类可读输出（03-cli §7.3 示例格式；P1-1：未识别条目带 ⚠ 提示，指引补 frontmatter） */
function renderList(result: InboxListResult): void {
  console.log(`📥 inbox 未处理（${result.count} 条）`);
  result.entries.forEach((e, i) => {
    if (e.unrecognized) {
      const reason = e.unrecognizedReason === "invalid-frontmatter" ? "frontmatter 无法识别" : "无 frontmatter";
      console.log(`  ${i + 1}. ⚠ 未识别碎片  file=${e.file}（${reason}，补齐 type/id/created 后可整理）`);
      console.log(`     首行: ${e.bodyFirstLine}`);
      return;
    }
    console.log(`  ${i + 1}. ${e.id}  ${e.created}  file=${e.file}`);
    console.log(`     首行: ${e.bodyFirstLine}`);
  });
}

/**
 * `pm inbox list`（03-cli §7.1/§7.2）：列出未归档条目，按 created 降序（01-数据规范 §7.3 步骤 2）。
 * 退出码：0 成功；2 E_CONFIG_INVALID。
 */
export async function runInboxList(args: InboxListArgs): Promise<number> {
  const json = !!args.json;
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const result = listInbox(index);
  if (json) console.log(JSON.stringify(result));
  else renderList(result);
  return 0;
}

/**
 * `pm inbox process`（03-cli §7.3）：未归档条目摘要预览，默认前 20 条，`--all` 不限；
 * `--dry-run` 只预览不写入。退出码：0；2（E_USAGE：--limit 非正数；E_CONFIG_INVALID）。
 */
export async function runInboxProcess(args: InboxProcessArgs): Promise<number> {
  const json = !!args.json;
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  let limit: number | undefined;
  if (!args.all) {
    limit = args.limit ?? 20; // 03-cli §7.3：默认 20
    if (!Number.isInteger(limit) || limit <= 0) {
      return usageError("--limit 需为正整数（03-cli §7.3）", json);
    }
  }
  const index = buildIndex(cfg.value);
  const all = listInbox(index);
  const entries = limit !== undefined ? all.entries.slice(0, limit) : all.entries;
  const result: InboxListResult = { entries, count: entries.length };
  if (json) console.log(JSON.stringify(result));
  else renderList(result);
  return 0;
}

/**
 * `pm inbox archive <id>`（03-cli §7.4）：归档条目到 PM/inbox/archive/，archived=今天，正文保留。
 * 退出码：0 成功；1 E_NOT_FOUND（编号不存在/非法）；2 E_USAGE（缺 id）/E_CONFIG_INVALID。
 */
export async function runInboxArchive(args: InboxArchiveArgs): Promise<number> {
  const json = !!args.json;
  const id = (args.id ?? "").trim();
  if (!id) return usageError("inbox archive <id> 必填（03-cli §7.4）", json);
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const res = archiveInboxEntry(index, id);
  if (!res.ok) {
    if (json) return failWith(res.error, json);
    console.error(`[${res.error.code}] ${res.error.message}`);
    return exitCodeFor(res.error.code);
  }
  const a = res.value.archived;
  if (json) {
    console.log(JSON.stringify({ archived: a }));
  } else {
    const displayTo = normalizePath(path.relative(cfg.value.vaultPath, a.to)) || a.to;
    console.log(`✅ ${a.id} 已归档至 ${displayTo}`);
  }
  return 0;
}
