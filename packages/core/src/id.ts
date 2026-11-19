import { err, ok, type AppResult } from "./types";
import { E_SEQ_EXHAUSTED } from "./errors";

/** 编号 id 前缀（01-数据规范 §1.5：REQ/TASK/INBOX） */
export type NumberPrefix = "REQ" | "TASK" | "INBOX";

/** 编号正则（R-106 三位序号统一；01-数据规范 §1.2/§1.3/§1.4，与 Slug 正则互补） */
export const REQ_ID_PATTERN = /^REQ-[A-Za-z0-9一-鿿]+-\d{3}$/;
export const TASK_ID_PATTERN = /^TASK-[A-Za-z0-9一-鿿]+-\d{3}$/;
export const INBOX_ID_PATTERN = /^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$/;

export const NUMBER_ID_PATTERNS: Record<NumberPrefix, RegExp> = {
  REQ: REQ_ID_PATTERN,
  TASK: TASK_ID_PATTERN,
  INBOX: INBOX_ID_PATTERN,
};

/** 编号正则校验（纯函数）：id 是否符合 <PREFIX>-<slug>-\d{3}（01-数据规范 §1.5） */
export function isNumberId(prefix: NumberPrefix, id: string): boolean {
  return NUMBER_ID_PATTERNS[prefix].test(id);
}

/** 解析编号 id 的 slug 与序号（纯函数）；id 不符合正则返回 null */
export function parseNumberId(prefix: NumberPrefix, id: string): { slug: string; seq: number } | null {
  if (!NUMBER_ID_PATTERNS[prefix].test(id)) return null;
  const rest = id.slice(prefix.length + 1); // 去掉 "PREFIX-"
  const i = rest.lastIndexOf("-");
  return { slug: rest.slice(0, i), seq: Number(rest.slice(i + 1)) };
}

/**
 * 序号分配纯函数：existingIds = 同前缀+同 slug 的已有编号 id 列表。
 * 规则（01-数据规范 §1.5 步骤 2 / 02-core §2.7）：同前缀+同 slug 最大序号 + 1；
 * 无已有 → 001；下一序号 > 999 → 返回 E_SEQ_EXHAUSTED（不静默改格式）。
 */
export function allocateSeq(
  existingIds: string[],
  prefix: NumberPrefix,
  slug: string,
): AppResult<string> {
  let maxSeq = 0;
  for (const id of existingIds) {
    const parsed = parseNumberId(prefix, id);
    if (parsed && parsed.slug === slug && parsed.seq > maxSeq) {
      maxSeq = parsed.seq;
    }
  }
  const next = maxSeq + 1;
  if (next > 999) {
    return err({
      code: E_SEQ_EXHAUSTED,
      message: `${prefix}-<${slug}> 编号池已耗尽（序号 > 999），请先归档/删除低优任务`,
    });
  }
  return ok(`${prefix}-${slug}-${String(next).padStart(3, "0")}`);
}
