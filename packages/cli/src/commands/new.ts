import fs from "node:fs";
import path from "node:path";
import {
  allocateId,
  atomicWriteFile,
  buildIndex,
  loadConfig,
  normalizePath,
  today,
  type Config,
} from "@pm/core";
import { failWith, usageError, yq, yamlStringArray } from "./helpers.js";

/** 01-数据规范 §5 Slug 正则（与 core schema 一致） */
const SLUG_RE = /^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$/;
const MAX_SLUG_LEN = 80;
const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
const REQ_STATUSES = ["pool", "reviewing", "accepted", "rejected", "done"] as const;
const TASK_STATUSES = ["todo", "doing", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
/** 01-数据规范 §1.3 ZTask.requirement 正则 */
const REQ_ID_RE = /^REQ-[A-Za-z0-9一-鿿]+-\d{3}$/;

export interface NewProjectOpts {
  name?: string;
  slug?: string;
  /** `--period <start> <end>`（variadic，取2元素；默认 [今天, 今天]，R-107） */
  period?: string[];
  /** `--tags`/`--tag`（逗号分隔，trim，去重；默认 []） */
  tags?: string;
  tag?: string;
  status?: string;
  json?: boolean;
  root?: string;
}

export interface NewRequirementOpts {
  slug?: string;
  title?: string;
  module?: string;
  source?: string;
  priority?: string;
  status?: string;
  json?: boolean;
  root?: string;
}

export interface NewTaskOpts {
  slug?: string;
  requirement?: string;
  title?: string;
  priority?: string;
  due?: string;
  status?: string;
  json?: boolean;
  root?: string;
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

function vaultRel(config: Config, abs: string): string {
  return normalizePath(path.relative(config.vaultPath, abs));
}

/** 写新文件（文件必须不存在，先建目录，atomicWriteFile） */
function writeNewFile(config: Config, absPath: string, content: string, json: boolean): number | undefined {
  if (fs.existsSync(absPath)) {
    return failWith({ code: "E_CONFLICT", message: `文件已存在：${absPath}` }, json);
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const w = atomicWriteFile(absPath, content, { pmRoot: config.pmRoot });
  if (!w.ok) return failWith(w.error, json);
  return undefined;
}

// ---------------------------------------------------------------------------
// 模板（01-数据规范 §1.1/§1.2/§1.3；03-cli §3）
// ---------------------------------------------------------------------------

function projectMd(slug: string, name: string, status: string, period: [string, string], tags: string[]): string {
  return `---
type: project
id: ${yq(slug)}
name: ${yq(name)}
status: ${status}
period: [${period.map((d) => yq(d)).join(", ")}]
tags: ${yamlStringArray(tags)}
---
`;
}

function requirementMd(
  id: string,
  title: string,
  status: string,
  priority: string,
  module: string,
  source: string,
  created: string,
  updated: string,
): string {
  return `---
type: requirement
id: ${yq(id)}
title: ${yq(title)}
status: ${status}
priority: ${yq(priority)}
module: ${yq(module)}
source: ${yq(source)}
created: ${yq(created)}
updated: ${yq(updated)}
---
`;
}

function taskMd(
  id: string,
  title: string,
  status: string,
  requirement: string,
  priority: string,
  due: string,
  created: string,
  updated: string,
): string {
  return `---
type: task
id: ${yq(id)}
title: ${yq(title)}
status: ${status}
requirement: ${yq(requirement)}
priority: ${yq(priority)}
due: ${yq(due)}
completed: null
created: ${yq(created)}
updated: ${yq(updated)}
---
`;
}

/** 01-数据规范 §1.5 slug 正常化策略（步骤 1–4；步骤 5 的项目重名冲突由 03-cli §3.4 E_CONFLICT 处理，TC-03-007） */
function normalizeSlug(name: string): string {
  let s = name.trim();
  // 2) ASCII 小写化（其它非汉字 Unicode 保留）
  s = s.replace(/[A-Za-z]/g, (c) => c.toLowerCase());
  // 3) 空格 → "-", 连续 "-" 合并，去首尾 "-"
  s = s.replace(/\s+/g, "-");
  // 4) 移除 /\:*?"<>| 及控制字符
  s = s.replace(/[/\\:*?"<>|]/g, "");
  s = s.replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

// ---------------------------------------------------------------------------
// pm new project（03-cli §3.1）
// ---------------------------------------------------------------------------

export async function runNewProject(opts: NewProjectOpts): Promise<number> {
  const json = !!opts.json;
  const cfg = loadConfig(opts.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);

  const name = (opts.name ?? "").trim();
  if (!name) return usageError("--name 必填（03-cli §3.1）", json);
  if (name.length > 100) {
    return failWith({ code: "E_VALIDATION", message: "name 长度需 ≤ 100（01-数据规范 §1.1）", field: "name" }, json);
  }

  // slug：显式 --slug > --name 规范化（03-cli §3.1，§1 交叉）
  let slug: string;
  if (opts.slug !== undefined && opts.slug !== "") {
    slug = opts.slug.trim();
    if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG_LEN) {
      return failWith({ code: "E_VALIDATION", message: `slug 非法（03-cli §3.1, 01-数据规范 §5）: ${slug}`, field: "slug" }, json);
    }
  } else {
    slug = normalizeSlug(name);
    if (!SLUG_RE.test(slug) || slug.length > MAX_SLUG_LEN) {
      return failWith({ code: "E_VALIDATION", message: `name 无法规范化出合法 slug（01-数据规范 §1.5）: ${name}`, field: "name" }, json);
    }
  }

  // period（03-cli §3.1, R-107：默认 [今天, 今天]）
  let period: [string, string];
  if (opts.period !== undefined) {
    if (opts.period.length !== 2) return usageError("--period 需提供起止两个日期（03-cli §3.1）", json);
    const [s, e] = opts.period;
    if (!isIsoDate(s) || !isIsoDate(e)) {
      return failWith({ code: "E_VALIDATION", message: `period 非法 ISO 日期（01-数据规范 §5）: ${s} / ${e}`, field: "period" }, json);
    }
    if (s > e) {
      return failWith({ code: "E_VALIDATION", message: "period[0] 必须 ≤ period[1]（01-数据规范 §1.1）", field: "period" }, json);
    }
    period = [s, e];
  } else {
    const t = today();
    period = [t, t];
  }

  // tags（逗号分隔，trim，去重；--tags 为主名，--tag 兼容别名）
  const tagsInput = opts.tags ?? opts.tag ?? "";
  const tags = [...new Set(tagsInput.split(",").map((t) => t.trim()).filter((t) => t.length > 0))];

  const status = opts.status ?? "active";
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    return failWith({ code: "E_VALIDATION", message: `status 非法，应为 ${PROJECT_STATUSES.join("/")}（01-数据规范 §1.1）`, field: "status" }, json);
  }

  // 项目已存在（TC-03-007 → E_CONFLICT exit 3）
  if (index.projects.some((p) => p.id === slug)) {
    return failWith({ code: "E_CONFLICT", message: `项目 ${slug} 已存在（05-server §2.2）` }, json);
  }

  const idRes = allocateId(index, "project", slug);
  if (!idRes.ok) return failWith(idRes.error, json);
  const id = idRes.value; // project id = slug（01-数据规范 §1.5）

  const absPath = path.join(index.config.pmRoot, "projects", slug, "project.md");
  const code = writeNewFile(index.config, absPath, projectMd(slug, name, status, period, tags), json);
  if (code !== undefined) return code;

  if (json) console.log(JSON.stringify({ created: { id, slug, path: absPath } }));
  else console.log(`✅ 已创建项目: ${vaultRel(cfg.value, absPath)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// pm new requirement（03-cli §3.2）
// ---------------------------------------------------------------------------

export async function runNewRequirement(opts: NewRequirementOpts): Promise<number> {
  const json = !!opts.json;
  const cfg = loadConfig(opts.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);

  const slug = (opts.slug ?? "").trim();
  if (!slug) return usageError("--slug 必填（03-cli §3.2）", json);
  if (opts.title === undefined) return usageError("--title 必填（03-cli §3.2）", json);
  const title = opts.title.trim();
  if (!title) return failWith({ code: "E_VALIDATION", message: "title 非空（01-数据规范 §1.2, TC-03-011）", field: "title" }, json);
  if (title.length > 200) return failWith({ code: "E_VALIDATION", message: "title 长度需 ≤ 200（01-数据规范 §1.2）", field: "title" }, json);

  // 项目目录必须已存在（03-cli §3.2, TC-03-012 → E_NOT_FOUND exit 1）
  if (!index.projects.some((p) => p.id === slug)) {
    return failWith({ code: "E_NOT_FOUND", message: `项目 ${slug} 不存在（03-cli §3.2）` }, json);
  }

  const idRes = allocateId(index, "REQ", slug);
  if (!idRes.ok) return failWith(idRes.error, json);
  const id = idRes.value;

  // R-102：source 默认 "human"（01-数据规范 §1.2）
  const source = opts.source ?? "human";
  if (source.trim().length === 0) {
    return failWith({ code: "E_VALIDATION", message: "source 非空（R-102, 01-数据规范 §1.2）", field: "source" }, json);
  }
  const priority = opts.priority ?? "P2";
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    return failWith({ code: "E_VALIDATION", message: `priority 非法，应为 ${TASK_PRIORITIES.join("/")}（01-数据规范 §7.1）`, field: "priority" }, json);
  }
  const status = opts.status ?? "pool";
  if (!(REQ_STATUSES as readonly string[]).includes(status)) {
    return failWith({ code: "E_VALIDATION", message: `status 非法，应为 ${REQ_STATUSES.join("/")}（01-数据规范 §1.2, 03-cli §3.2）`, field: "status" }, json);
  }
  const module = opts.module ?? "";

  const now = today();
  const absPath = path.join(index.config.pmRoot, "projects", slug, "requirements", `${id}.md`);
  const code = writeNewFile(index.config, absPath, requirementMd(id, title, status, priority, module, source, now, now), json);
  if (code !== undefined) return code;

  if (json) console.log(JSON.stringify({ created: { id, path: absPath } }));
  else console.log(`✅ 已创建需求: ${vaultRel(cfg.value, absPath)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// pm new task（03-cli §3.3）
// ---------------------------------------------------------------------------

export async function runNewTask(opts: NewTaskOpts): Promise<number> {
  const json = !!opts.json;
  const cfg = loadConfig(opts.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);

  const slug = (opts.slug ?? "").trim();
  if (!slug) return usageError("--slug 必填（03-cli §3.3）", json);
  const requirement = (opts.requirement ?? "").trim();
  if (!requirement) return usageError("--requirement 必填（03-cli §3.3）", json);
  if (opts.title === undefined) return usageError("--title 必填（03-cli §3.3）", json);
  const title = opts.title.trim();
  if (!title) return failWith({ code: "E_VALIDATION", message: "title 非空（01-数据规范 §1.3）", field: "title" }, json);
  if (title.length > 200) return failWith({ code: "E_VALIDATION", message: "title 长度需 ≤ 200（01-数据规范 §1.3）", field: "title" }, json);

  // 外键格式校验（03-cli §3.3, TC-03-015）
  if (!REQ_ID_RE.test(requirement)) {
    return failWith({ code: "E_VALIDATION", message: `requirement 格式非法（需形如 REQ-<slug>-NNN，03-cli §3.3）`, field: "requirement" }, json);
  }
  // 目标存在 fail-fast（TC-03-016；01-数据规范 §6.2, R-108：validate 不校验悬空）
  if (!index.requirements.some((r) => r.id === requirement)) {
    return failWith({ code: "E_VALIDATION", message: `requirement ${requirement} 不存在（01-数据规范 §6.2, R-108）`, field: "requirement" }, json);
  }
  // 项目必须存在（03-cli §3.3）
  if (!index.projects.some((p) => p.id === slug)) {
    return failWith({ code: "E_NOT_FOUND", message: `项目 ${slug} 不存在（03-cli §3.3）` }, json);
  }
  // requirement 与项目一致（跨项目 → E_VALIDATION，01-数据规范 §6.2）
  const reqSlug = requirement.slice(4, requirement.length - 4);
  if (reqSlug !== slug) {
    return failWith({ code: "E_VALIDATION", message: `requirement ${requirement} 不属于项目 ${slug}（跨项目，01-数据规范 §6.2）`, field: "requirement" }, json);
  }
  // due 必填（TC-03-014 → E_USAGE exit 2）
  if (opts.due === undefined) return usageError("--due 必填（03-cli §3.3, TC-03-014）", json);
  const due = opts.due.trim();
  if (!isIsoDate(due)) {
    return failWith({ code: "E_VALIDATION", message: `due 非法 ISO 日期（01-数据规范 §5, §1.3）: ${opts.due}`, field: "due" }, json);
  }
  const priority = opts.priority ?? "P2";
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    return failWith({ code: "E_VALIDATION", message: `priority 非法，应为 ${TASK_PRIORITIES.join("/")}（01-数据规范 §7.1）`, field: "priority" }, json);
  }
  const status = opts.status ?? "todo";
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return failWith({ code: "E_VALIDATION", message: `status 非法，应为 ${TASK_STATUSES.join("/")}（01-数据规范 §3.3）`, field: "status" }, json);
  }

  const idRes = allocateId(index, "TASK", slug);
  if (!idRes.ok) return failWith(idRes.error, json);
  const id = idRes.value;

  const now = today();
  const absPath = path.join(index.config.pmRoot, "projects", slug, "tasks", `${id}.md`);
  const content = taskMd(id, title, status, `[[${requirement}]]`, priority, due, now, now);
  const code = writeNewFile(index.config, absPath, content, json);
  if (code !== undefined) return code;

  if (json) console.log(JSON.stringify({ created: { id, path: absPath } }));
  else console.log(`✅ 已创建任务: ${vaultRel(cfg.value, absPath)}`);
  return 0;
}
