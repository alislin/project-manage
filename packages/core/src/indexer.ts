import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parseNumberId } from "./id";
import { parseFile, type ParseResult } from "./parser";
import { classifyFile, scanTree } from "./scanner";
import { ZInboxEntry, ZProject, ZRequirement, ZTask, type InboxEntry, type Project, type Requirement, type Task } from "./schema";
import { normalizePath, type BrokenFile, type Config, type FileEntry, type UnnumberedFile, type VaultIndex } from "./types";
import type { ZodIssue, ZodTypeAny } from "zod";

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 按路径选 schema（design §5.2：parseFile 每个 md） */
function schemaForPath(relPath: string): ZodTypeAny {
  if (/^projects\/[^/]+\/project\.md$/.test(relPath)) return ZProject;
  if (/^projects\/[^/]+\/requirements\//.test(relPath)) return ZRequirement;
  if (/^projects\/[^/]+\/tasks\//.test(relPath)) return ZTask;
  if (/^inbox\/[^/]+\.md$/.test(relPath)) return ZInboxEntry;
  return ZInboxEntry; // 其他文件：解析失败 → broken(parse)，成功则 classifyFile 判定
}

/** isDirectoryFile（design §4.4 第一行判定依据）：路径 == projects/<slug>/project.md */
function isDirectoryFilePath(relPath: string): boolean {
  return /^projects\/[^/]+\/project\.md$/.test(normalizePath(relPath));
}

/** 粗读 gray-matter 数据（兜底：无 frontmatter / 非法时返回 {}），供 classifyFile 分类用 */
function rawFrontmatter(absPath: string): Record<string, unknown> {
  try {
    return matter(fs.readFileSync(absPath, "utf8")).data as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 是否带 frontmatter（以 --- 开头）；design §4.4 未识别行中的"无 frontmatter → unnumbered" */
function hasFrontmatter(absPath: string): boolean {
  try {
    return matter.test(fs.readFileSync(absPath, "utf8"));
  } catch {
    return false;
  }
}

function statEntry(absPath: string, relPath: string): FileEntry {
  const st = fs.statSync(absPath);
  return { absPath, relPath, mtimeMs: st.mtimeMs, size: st.size };
}

/** design §2.3 BrokenFile.issues：ZodIssue 缩略（path → 字符串，code/message） */
function zodToIssue(i: ZodIssue): BrokenFile["issues"][number] {
  return { path: i.path.join("."), code: i.code, message: i.message };
}

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 按 id 升序（字典序 = 编号递增序，NNN 三位保证，01-数据规范 §6.3） */
function byId<T extends { id: string }>(a: T, b: T): number {
  return compareStr(a.id, b.id);
}

/** 索引组装目标（design §2.3 VaultIndex 结构） */
interface IndexTarget {
  projects: Project[];
  requirements: Requirement[];
  tasks: Task[];
  inboxEntries: InboxEntry[];
  unnumbered: UnnumberedFile[];
  broken: BrokenFile[];
  byPath: Map<string, Project | Requirement | Task | InboxEntry | BrokenFile>;
}

// ---------------------------------------------------------------------------
// 反链聚合（design §4.4, 01-数据规范 §6.3）
// ---------------------------------------------------------------------------

/** 提取正文中的 wiki-link（design §6.2 parseWikiLinks），供聚合复用 */
export function parseWikiLinks(body: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

/**
 * 反链聚合（design §4.4 + 01-数据规范 §6.3）：纯函数，从 tasks 推出 map；
 * 值 = TASK id 升序。validRequirementIds 非空时排除悬空链接
 * （目标需求不存在，01-数据规范 §6.3：由 pm check 报告，聚合时跳过）。
 */
export function deriveRequirementTasks(tasks: Task[], validRequirementIds?: Set<string>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of tasks) {
    const target = parseWikiLinks(t.requirement)[0];
    if (!target) continue;
    if (validRequirementIds && !validRequirementIds.has(target)) continue; // 悬空链接（目标不存在）不进入聚合结果
    const arr = map.get(target) ?? [];
    arr.push(t.id);
    map.set(target, arr);
  }
  for (const arr of map.values()) arr.sort();
  return map;
}

// ---------------------------------------------------------------------------
// 索引组装
// ---------------------------------------------------------------------------

/** 重新整理索引数组（design §7：projects/requirements/tasks 按 id 升序；inboxEntries 按 created 降序；unnumbered/broken 按路径） */
function resort(index: VaultIndex): void {
  index.projects.sort(byId);
  index.requirements.sort(byId);
  index.tasks.sort(byId);
  index.inboxEntries.sort((a, b) => compareStr(b.created, a.created) || compareStr(a.id, b.id)); // created 降序
  index.unnumbered.sort((a, b) => compareStr(a.file.relPath, b.file.relPath));
  index.broken.sort((a, b) => compareStr(a.file.relPath, b.file.relPath));
}

function removeRecord(index: VaultIndex, old: Project | Requirement | Task | InboxEntry | BrokenFile): void {
  const arr: Array<Project | Requirement | Task | InboxEntry | BrokenFile> =
    (old as Project).type === "project"
      ? index.projects
      : (old as Requirement).type === "requirement"
        ? index.requirements
        : (old as Task).type === "task"
          ? index.tasks
          : (old as InboxEntry).type === "inbox"
            ? index.inboxEntries
            : index.broken;
  const i = arr.indexOf(old);
  if (i >= 0) arr.splice(i, 1);
}

/** 按分类插入记录（design §5.2.5 跨文件链接校验：id 中 slug 必须与所在 projects/<slug>/ 一致）；返回 id-path-mismatch 的 BrokenFile（若有） */
function insertRecord(target: IndexTarget, entry: FileEntry, result: { data: Project | Requirement | Task | InboxEntry }, cls: "project" | "requirement" | "task" | "inbox"): BrokenFile | null {
  const rec = result.data;
  if (cls === "project") {
    target.projects.push(rec as Project);
    target.byPath.set(entry.absPath, rec as Project);
    return null;
  }
  if (cls === "requirement") {
    const dirSlug = /^projects\/([^/]+)\/requirements\//.exec(entry.relPath)?.[1];
    const idSlug = parseNumberId("REQ", rec.id)?.slug;
    if (dirSlug && idSlug !== dirSlug) {
      const bf: BrokenFile = {
        file: entry,
        issues: [{ path: "id", code: "id-path-mismatch", message: `id 中 slug (${idSlug ?? "?"}) 与所在目录 (${dirSlug}) 不一致` }],
        reason: "id-path-mismatch",
      };
      target.broken.push(bf);
      target.byPath.set(entry.absPath, bf);
      return bf;
    }
    target.requirements.push(rec as Requirement);
    target.byPath.set(entry.absPath, rec as Requirement);
    return null;
  }
  if (cls === "task") {
    target.tasks.push(rec as Task);
    target.byPath.set(entry.absPath, rec as Task);
    return null;
  }
  target.inboxEntries.push(rec as InboxEntry);
  target.byPath.set(entry.absPath, rec as InboxEntry);
  return null;
}

/** 全量：scanTree → parseFile(每个 md) → 分类（§4.4 表）→ byPath（design §5.2）→ requirementTasks（design §5.2.9） */
export function buildIndex(config: Config): VaultIndex {
  const scan = scanTree(config.pmRoot);
  const parsed: Array<{ file: FileEntry; result: ParseResult<Project | Requirement | Task | InboxEntry> }> = [];
  for (const file of scan.entries) {
    if (!file.relPath.endsWith(".md")) continue; // design §5.2.2：解析所有 *.md
    parsed.push({ file, result: parseFile(file.absPath, schemaForPath(file.relPath)) });
  }
  parsed.sort((a, b) => compareStr(a.file.relPath, b.file.relPath)); // design §5.2.2：按 relPath 稳定排序

  const projects: Project[] = [];
  const requirements: Requirement[] = [];
  const requirementsByProject = new Map<string, Requirement[]>();
  const tasks: Task[] = [];
  const inboxEntries: InboxEntry[] = [];
  const unnumbered: UnnumberedFile[] = [];
  const broken: BrokenFile[] = [];
  const byPath = new Map<string, Project | Requirement | Task | InboxEntry | BrokenFile>();

  for (const { file, result } of parsed) {
    const data = result.ok ? result.data : rawFrontmatter(file.absPath);
    const cls = classifyFile(file.relPath, data, isDirectoryFilePath(file.relPath));

    if (cls === "archived") continue; // design §4.4 归档排除：不进索引、不算 unnumbered（§5.2.7）

    if (cls === "unnumbered") {
      if (!result.ok && hasFrontmatter(file.absPath)) {
        // design §4.4 解析失败：frontmatter 非法 → broken(parse)
        const bf: BrokenFile = { file, issues: result.issues.map(zodToIssue), reason: "parse" };
        broken.push(bf);
        byPath.set(file.absPath, bf);
      } else {
        unnumbered.push({ file }); // design §4.4 未识别：无 frontmatter / 未知类型 → unnumbered
      }
      continue;
    }

    if (cls === "broken") {
      // design §4.4 跨区域类型：路径在 projects 下但 type 不符（或 id 与目录名不一致）→ broken(id-path-mismatch)
      const type = (data as Record<string, unknown> | undefined)?.type;
      const reason = typeof type === "string" && !["project", "requirement", "task", "inbox"].includes(type) ? "unknown-type" : "id-path-mismatch";
      const bf: BrokenFile = { file, issues: [{ path: "type", code: "E_INVALID_TRANSITION", message: "id 与目录名不一致（design §4.4 跨区域类型）" }], reason };
      broken.push(bf);
      byPath.set(file.absPath, bf);
      continue;
    }

    if (!result.ok) {
      const bf: BrokenFile = { file, issues: result.issues.map(zodToIssue), reason: "parse" };
      broken.push(bf);
      byPath.set(file.absPath, bf);
      continue;
    }

    insertRecord({ projects, requirements, tasks, inboxEntries, unnumbered, broken, byPath }, file, result, cls);
  }

  const index: VaultIndex = {
    config,
    scan,
    projects,
    requirements,
    requirementsByProject,
    tasks,
    inboxEntries,
    unnumbered,
    broken,
    requirementTasks: new Map(), // design §5.2.9 第 9 步：重算
    byPath,
    builtAt: new Date().toISOString(),
  };

  resort(index);

  // design §5.2.9：requirementTasks = deriveRequirementTasks(tasks)（01-数据规范 §6.3，悬空链接聚合时跳过）
  index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
  // design §5.2.4：requirementsByProject（按 id 升序，id 中 slug 与所在目录一致已校验）
  for (const r of index.requirements) {
    const slug = parseNumberId("REQ", r.id)?.slug;
    if (!slug) continue;
    const arr = requirementsByProject.get(slug) ?? [];
    arr.push(r);
    requirementsByProject.set(slug, arr);
  }
  for (const arr of requirementsByProject.values()) arr.sort(byId);

  return index;
}

/** 增量：单文件变更后用（design §5.4：更新 / 删除 / 排序稳定） */
export function reindexFile(index: VaultIndex, absPath: string): void {
  const relPath = normalizePath(path.relative(index.config.pmRoot, absPath));
  const old = index.byPath.get(absPath);

  if (!fs.existsSync(absPath)) {
    // 删除：从 byPath + 三类数组移除（design §5.4）
    index.byPath.delete(absPath);
    if (old) removeRecord(index, old);
    index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
    return;
  }

  // 更新：重新 parse，先移除旧记录，再按新分类插入（design §5.4）
  if (old) {
    index.byPath.delete(absPath);
    removeRecord(index, old);
  }

  const entry = statEntry(absPath, relPath);
  const result = parseFile(absPath, schemaForPath(relPath));
  const data = result.ok ? result.data : rawFrontmatter(absPath);
  const cls = classifyFile(relPath, data, isDirectoryFilePath(relPath));

  if (cls === "archived" || cls === "unnumbered") {
    index.byPath.delete(absPath); // 归档不入索引；unnumbered 不算索引（design §4.4/§5.2.7）
    index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
    return;
  }

  if (cls === "broken") {
    // design §4.4 跨区域类型：路径在 projects 下但 type 不符（或 id 与目录名不一致）→ broken(id-path-mismatch)
    const type = (data as Record<string, unknown> | undefined)?.type;
    const reason = typeof type === "string" && !["project", "requirement", "task", "inbox"].includes(type) ? "unknown-type" : "id-path-mismatch";
    const bf: BrokenFile = { file: entry, issues: [{ path: "type", code: "E_INVALID_TRANSITION", message: "id 与目录名不一致（design §4.4 跨区域类型）" }], reason };
    index.byPath.set(absPath, bf);
    index.broken.push(bf);
    resort(index);
    index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
    return;
  }

  if (!result.ok) {
    const bf: BrokenFile = { file: entry, issues: result.issues.map(zodToIssue), reason: "parse" };
    index.byPath.set(absPath, bf);
    index.broken.push(bf);
    resort(index);
    index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
    return;
  }

  insertRecord(index, entry, result, cls);
  resort(index);
  index.requirementTasks = deriveRequirementTasks(index.tasks, new Set(index.requirements.map((r) => r.id)));
}
