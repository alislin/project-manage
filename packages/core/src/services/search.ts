import { locateRecords } from "./locate.js";
import type { SearchResult, VaultIndex } from "../types.js";

/**
 * 检索服务（02-core §4.7 `services/search.ts`，供 `pm search` 与 05-server §4.1 `GET /api/search` 共用）：
 * - 按 `title` 与 `relPath` 子串匹配（含 id），全小写比较（中文按码元包含，大小写不敏感）；
 * - 稳定排序：沿用索引既有顺序（projects/requirements/tasks/inbox 各自按 id/created 有序）；
 * - `highlight`：命中片段展示用摘要（title 命中给 title，路径命中给 relPath）；
 * - `q` 为空白串时返回空数组（非空约束由调用方校验，05-server §4.1 E_USAGE）。
 */
export function search(index: VaultIndex, q: string): SearchResult[] {
  const term = q.trim().toLowerCase();
  if (!term) return [];

  const locations = locateRecords(index);
  const relPathOf = (rec: object): string => locations.get(rec)?.relPath ?? "";
  const hit = (s: string): boolean => s.toLowerCase().includes(term);

  const results: SearchResult[] = [];

  for (const p of index.projects) {
    const relPath = relPathOf(p) || `projects/${p.id}/project.md`;
    if (hit(p.name) || hit(p.id) || hit(relPath)) {
      results.push({ id: p.id, type: "project", slug: p.id, relPath, title: p.name, highlight: hit(p.name) ? p.name : relPath });
    }
  }
  for (const r of index.requirements) {
    const relPath = relPathOf(r);
    // id 形如 REQ-<slug>-NNN（01-数据规范 §1.2）：slice(4, -4) 取 slug
    const slug = r.id.slice(4, -4);
    if (hit(r.title) || hit(r.id) || hit(relPath)) {
      results.push({ id: r.id, type: "requirement", slug, relPath, title: r.title, highlight: hit(r.title) ? r.title : relPath });
    }
  }
  for (const t of index.tasks) {
    const relPath = relPathOf(t);
    // id 形如 TASK-<slug>-NNN（01-数据规范 §1.3）：slice(5, -4) 取 slug
    const slug = t.id.slice(5, -4);
    if (hit(t.title) || hit(t.id) || hit(relPath)) {
      results.push({ id: t.id, type: "task", slug, relPath, title: t.title, highlight: hit(t.title) ? t.title : relPath });
    }
  }
  for (const e of index.inboxEntries) {
    const relPath = relPathOf(e);
    const title = relPath.split("/").pop()?.replace(/\.md$/, "") || e.id;
    if (hit(title) || hit(e.id) || hit(relPath)) {
      results.push({ id: e.id, type: "inbox", slug: e.slug, relPath, title, highlight: hit(title) ? title : relPath });
    }
  }
  return results;
}
