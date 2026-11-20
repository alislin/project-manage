import { E_IO, E_USAGE } from "@pm/core";
import { errResult, type ToolCallResult } from "./envelope.js";
import { TOOLS, validateToolArgs } from "./tools.js";
import { openContext, type OpenContext, type ToolContext } from "./context.js";
import { pmValidate } from "./tools/validate.js";
import { pmCreate } from "./tools/create.js";
import { pmMove } from "./tools/move.js";
import { pmStats } from "./tools/stats.js";
import { pmCheck } from "./tools/check.js";
import { pmSearch } from "./tools/search.js";
import { pmInboxArchive, pmInboxList, pmInboxProcess } from "./tools/inbox.js";

/**
 * 工具分发（04-mcp §1.2 执行顺序）：
 * 1. 工具存在性（未知工具 → E_USAGE）；
 * 2. loadConfig + buildIndex（缺失/非法 → E_CONFIG_INVALID，TC-04-014）；
 * 3. inputSchema 校验（违规 → E_USAGE，TC-04-006/012/013）；
 * 4. 业务 handler（core 服务；异常兜底 → E_IO 结构化错误）。
 */
type ToolHandler = (open: OpenContext, args: Record<string, unknown>) => ToolCallResult;

const HANDLERS: Record<string, ToolHandler> = {
  pm_validate: (open, args) => pmValidate(open, args),
  pm_create: (open, args) => pmCreate(open, args as never),
  pm_move: (open, args) => pmMove(open, args as never),
  pm_stats: (open) => pmStats(open),
  pm_check: (open, args) => pmCheck(open, args),
  pm_search: (open, args) => pmSearch(open, args as never),
  pm_inbox_list: (open) => pmInboxList(open),
  pm_inbox_process: (open, args) => pmInboxProcess(open, args),
  pm_inbox_archive: (open, args) => pmInboxArchive(open, args as never),
};

/** 直接调用工具 handler（SDK 兼容路径的同步内核；测试/上层复用同一入口） */
export async function dispatchCall(name: string, args: unknown, ctx: ToolContext): Promise<ToolCallResult> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) {
    return errResult({ code: E_USAGE, message: `未知工具 "${name}"（04-mcp §2 工具清单）` });
  }
  // 04-mcp §1.2：所有工具先 loadConfig（缺失/非法 → E_CONFIG_INVALID），再 buildIndex
  const open = openContext(ctx);
  if (!open.ok) return errResult(open.error);
  const argError = validateToolArgs(def, args);
  if (argError) return errResult(argError);
  const handler = HANDLERS[name];
  if (!handler) {
    return errResult({ code: E_USAGE, message: `工具 "${name}" 未实现（04-mcp §2 工具清单）` });
  }
  try {
    return handler(open.value, (args ?? {}) as Record<string, unknown>);
  } catch (e) {
    return errResult({
      code: E_IO,
      message: `工具 ${name} 执行失败: ${e instanceof Error ? e.message : String(e)}`,
      httpStatus: 500,
    });
  }
}
