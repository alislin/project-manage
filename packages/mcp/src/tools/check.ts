import { runCheck } from "@pm/core";
import { okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";
import { pathMatches } from "./validate.js";

/**
 * pm_check（04-mcp §2.5，语义 = pm check，03-cli §6）：
 * 一致性检查经 core runCheck（02-core services，03-cli §6.2 检查清单五类）。
 * 输出 = 03-cli §6.3 { ok, issues[] }（TC-04-010：issues 非空仍 isError=false，ok=false 语义）。
 * 入参同 pm_validate（04-mcp §2.5）：files 可选，提供时按路径过滤 issues；缺省 = 全部。
 */
export function pmCheck(open: OpenContext, args: { files?: string[] }): ToolCallResult {
  const result = runCheck(open.index);
  const files = args.files;
  const issues =
    !files || files.length === 0
      ? result.issues
      : result.issues.filter((iss) => {
          const rel = (() => {
            // 绝对路径 → relPath（03-cli check 人类输出同口径）
            const e = open.index.scan.entries.find((x) => x.absPath === iss.file);
            return e?.relPath;
          })();
          return files.some((f) => pathMatches(open.index, f, iss.file, rel ?? iss.file));
        });
  const ok = issues.length === 0;
  return okResult({ ok, issues });
}
