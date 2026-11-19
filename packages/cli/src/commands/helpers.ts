import type { AppError } from "@pm/core";

/**
 * 03-cli §1.3 统一退出码映射（core 错误码 → CLI；02-core §3.1）：
 * 0 成功；1 E_IO/E_NOT_FOUND；2 E_USAGE/E_CONFIG_INVALID/巡检 issues；3 E_CONFLICT；
 * 4 E_VALIDATION/E_INVALID_TRANSITION；5 E_SEQ_EXHAUSTED。
 */
export function exitCodeFor(code: string): number {
  switch (code) {
    case "E_CONFLICT":
      return 3;
    case "E_VALIDATION":
    case "E_INVALID_TRANSITION":
      return 4;
    case "E_SEQ_EXHAUSTED":
      return 5;
    case "E_USAGE":
    case "E_CONFIG_INVALID":
    case "E_DANGLING_WIKI":
    case "E_UNKNOWN_TYPE":
      return 2;
    default:
      return 1; // E_NOT_FOUND / E_IO
  }
}

/** 错误输出 + 返回退出码（02-core §3.2：--json 错误形状 { ok:false, code, message, ... }） */
export function failWith(error: AppError, json: boolean): number {
  if (json) {
    const out: Record<string, unknown> = { ok: false, code: error.code, message: error.message };
    if (error.file !== undefined) out.file = error.file;
    if (error.field !== undefined) out.field = error.field;
    if (error.issues !== undefined) out.issues = error.issues;
    console.error(JSON.stringify(out));
  } else {
    console.error(error.message);
  }
  return exitCodeFor(error.code);
}

/** 用法错误（E_USAGE，03-cli §1.3 exit 2） */
export function usageError(message: string, json: boolean): number {
  return failWith({ code: "E_USAGE", message }, json);
}

/** js-yaml 双引号标量（JSON 字符串语法是有效的 YAML double-quoted） */
export function yq(s: string): string {
  return JSON.stringify(s);
}

/** YAML 数组（flow sequence） */
export function yamlStringArray(arr: string[]): string {
  return `[${arr.map(yq).join(", ")}]`;
}
