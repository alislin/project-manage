import fs from "node:fs";
import path from "node:path";
import { allocateId, atomicWriteFile, reindexFile, REQ_ID_PATTERN, today, type AppError } from "@pm/core";
import { errResult, okResult, type ToolCallResult } from "../envelope.js";
import { syncScanEntry, type OpenContext } from "../context.js";
import { projectMd, requirementMd, taskMd } from "../templates.js";

/**
 * pm_create（04-mcp §2.2，语义 = pm new，03-cli §3；R-114 status 三类型默认值）：
 * - project：name 必填，slug = 显式 slug > name 规范化（03-cli §3.1）；
 * - requirement：projectSlug/title 必填，默认 status=pool（03-cli §3.2）；
 * - task：projectSlug/requirement/title/due 必填，默认 status=todo（03-cli §3.3）。
 * 输出 = { created: { id, slug?, path } }（03-cli §3.1–§3.3 created 对象）。
 */

/** 01-数据规范 §5 Slug 正则（与 core schema 同源） */
const SLUG_RE = /^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$/;
const MAX_SLUG_LEN = 80;
const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
const REQ_STATUSES = ["pool", "reviewing", "accepted", "rejected", "done"] as const;
const TASK_STATUSES = ["todo", "doing", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

export interface CreateArgs {
  type: "project" | "requirement" | "task";
  projectSlug?: string;
  slug?: string;
  name?: string;
  period?: string[];
  tags?: string[];
  status?: string;
  title?: string;
  module?: string;
  source?: string;
  priority?: string;
  requirement?: string;
  due?: string;
}

function validationError(message: string, field?: string): AppError {
  return { code: "E_VALIDATION", message, ...(field !== undefined ? { field } : {}) };
}

function usageError(message: string, field?: string): AppError {
  return { code: "E_USAGE", message, ...(field !== undefined ? { field } : {}) };
}

function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 01-数据规范 §1.5 slug 正常化策略（步骤 1–4；与 03-cli §3 new.ts 同源） */
function normalizeSlug(name: string): string {
  let s = name.trim();
  s = s.replace(/[A-Za-z]/g, (c) => c.toLowerCase()); // ASCII 小写化
  s = s.replace(/\s+/g, "-"); // 空格 → "-"
  s = s.replace(/[/\\:*?"<>|]/g, ""); // 移除非法字符
  s = s.replace(/[\x00-\x1f\x7f]/g, "");
  return s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/** 写新文件（文件必须不存在，先建目录，atomicWriteFile；03-cli §3 writeNewFile 同源） */
function writeNewFile(open: OpenContext, absPath: string, content: string): AppError | undefined {
  if (fs.existsSync(absPath)) {
    return { code: "E_CONFLICT", message: `文件已存在：${absPath}` };
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const w = atomicWriteFile(absPath, content, { pmRoot: open.config.pmRoot });
  if (!w.ok) return w.error;
  // 长驻进程索引维护（05-server createFile 同策略）：写后即时 reindex + 同步 scan 条目
  reindexFile(open.index, absPath);
  syncScanEntry(open.index, absPath);
  return undefined;
}

/** 需求 wiki-link / 裸 id 双形态归一（04-mcp §2.2 为 [[REQ-...]]；CLI 为裸 id；均归一为裸 id 校验） */
function normalizeRequirementLink(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("[[") && t.endsWith("]]")) return t.slice(2, -2).trim();
  return t;
}

export function pmCreate(open: OpenContext, args: CreateArgs): ToolCallResult {
  switch (args.type) {
    case "project":
      return createProject(open, args);
    case "requirement":
      return createRequirement(open, args);
    case "task":
      return createTask(open, args);
    default:
      // inputSchema enum 已拦截；防御分支
      return errResult(usageError(`type 取值非法（应为 project/requirement/task，04-mcp §2.2）`, "type"));
  }
}

// ---------------------------------------------------------------------------
// project（03-cli §3.1）
// ---------------------------------------------------------------------------

function createProject(open: OpenContext, args: CreateArgs): ToolCallResult {
  const index = open.index;
  const name = (args.name ?? "").trim();
  if (!name) return errResult(usageError("name 必填（03-cli §3.1）", "name"));
  if (name.length > 100) {
    return errResult(validationError("name 长度需 ≤ 100（01-数据规范 §1.1）", "name"));
  }

  // slug：显式 slug > name 规范化（03-cli §3.1）
  let slug: string;
  if (args.slug !== undefined && args.slug !== "") {
    slug = args.slug.trim();
    if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG_LEN) {
      return errResult(validationError(`slug 非法（03-cli §3.1, 01-数据规范 §5）: ${slug}`, "slug"));
    }
  } else {
    slug = normalizeSlug(name);
    if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG_LEN) {
      return errResult(validationError(`name 无法规范化出合法 slug（01-数据规范 §1.5）: ${name}`, "name"));
    }
  }

  // period（03-cli §3.1, R-107：默认 [今天, 今天]）
  let period: [string, string];
  if (args.period !== undefined) {
    const [s, e] = args.period;
    if (!isIsoDate(s) || !isIsoDate(e)) {
      return errResult(validationError(`period 非法 ISO 日期（01-数据规范 §5）: ${s} / ${e}`, "period"));
    }
    if (s > e) {
      return errResult(validationError("period[0] 必须 ≤ period[1]（01-数据规范 §1.1）", "period"));
    }
    period = [s, e];
  } else {
    const t = today();
    period = [t, t];
  }

  // tags（trim、去空、去重；MCP 入参为数组形态）
  const tags = [...new Set((args.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0))];

  const status = args.status ?? "active";
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    return errResult(validationError(`status 非法，应为 ${PROJECT_STATUSES.join("/")}（01-数据规范 §1.1）`, "status"));
  }

  // 项目已存在（03-cli §3.4 → E_CONFLICT）
  if (index.projects.some((p) => p.id === slug)) {
    return errResult({ code: "E_CONFLICT", message: `项目 ${slug} 已存在（05-server §2.2）` });
  }

  const idRes = allocateId(index, "project", slug);
  if (!idRes.ok) return errResult(idRes.error);
  const id = idRes.value; // project id = slug（01-数据规范 §1.5）

  const absPath = path.join(index.config.pmRoot, "projects", slug, "project.md");
  const writeError = writeNewFile(open, absPath, projectMd(slug, name, status, period, tags));
  if (writeError) return errResult(writeError);

  return okResult({ created: { id, slug, path: absPath } });
}

// ---------------------------------------------------------------------------
// requirement（03-cli §3.2，默认 status=pool，R-114）
// ---------------------------------------------------------------------------

function createRequirement(open: OpenContext, args: CreateArgs): ToolCallResult {
  const index = open.index;
  const slug = (args.projectSlug ?? "").trim();
  if (!slug) return errResult(usageError("projectSlug 必填（03-cli §3.2 --slug）", "projectSlug"));
  if (args.title === undefined) return errResult(usageError("title 必填（03-cli §3.2）", "title"));
  const title = args.title.trim();
  if (!title) return errResult(validationError("title 非空（01-数据规范 §1.2, TC-03-011）", "title"));
  if (title.length > 200) return errResult(validationError("title 长度需 ≤ 200（01-数据规范 §1.2）", "title"));

  // 项目目录必须已存在（03-cli §3.2 → E_NOT_FOUND）
  if (!index.projects.some((p) => p.id === slug)) {
    return errResult({ code: "E_NOT_FOUND", message: `项目 ${slug} 不存在（03-cli §3.2）` });
  }

  const idRes = allocateId(index, "REQ", slug);
  if (!idRes.ok) return errResult(idRes.error);
  const id = idRes.value;

  // R-102：source 默认 "human"（01-数据规范 §1.2）
  const source = args.source ?? "human";
  if (source.trim().length === 0) {
    return errResult(validationError("source 非空（R-102, 01-数据规范 §1.2）", "source"));
  }
  const priority = args.priority ?? "P2";
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    return errResult(validationError(`priority 非法，应为 ${TASK_PRIORITIES.join("/")}（01-数据规范 §7.1）`, "priority"));
  }
  const status = args.status ?? "pool";
  if (!(REQ_STATUSES as readonly string[]).includes(status)) {
    return errResult(validationError(`status 非法，应为 ${REQ_STATUSES.join("/")}（01-数据规范 §1.2, 03-cli §3.2）`, "status"));
  }
  const module = args.module ?? "";

  const now = today();
  const absPath = path.join(index.config.pmRoot, "projects", slug, "requirements", `${id}.md`);
  const writeError = writeNewFile(open, absPath, requirementMd(id, title, status, priority, module, source, now, now));
  if (writeError) return errResult(writeError);

  return okResult({ created: { id, path: absPath } });
}

// ---------------------------------------------------------------------------
// task（03-cli §3.3，默认 status=todo，R-114）
// ---------------------------------------------------------------------------

function createTask(open: OpenContext, args: CreateArgs): ToolCallResult {
  const index = open.index;
  const slug = (args.projectSlug ?? "").trim();
  if (!slug) return errResult(usageError("projectSlug 必填（03-cli §3.3 --slug）", "projectSlug"));
  if (args.requirement === undefined) return errResult(usageError("requirement 必填（03-cli §3.3）", "requirement"));
  if (args.title === undefined) return errResult(usageError("title 必填（03-cli §3.3）", "title"));
  if (args.due === undefined) return errResult(usageError("due 必填（03-cli §3.3, TC-03-014）", "due"));

  const title = args.title.trim();
  if (!title) return errResult(validationError("title 非空（01-数据规范 §1.3）", "title"));
  if (title.length > 200) return errResult(validationError("title 长度需 ≤ 200（01-数据规范 §1.3）", "title"));

  // requirement：[[REQ-...]] wiki-link（04-mcp §2.2）或裸 REQ id（CLI 形态）均接受
  const requirement = normalizeRequirementLink(args.requirement);
  if (!REQ_ID_PATTERN.test(requirement)) {
    return errResult(validationError("requirement 格式非法（需形如 [[REQ-<slug>-NNN]]，04-mcp §2.2）", "requirement"));
  }
  // 目标存在 fail-fast（TC-03-016；01-数据规范 §6.2, R-108）
  if (!index.requirements.some((r) => r.id === requirement)) {
    return errResult(validationError(`requirement ${requirement} 不存在（01-数据规范 §6.2, R-108）`, "requirement"));
  }
  // 项目必须存在（03-cli §3.3）
  if (!index.projects.some((p) => p.id === slug)) {
    return errResult({ code: "E_NOT_FOUND", message: `项目 ${slug} 不存在（03-cli §3.3）` });
  }
  // requirement 与项目一致（跨项目 → E_VALIDATION，01-数据规范 §6.2）
  const reqSlug = requirement.slice(4, requirement.length - 4);
  if (reqSlug !== slug) {
    return errResult(validationError(`requirement ${requirement} 不属于项目 ${slug}（跨项目，01-数据规范 §6.2）`, "requirement"));
  }

  const due = args.due.trim();
  if (!isIsoDate(due)) {
    return errResult(validationError(`due 非法 ISO 日期（01-数据规范 §5, §1.3）: ${args.due}`, "due"));
  }
  const priority = args.priority ?? "P2";
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    return errResult(validationError(`priority 非法，应为 ${TASK_PRIORITIES.join("/")}（01-数据规范 §7.1）`, "priority"));
  }
  const status = args.status ?? "todo";
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return errResult(validationError(`status 非法，应为 ${TASK_STATUSES.join("/")}（01-数据规范 §3.3）`, "status"));
  }

  const idRes = allocateId(index, "TASK", slug);
  if (!idRes.ok) return errResult(idRes.error);
  const id = idRes.value;

  const now = today();
  const absPath = path.join(index.config.pmRoot, "projects", slug, "tasks", `${id}.md`);
  const writeError = writeNewFile(open, absPath, taskMd(id, title, status, `[[${requirement}]]`, priority, due, now, now));
  if (writeError) return errResult(writeError);

  return okResult({ created: { id, path: absPath } });
}
