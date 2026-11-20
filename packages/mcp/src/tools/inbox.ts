import { E_USAGE, archiveInboxEntry, listInbox } from "@pm/core";
import { errResult, okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";

/**
 * pm_inbox 三件套（语义 = pm inbox list/process/archive，03-cli §7，01-数据规范 §7）：
 * - pm_inbox_list：未归档条目（created 降序），输出 = 03-cli §7.2 { entries, count }；
 * - pm_inbox_process：摘要预览（默认前 20 条；all 不限；只读），limit 非正整数 → E_USAGE；
 * - pm_inbox_archive：归档到 inbox/archive/（archived=今天），输出 = 03-cli §7.4 { archived }。
 */
export interface InboxProcessArgs {
  limit?: number;
  all?: boolean;
  dryRun?: boolean;
}

export function pmInboxList(open: OpenContext): ToolCallResult {
  const result = listInbox(open.index);
  return okResult({ entries: result.entries, count: result.count });
}

export function pmInboxProcess(open: OpenContext, args: InboxProcessArgs): ToolCallResult {
  let limit: number | undefined;
  if (!args.all) {
    limit = args.limit ?? 20; // 03-cli §7.3：默认 20
    if (!Number.isInteger(limit) || limit <= 0) {
      return errResult({ code: E_USAGE, message: "参数 limit 需为正整数（03-cli §7.3）", field: "limit" });
    }
  }
  const all = listInbox(open.index);
  const entries = limit !== undefined ? all.entries.slice(0, limit) : all.entries;
  return okResult({ entries, count: entries.length });
}

export function pmInboxArchive(open: OpenContext, args: { id: string }): ToolCallResult {
  const id = args.id.trim();
  if (!id) {
    return errResult({ code: E_USAGE, message: "缺少必填参数 id（03-cli §7.4）", field: "id" });
  }
  const res = archiveInboxEntry(open.index, id);
  if (!res.ok) return errResult(res.error);
  return okResult({ archived: res.value.archived });
}
