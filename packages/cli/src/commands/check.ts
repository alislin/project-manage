import path from "node:path";
import { buildIndex, loadConfig, normalizePath, runCheck as runCheckIndex, type CheckResult } from "@pm/core";
import { failWith } from "./helpers.js";

export interface CheckArgs {
  /** `--json`：输出 { ok, issues: [{file, field?, code, message}] }（03-cli §6.3） */
  json?: boolean;
  /** 工程根（测试用；CLI 默认经全局 --root/cwd 解析，03-cli §1.1） */
  root?: string;
}

/**
 * `pm check`（03-cli §6）：一致性检查，core runCheck（02-core services + 03-cli §6.2 检查清单）。
 * 退出码：0 无问题；2 发现问题（issues 非空）或 E_CONFIG_INVALID（03-cli §6.5/§1.3）。
 */
export async function runCheck(args: CheckArgs): Promise<number> {
  const json = !!args.json;
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const result: CheckResult = runCheckIndex(index);

  if (json) {
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 2;
  }
  if (result.ok) {
    console.log(`🟢 台账一致性健康（check 发现 0 个问题）`);
    return 0;
  }
  console.log(`🔍 检查完成，发现 ${result.issues.length} 个问题:`);
  result.issues.forEach((iss, i) => {
    const rel = normalizePath(path.relative(cfg.value.pmRoot, iss.file)) || iss.file;
    const field = iss.field ? ` (${iss.field})` : "";
    console.log(`  ${i + 1}. [${iss.code}]${field} ${rel}: ${iss.message}`);
  });
  return 2;
}
