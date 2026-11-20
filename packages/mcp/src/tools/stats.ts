import { deriveStats } from "@pm/core";
import { okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";

/**
 * pm_stats（04-mcp §2.4，语义 = pm stats，03-cli §5）：
 * 输出 = 02-core §2.4 Stats（projects[].progress.onTrack 与 totals.tasks.onTrack，R-202；TC-04-009）。
 * 入参固定空对象（04-mcp §2.4 inputSchema properties: {}）。
 */
export function pmStats(open: OpenContext): ToolCallResult {
  const stats = deriveStats(open.index);
  return okResult({ projects: stats.projects, totals: stats.totals });
}
