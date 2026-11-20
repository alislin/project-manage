/**
 * 磁盘 frontmatter 断言助手（S12 任务书 E2E-02/05：断言磁盘真实状态）。
 * 直接读临时 vault 的 md 文件，解析 YAML frontmatter 的 `key: value` 标量行。
 */
import fs from "node:fs";

/** 读取 frontmatter 为字符串映射（值去掉包裹引号；数组/嵌套结构原样保留字符串） */
export function readFrontmatter(absPath: string): Record<string, string> {
  const text = fs.readFileSync(absPath, "utf8").replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`文件缺少 frontmatter：${absPath}`);
  const fields: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = (kv[2] ?? "").trim();
    // 去掉 JSON.stringify 风格或 YAML 引号包裹（单层）
    const unquoted = /^"(.*)"$/s.exec(raw) ?? /^'(.*)'$/s.exec(raw);
    fields[kv[1] ?? ""] = unquoted ? (unquoted[1] ?? "") : raw;
  }
  return fields;
}

/** 断言用小助手 */
export function expectField(absPath: string, key: string, expected: string): void {
  const fm = readFrontmatter(absPath);
  const actual = fm[key];
  if (actual !== expected) {
    throw new Error(`磁盘 frontmatter 断言失败：${absPath}\n  期望 ${key}: ${expected}\n  实际 ${key}: ${actual}`);
  }
}
