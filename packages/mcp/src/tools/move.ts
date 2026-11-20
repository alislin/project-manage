import { E_USAGE, moveStatus } from "@pm/core";
import { errResult, okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";

/**
 * pm_move（04-mcp §2.3，语义 = pm move，03-cli §4）：
 * 状态流转经 core moveStatus（02-core §4.7，moveLocks 串行）；
 * 非法流转 → details.code=E_INVALID_TRANSITION（TC-04-008）；
 * 输出 = 03-cli §4.2 { ok, file, from, to, updatedField, id }（TC-04-007）。
 */

export interface MoveArgs {
  id: string;
  status: string;
}

export function pmMove(open: OpenContext, args: MoveArgs): ToolCallResult {
  const id = args.id.trim();
  const status = args.status.trim();
  if (!id) return errResult({ code: E_USAGE, message: "缺少必填参数 id（03-cli §4.1）", field: "id" });
  if (!status) return errResult({ code: E_USAGE, message: "缺少必填参数 status（03-cli §4.1, TC-03-022）", field: "status" });

  const res = moveStatus(open.index, id, status);
  if (!res.ok) return errResult(res.error);
  const out = res.value;
  if (!out.ok) return errResult(out.error); // 防御：写冲突/非法流转已在上层拦截

  return okResult({
    ok: true,
    file: out.file.absPath,
    from: out.from,
    to: out.to,
    updatedField: out.completedSet ? "updated+completed" : "updated",
    id: out.newStatuses[0]?.id ?? id,
  });
}
