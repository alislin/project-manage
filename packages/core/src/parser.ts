import fs from "node:fs";
import { z, type ZodIssue, type ZodTypeAny } from "zod";
import matter from "gray-matter";
import { statMtimeMs } from "./writer.js";

/**
 * parseFile 结果（design §4.3）：
 * - ok：前matter 解析成功且通过 Zod 校验，data = 校验后数据
 * - !ok：ok=false，issues = ZodIssue 列表（含具体 path，design §4.3 + TC-02-006）
 */
export type ParseResult<T> =
  | { ok: true; data: T; body: string; mtimeMs: number }
  | { ok: false; issues: ZodIssue[]; raw: string; body: string; mtimeMs: number };

/** js-yaml 返回 Date 对象；design §5 IsoDate = z.string()，解析前转为 "YYYY-MM-DD" 本地字符串 */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return toIsoStringLocal(value);
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}

function toIsoStringLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function statMtime(absPath: string): number {
  return statMtimeMs(absPath); // S5R1 OBS-4：整数毫秒
}

/**
 * 解析 frontmatter + Zod 校验（design §4.3）：gray-matter（plan）+ safeParse。
 * 校验失败返回 { ok:false, issues }，不抛异常；无 frontmatter / 字段缺失等降级由 indexer 分类（design §4.4）。
 */
export function parseFile<T extends ZodTypeAny>(absPath: string, schema: T): ParseResult<z.infer<T>> {
  const raw = fs.readFileSync(absPath, "utf8");
  let res: { data: Record<string, unknown>; content: string };
  try {
    res = matter(raw) as { data: Record<string, unknown>; content: string };
  } catch (e) {
    // gray-matter 抛出（如非法 YAML）→ 视为解析失败（design §4.3 非抛异常）
    const issue: ZodIssue = { code: "custom", path: [], message: `frontmatter 解析失败: ${(e as Error).message}` };
    return { ok: false, issues: [issue], raw, body: raw, mtimeMs: statMtime(absPath) };
  }
  const parsed = schema.safeParse(normalizeDates(res.data));
  if (parsed.success) {
    return { ok: true, data: parsed.data, body: res.content, mtimeMs: statMtime(absPath) };
  }
  return { ok: false, issues: parsed.error.issues, raw, body: res.content, mtimeMs: statMtime(absPath) };
}
