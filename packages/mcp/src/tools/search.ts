import { E_USAGE, search } from "@pm/core";
import { errResult, okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";

/**
 * pm_search（04-mcp §2.6，输出 = 02-core §2.6 SearchResult）：
 * 检索经 core search（title/relPath 子串匹配）；q 必填非空（TC-04-012）；
 * limit 1-50 默认 10（越界 → E_USAGE，TC-04-013）；type 可选过滤。
 */
export interface SearchArgs {
  q: string;
  type?: "project" | "requirement" | "task" | "inbox";
  limit?: number;
}

export function pmSearch(open: OpenContext, args: SearchArgs): ToolCallResult {
  const q = args.q;
  if (q.trim().length === 0) {
    return errResult({ code: E_USAGE, message: '参数 "q" 不能为空（04-mcp §2.6 minLength 1）', field: "q" });
  }
  let results = search(open.index, q);
  if (args.type !== undefined) {
    results = results.filter((r) => r.type === args.type);
  }
  const limit = args.limit ?? 10; // 04-mcp §2.6：默认 10
  results = results.slice(0, limit);
  return okResult({ results });
}
