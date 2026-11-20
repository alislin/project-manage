import path from "node:path";
import { E_VALIDATION, normalizePath, type AppError, type VaultIndex } from "@pm/core";
import { errResult, okResult, type ToolCallResult } from "../envelope.js";
import type { OpenContext } from "../context.js";

/**
 * pm_validate（04-mcp §2.1，语义 = pm validate，03-cli §2）：
 * 校验全部/指定文件，错误精确到 file+field（03-cli §2.3）。
 * 输出 = 03-cli §2.2 { checkedFiles, ok, errors }；errors 非空 → isError=true（TC-04-002）。
 */

/** 02-core §4.7 validateAll：unnumbered 兜底错误（01-数据规范 §7.5） */
const UNNUMBERED_MSG = "无法识别的类型（01-数据规范 §7.5）";

export interface ValidateArgs {
  /** 可选。目录或 md 文件绝对/相对路径（目录 = 该目录下所有 md）；缺省 = 全部 */
  files?: string[];
}

interface ValidateError {
  file: string;
  field?: string;
  code: string;
  message: string;
}

/** 路径匹配（03-cli §2.1：绝对/相对路径、目录前缀、relPath 精确/前缀均可） */
export function pathMatches(index: VaultIndex, f: string, absPath: string, relPath: string): boolean {
  const abs = path.isAbsolute(f) ? f : path.resolve(index.config.pmRoot, f);
  const dirPrefix = abs.endsWith(path.sep) ? abs : `${abs}${path.sep}`;
  const norm = normalizePath(f);
  const relPrefix = norm.endsWith("/") ? norm : `${norm}/`;
  return absPath === abs || absPath.startsWith(dirPrefix) || relPath === norm || relPath.startsWith(relPrefix);
}

/** 筛选要校验的 md 文件（03-cli §2.1；P2-2：inbox/archive/ 归档产物不入 checkedFiles 口径） */
function filterEntries(index: VaultIndex, files?: string[]): Set<string> {
  const out: Set<string> = new Set();
  for (const e of index.scan.entries) {
    if (e.relPath.startsWith("inbox/archive/")) continue;
    if (!files || files.length === 0) {
      out.add(e.absPath);
      continue;
    }
    for (const f of files) {
      if (pathMatches(index, f, e.absPath, e.relPath)) {
        out.add(e.absPath);
        break;
      }
    }
  }
  return out;
}

/** broken/unnumbered → 校验错误清单（03-cli §2.2：仅 E_VALIDATION，02-core §4.7） */
function collectErrors(index: VaultIndex, entries: Set<string>): ValidateError[] {
  const out: ValidateError[] = [];
  for (const b of index.broken) {
    if (!entries.has(b.file.absPath)) continue;
    for (const issue of b.issues) {
      out.push({
        file: b.file.absPath,
        field: issue.path ? issue.path : undefined,
        code: E_VALIDATION,
        message: issue.message,
      });
    }
  }
  for (const u of index.unnumbered) {
    if (!entries.has(u.file.absPath)) continue;
    out.push({ file: u.file.absPath, field: "type", code: E_VALIDATION, message: UNNUMBERED_MSG });
  }
  return out;
}

export function pmValidate(open: OpenContext, args: ValidateArgs): ToolCallResult {
  const entries = filterEntries(open.index, args.files);
  const errors = collectErrors(open.index, entries);
  const checkedFiles = entries.size;
  const ok = errors.length === 0;
  if (!ok) {
    // TC-04-002：文件非法 → isError=true，details.code=E_VALIDATION，file+field 精确定位
    const error: AppError = {
      code: E_VALIDATION,
      message: `校验了 ${checkedFiles} 个文件，发现 ${errors.length} 个问题（03-cli §2）`,
      file: errors[0]?.file,
      field: errors[0]?.field,
      issues: errors.map((e) => ({ file: e.file, field: e.field ?? "", code: e.code, message: e.message })),
    };
    return errResult(error, { checkedFiles, errors });
  }
  return okResult({ checkedFiles, ok, errors });
}
