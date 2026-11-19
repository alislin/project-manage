import path from "node:path";
import { buildIndex, loadConfig, normalizePath, type Config, type VaultIndex } from "@pm/core";
import { failWith } from "./helpers.js";

export interface ValidateArgs {
  /** `[files...]`（目录 = 该目录下所有 md，相对 pmRoot；绝对路径亦接受） */
  files?: string[];
  /** `--json`：输出 { checkedFiles, ok, errors: [{file, field?, code, message}] }（03-cli §2.2） */
  json?: boolean;
  /** 工程根（测试用；CLI 默认 cwd，03-cli §1.1） */
  root?: string;
}

/** 02-core §4.7 validateAll：unnumbered 兜底错误（01-数据规范 §7.5） */
const UNNUMBERED_MSG = "无法识别的类型（01-数据规范 §7.5）";

interface CliError {
  file: string;
  field?: string;
  code: string;
  message: string;
}

/** 筛选要校验的 md 文件（03-cli §2.1：目录 = 该目录下所有 md） */
function filterEntries(index: VaultIndex, files?: string[]): Set<string> {
  if (!files || files.length === 0) return new Set(index.scan.entries.map((e) => e.absPath));
  const out = new Set<string>();
  for (const e of index.scan.entries) {
    for (const f of files) {
      const abs = path.isAbsolute(f) ? f : path.resolve(index.config.pmRoot, f);
      const dirPrefix = abs.endsWith(path.sep) ? abs : `${abs}${path.sep}`;
      const norm = normalizePath(f);
      const relPrefix = norm.endsWith("/") ? norm : `${norm}/`;
      if (e.absPath === abs || e.absPath.startsWith(dirPrefix) || e.relPath === norm || e.relPath.startsWith(relPrefix)) {
        out.add(e.absPath);
        break;
      }
    }
  }
  return out;
}

function collectErrors(index: VaultIndex, entries: Set<string>): CliError[] {
  const out: CliError[] = [];
  for (const b of index.broken) {
    if (!entries.has(b.file.absPath)) continue;
    for (const issue of b.issues) {
      out.push({
        file: b.file.absPath,
        field: issue.path ? issue.path : undefined,
        code: "E_VALIDATION",
        message: issue.message,
      });
    }
  }
  for (const u of index.unnumbered) {
    if (!entries.has(u.file.absPath)) continue;
    out.push({ file: u.file.absPath, field: "type", code: "E_VALIDATION", message: UNNUMBERED_MSG });
  }
  return out;
}

/**
 * `pm validate`（03-cli §2）：校验全部/指定文件，错误精确到 file+field（03-cli §2.3）。
 * errors 为空 → exit 0（TC-03-001/004/005）；非空 → exit 4（TC-03-003）。
 */
export async function runValidate(args: ValidateArgs): Promise<number> {
  const json = !!args.json;
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const entries = filterEntries(index, args.files);
  const errors = collectErrors(index, entries);
  const checkedFiles = entries.size;
  const ok = errors.length === 0;

  if (json) {
    console.log(JSON.stringify({ checkedFiles, ok, errors }));
    return ok ? 0 : 4;
  }
  if (ok) {
    console.log(`✅ 全部 ${checkedFiles} 个文件校验通过`);
    return 0;
  }
  console.error(`🔍 校验了 ${checkedFiles} 个文件，发现 ${errors.length} 个问题：`);
  for (const e of errors) {
    console.error(`✖ ${e.file}`);
    if (e.field) console.error(`     ${e.field}: ${e.message}（${e.code}）`);
    else console.error(`     ${e.message}（${e.code}）`);
  }
  return 4;
}
