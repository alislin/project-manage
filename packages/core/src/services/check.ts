import fs from "node:fs";
import matter from "gray-matter";
import { parseNumberId, REQ_WIKI_PATTERN } from "../id.js";
import { parseWikiLinks } from "../indexer.js";
import { locateRecords } from "./locate.js";
import { normalizePath, type CheckIssue, type CheckResult, type VaultIndex } from "../types.js";

/**
 * 一致性检查（`pm check` 共用实现，03-cli §6.2 检查清单 + 01-数据规范 §4.2/§6.2）：
 * 1. dangling-wiki        任务 wiki-link 目标不存在（无匹配 requirement，或目标不在当前项目）
 * 2. invalid-link-target  链接格式不合法（不匹配 ^\[\[REQ-<slug>-NNN\]\]$，01-数据规范 §6.2 第 3 条）
 * 3. id-conflict          同 id 在多个文件重复（编号冲突，plan「编号冲突」）
 * 4. date-inverted        updated < created（需求/任务）；或 due < created（任务）（01-数据规范 §4.2）
 * 5. invalid-frontmatter  解析失败/Zod 不通过（broken 清单，02-core §2.3 BrokenFile）
 *
 * 输出 issues（file=绝对路径 + field? + code + message，03-cli §6.3）；ok = issues 为空。
 */
export function runCheck(index: VaultIndex): CheckResult {
  const issues: CheckIssue[] = [];
  const loc = locateRecords(index);
  const reqIds = new Set(index.requirements.map((r) => r.id));

  // ---- broken 文件侧：invalid-frontmatter / invalid-link-target / date-inverted（03-cli §6.2 #2/#4/#5）----
  // broken 记录只有 ZodIssue 缩略，date 倒挂与链接格式直接从原始 frontmatter 判定
  //（Zod 会拦截 updated<created 使文件进入 broken，需在此还原为 date-inverted 语义，TC-03-031）。
  for (const b of index.broken) {
    const raw = rawFrontmatter(b.file.absPath);
    const invertedFields = new Set<string>();

    const created = isoValue(raw.created);
    const updated = isoValue(raw.updated);
    const due = isoValue(raw.due);
    if (created && updated && updated < created) {
      invertedFields.add("updated");
      issues.push({
        file: b.file.absPath,
        field: "updated",
        code: "date-inverted",
        message: `updated (${updated}) 早于 created (${created})（03-cli §6.2 date-inverted）`,
      });
    }
    if (created && due && due < created) {
      invertedFields.add("due");
      issues.push({
        file: b.file.absPath,
        field: "due",
        code: "date-inverted",
        message: `due (${due}) 早于 created (${created})（03-cli §6.2 date-inverted）`,
      });
    }

    // requirement 链接格式不合法（TC-03-033：Zod 因正则拦截 → broken，check 还原为 invalid-link-target）
    let linkReported = false;
    if (typeof raw.requirement === "string" && !WIKI_REQ_PATTERN.test(raw.requirement)) {
      linkReported = true;
      issues.push({
        file: b.file.absPath,
        field: "requirement",
        code: "invalid-link-target",
        message: `requirement 链接格式不合法: ${JSON.stringify(raw.requirement)}（需形如 [[REQ-<slug>-NNN]]，01-数据规范 §6.2）`,
      });
    }

    // 其余 broken issue → invalid-frontmatter（02-core §2.3 BrokenFile.issues，TC-03-032）
    for (const iss of b.issues) {
      if (linkReported && iss.path === "requirement") continue; // 已按 invalid-link-target 报告
      if (invertedFields.has(iss.path)) continue; // 已按 date-inverted 报告
      issues.push({
        file: b.file.absPath,
        field: iss.path ? iss.path : undefined,
        code: "invalid-frontmatter",
        message: iss.message,
      });
    }
  }

  // ---- typed 需求/任务侧：date-inverted（03-cli §6.2 #4）----
  // updated<created 已被 Zod superRefine 拦截（不会出现在 typed 记录），此处防御性复查；
  // due<created Zod 不校验，是 date-inverted 的主检测点（01-数据规范 §4.2，TC-03-031）。
  for (const r of index.requirements) {
    const l = loc.get(r);
    if (!l || r.updated >= r.created) continue;
    issues.push({
      file: l.absPath,
      field: "updated",
      code: "date-inverted",
      message: `updated (${r.updated}) 早于 created (${r.created})（03-cli §6.2 date-inverted）`,
    });
  }
  for (const t of index.tasks) {
    const l = loc.get(t);
    if (!l) continue;
    if (t.updated < t.created) {
      issues.push({
        file: l.absPath,
        field: "updated",
        code: "date-inverted",
        message: `updated (${t.updated}) 早于 created (${t.created})（03-cli §6.2 date-inverted）`,
      });
    }
    if (t.due < t.created) {
      issues.push({
        file: l.absPath,
        field: "due",
        code: "date-inverted",
        message: `due (${t.due}) 早于 created (${t.created})（03-cli §6.2 date-inverted）`,
      });
    }
  }

  // ---- typed 任务侧：dangling-wiki / invalid-link-target（03-cli §6.2 #1/#2，01-数据规范 §6.2）----
  for (const t of index.tasks) {
    const l = loc.get(t);
    if (!l) continue;
    const target = parseWikiLinks(t.requirement)[0];
    if (target === undefined || !WIKI_REQ_PATTERN.test(`[[${target}]]`)) {
      // 格式合法任务不可能走到这里（Zod 拦截），防御性报告
      issues.push({
        file: l.absPath,
        field: "requirement",
        code: "invalid-link-target",
        message: `requirement 链接格式不合法: ${t.requirement}（需形如 [[REQ-<slug>-NNN]]，01-数据规范 §6.2）`,
      });
      continue;
    }
    if (!reqIds.has(target)) {
      issues.push({
        file: l.absPath,
        field: "requirement",
        code: "dangling-wiki",
        message: `requirement 引用 [[${target}]] 不存在（03-cli §6.2 dangling-wiki）`,
      });
      continue;
    }
    // 目标存在但不在当前项目 → 悬空（跨项目关联禁止，01-数据规范 §6.2 第 2 条）
    const dirSlug = /^projects\/([^/]+)\/tasks\//.exec(l.relPath)?.[1];
    const targetSlug = parseNumberId("REQ", target)?.slug;
    if (dirSlug && targetSlug && dirSlug !== targetSlug) {
      issues.push({
        file: l.absPath,
        field: "requirement",
        code: "dangling-wiki",
        message: `requirement 引用 [[${target}]] 不在当前项目 ${dirSlug}（跨项目关联禁止，01-数据规范 §6.2）`,
      });
    }
  }

  // ---- id-conflict：同 id 多文件重复（03-cli §6.2 #3，01-数据规范 §1.5）----
  const filesById = new Map<string, string[]>();
  const collectIds = (recs: Array<{ id: string }>): void => {
    for (const rec of recs) {
      const l = loc.get(rec);
      if (!l) continue;
      const arr = filesById.get(rec.id) ?? [];
      arr.push(l.absPath);
      filesById.set(rec.id, arr);
    }
  };
  collectIds(index.projects);
  collectIds(index.requirements);
  collectIds(index.tasks);
  collectIds(index.inboxEntries);
  const conflictedIds = [...filesById.keys()].sort();
  for (const id of conflictedIds) {
    const files = filesById.get(id) ?? [];
    if (files.length <= 1) continue;
    const rels = files.map((abs) => {
      const rel = index.scan.entries.find((e) => e.absPath === abs)?.relPath;
      return rel ?? normalizePath(abs);
    });
    issues.push({
      file: files[0],
      field: "id",
      code: "id-conflict",
      message: `编号 ${id} 在 ${files.length} 个文件中重复: ${rels.join(" 与 ")}（03-cli §6.2 id-conflict）`,
    });
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 任务→需求 wiki-link 合法格式（01-数据规范 §1.3/§6.2，与 ZTask.requirement 正则同源：id.ts REQ_WIKI_PATTERN） */
const WIKI_REQ_PATTERN = REQ_WIKI_PATTERN;

/** ISO 日期形状（date-inverted 仅对可比较的日期值判定；非法格式交给 invalid-frontmatter） */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** gray-matter 粗读 frontmatter（兜底 {}，与 indexer rawFrontmatter 同策略） */
function rawFrontmatter(absPath: string): Record<string, unknown> {
  try {
    return (matter(fs.readFileSync(absPath, "utf8")).data ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 归一为可比较的 ISO 日期串：js-yaml 无引号日期解析为 Date（parser.normalizeDates 同策略，
 * 转本地 YYYY-MM-DD）；字符串需满足 ISO 形状才参与比较，其余（缺字段/类型错）返回 undefined。
 */
function isoValue(v: unknown): string | undefined {
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "string" && ISO_SHAPE.test(v)) return v;
  return undefined;
}
