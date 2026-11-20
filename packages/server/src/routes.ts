import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  E_CONFLICT,
  E_INVALID_TRANSITION,
  E_NOT_FOUND,
  allocateId,
  atomicWriteFile,
  deriveStats,
  isValidTransition,
  moveStatus,
  parseWikiLinks,
  reindexFile,
  runExclusive,
  search,
  today,
  type AppError,
  type AppResult,
  type Requirement,
  type Task,
  type VaultIndex,
} from "@pm/core";
import { sendErr, sendOk } from "./errors.js";
import { parseBody, parseSearchQuery, ZDeriveTask, ZNewProject, ZNewRequirement, ZNewTask, ZPatchRequirement, ZPatchTask } from "./schemas.js";
import { syncScanEntry, type ServerState } from "./state.js";
import { projectMd, requirementMd, taskMd } from "./templates.js";

/** 路由层可见的运行态（watcher/webDist 由生命周期层管理） */
type RouteState = Pick<ServerState, "config" | "index" | "hub">;

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 与 writer 相同的 mtime 比较容差（02-core §4.6/§6.1） */
const MTIME_EPSILON_MS = 1;

/** 记录定位：byPath 按 id 查 Project/Requirement/Task + 对应 scan FileEntry（02-core §5.2.10） */
interface RecordWithFile {
  record: { id: string; status: string };
  file: { absPath: string; relPath: string; mtimeMs: number };
}

function findRecord(index: VaultIndex, id: string): RecordWithFile | undefined {
  for (const [absPath, rec] of index.byPath) {
    if ("id" in rec && rec.id === id && "status" in rec) {
      const file = index.scan.entries.find((e) => e.absPath === absPath);
      if (file) return { record: rec as RecordWithFile["record"], file };
    }
  }
  return undefined;
}

/** relPath → scan entry 的 mtimeMs（GET 载荷的冲突检测基准，05-server §1.1） */
function mtimeOfRel(index: VaultIndex, relPath: string): number {
  return index.scan.byPath.get(relPath)?.mtimeMs ?? 0;
}

/** id（REQ/TASK-<slug>-NNN）→ slug（01-数据规范 §1.5） */
function slugOfId(id: string): string {
  return id.slice(id.indexOf("-") + 1, -4);
}

/** 日期 + n 天（ISO 日历日，UTC 运算对 date-only 字符串无时区漂移） */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 项目需求集合（index.requirementsByProject，02-core §5.2） */
function projectRequirements(index: VaultIndex, slug: string): Requirement[] {
  return index.requirementsByProject.get(slug) ?? [];
}

/** 项目任务集合：requirement wiki-link 目标 ∈ 项目需求 id（与 02-core §2.4 deriveStats 同口径） */
function projectTasks(index: VaultIndex, slug: string): Task[] {
  const reqIds = new Set(projectRequirements(index, slug).map((r) => r.id));
  return index.tasks.filter((t) => {
    const target = parseWikiLinks(t.requirement)[0];
    return target !== undefined && reqIds.has(target);
  });
}

/** 写新文件：先建目录再原子写；成功后同步 scan 条目并增量 reindex（02-core §5.4） */
function createFile(state: RouteState, absPath: string, content: string): AppResult<{ mtimeMs: number }> {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const w = atomicWriteFile(absPath, content, { pmRoot: state.config.pmRoot });
  if (!w.ok) return w;
  syncScanEntry(state.index, absPath);
  reindexFile(state.index, absPath);
  return { ok: true, value: { mtimeMs: w.written.mtimeMs } };
}

function notFound(id: string): AppError {
  return { code: E_NOT_FOUND, message: `记录 ${id} 不存在（05-server §6.5）` };
}

// ---------------------------------------------------------------------------
// 状态流转（05-server §2.7 / §3.3，与 02-core §4.7.1 move 锁同源）
// ---------------------------------------------------------------------------

interface PatchBody {
  status: string;
  expectedMtimeMs?: number;
}

/**
 * PATCH /:id 状态流转共用实现：
 * 1. byPath 查找 → E_NOT_FOUND(404)；
 * 2. isValidTransition → E_INVALID_TRANSITION(409)；
 * 3. expectedMtimeMs 冲突预检（05-server §6.1 步骤 2–3）→ E_CONFLICT(409)；
 * 4. moveStatus 落盘（锁内 atomicWriteFile 携带 scan entry mtime 复查）+ reindexFile。
 * 全程在按路径 runExclusive 锁内执行（review-m1-r2 O1 / 05-server §6.2）。
 */
async function patchStatus(state: RouteState, id: string, body: PatchBody): Promise<AppResult<{ id: string; from: string; to: string; updatedField: "updated" | "updated+completed"; mtimeMs: number }>> {
  const found = findRecord(state.index, id);
  if (!found) return { ok: false, error: notFound(id) };

  return runExclusive(found.file.relPath, (): AppResult<{ id: string; from: string; to: string; updatedField: "updated" | "updated+completed"; mtimeMs: number }> => {
    const current = findRecord(state.index, id); // 锁内重查：前序排队者可能已改变索引
    if (!current) return { ok: false, error: notFound(id) };

    const from = current.record.status;
    if (!isValidTransition(from, body.status, state.index)) {
      return {
        ok: false,
        error: {
          code: E_INVALID_TRANSITION,
          message: `非法状态流转: ${from} -> ${body.status}（01-数据规范 §3.4）`,
          file: current.file.absPath,
          field: "status",
        },
      };
    }

    // 冲突预检（05-server §6.1）：调用方基准与磁盘实际比对；无基准时交由 moveStatus 内部预检
    if (body.expectedMtimeMs !== undefined) {
      let currentMtimeMs: number | undefined;
      try {
        currentMtimeMs = fs.statSync(current.file.absPath).mtimeMs;
      } catch {
        currentMtimeMs = undefined; // 文件已被外部删除：交给 moveStatus 内部检查
      }
      if (currentMtimeMs !== undefined && Math.abs(currentMtimeMs - body.expectedMtimeMs) > MTIME_EPSILON_MS) {
        // 与 writer 同构的写冲突形状（02-core §2.7 WriteConflict，05-server §6.4 body）
        const error: AppError & { expectedMtimeMs: number; currentMtimeMs: number } = {
          code: E_CONFLICT,
          message: "文件已被外部修改，请刷新后重试",
          file: current.file.absPath,
          expectedMtimeMs: body.expectedMtimeMs,
          currentMtimeMs,
          httpStatus: 409,
        };
        return { ok: false, error };
      }
    }

    const res = moveStatus(state.index, id, body.status);
    if (!res.ok) return res;
    const outcome = res.value;
    if (!outcome.ok) return { ok: false, error: outcome.error }; // 防御：写冲突/非法流转已在上层拦截
    return {
      ok: true,
      value: {
        id,
        from: String(outcome.from),
        to: outcome.to,
        updatedField: outcome.completedSet ? "updated+completed" : "updated",
        mtimeMs: outcome.file.mtimeMs,
      },
    };
  });
}

function replyWith(reply: FastifyReply, res: AppResult<unknown>, statusCode = 200): void {
  if (res.ok) sendOk(reply, res.value, statusCode);
  else sendErr(reply, res.error);
}

// ---------------------------------------------------------------------------
// 路由注册（05-server §2–§5）
// ---------------------------------------------------------------------------

export function registerRoutes(app: FastifyInstance, state: RouteState): void {
  const { index } = state;

  // --- 存活检查 ---
  app.get("/api/health", async () => ({ ok: true, data: { status: "ok" } }));

  // --- 05-server §2.1 GET /api/projects（含聚合统计） ---
  app.get("/api/projects", async (_req, reply) => {
    const stats = deriveStats(index);
    sendOk(reply, {
      projects: stats.projects.map((s) => {
        const p = index.projects.find((x) => x.id === s.slug);
        return {
          slug: s.slug,
          name: s.name,
          status: s.status,
          period: p?.period ?? ["", ""],
          tags: p?.tags ?? [],
          progress: s.progress,
          mtimeMs: mtimeOfRel(index, `projects/${s.slug}/project.md`),
        };
      }),
    });
  });

  // --- 05-server §2.2 POST /api/projects ---
  app.post("/api/projects", async (req, reply) => {
    const body = parseBody(ZNewProject, req.body);
    if (!body.ok) return replyWith(reply, body);
    const slug = body.value.slug;
    if (index.projects.some((p) => p.id === slug)) {
      return sendErr(reply, { code: E_CONFLICT, message: `项目 ${slug} 已存在（05-server §2.2）` });
    }
    const absPath = path.join(state.config.pmRoot, "projects", slug, "project.md");
    const created = createFile(state, absPath, projectMd(slug, body.value.name, body.value.status, body.value.period, body.value.tags));
    if (!created.ok) return sendErr(reply, created.error);
    sendOk(reply, { created: { id: slug, slug, path: absPath, mtimeMs: created.value.mtimeMs } }, 201);
  });

  // --- 05-server §2.3 GET /api/projects/:slug/overview ---
  app.get("/api/projects/:slug/overview", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const project = index.projects.find((p) => p.id === slug);
    if (!project) return sendErr(reply, notFound(slug));

    const reqs = projectRequirements(index, slug);
    const tasks = projectTasks(index, slug);

    const reqByStatus: Record<string, number> = {};
    for (const r of reqs) reqByStatus[r.status] = (reqByStatus[r.status] ?? 0) + 1;
    const taskByStatus: Record<string, number> = {};
    let overdue = 0;
    let onTrack = 0;
    const t0 = today();
    for (const t of tasks) {
      taskByStatus[t.status] = (taskByStatus[t.status] ?? 0) + 1;
      if (t.status === "todo" || t.status === "doing") {
        if (t.due < t0) overdue++;
        else onTrack++;
      }
    }
    const doneReqs = reqs.filter((r) => r.status === "done").length;

    sendOk(reply, {
      project: { ...project, mtimeMs: mtimeOfRel(index, `projects/${slug}/project.md`) },
      progress: deriveStats(index).projects.find((s) => s.slug === slug)?.progress ?? {
        completedRate: 0,
        overdueCount: 0,
        totalTasks: 0,
        doneTasks: 0,
        cancelledTasks: 0,
        onTrack: 0,
      },
      totals: {
        requirements: { total: reqs.length, byStatus: reqByStatus },
        tasks: { total: tasks.length, overdue, byStatus: taskByStatus, onTrack },
      },
      periods: { done: doneReqs, total: reqs.length, rate: reqs.length === 0 ? 0 : doneReqs / reqs.length },
      lastSync: index.builtAt,
    });
  });

  // --- 05-server §2.4 GET /api/projects/:slug/requirements ---
  app.get("/api/projects/:slug/requirements", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!index.projects.some((p) => p.id === slug)) return sendErr(reply, notFound(slug));
    const requirements = projectRequirements(index, slug).map((r) => ({
      ...r,
      mtimeMs: mtimeOfRel(index, `projects/${slug}/requirements/${r.id}.md`),
    }));
    const prefix = `projects/${slug}/`;
    const brokenFiles = index.broken
      .filter((b) => b.file.relPath.startsWith(prefix))
      .map((b) => ({
        file: b.file.relPath,
        field: b.issues[0]?.path,
        code: b.issues[0]?.code ?? "E_VALIDATION",
        message: b.issues[0]?.message ?? "",
      }));
    sendOk(reply, { requirements, ...(brokenFiles.length > 0 ? { brokenFiles } : {}) });
  });

  // --- 05-server §2.5 POST /api/projects/:slug/requirements ---
  app.post("/api/projects/:slug/requirements", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = parseBody(ZNewRequirement, req.body);
    if (!body.ok) return replyWith(reply, body);
    if (!index.projects.some((p) => p.id === slug)) return sendErr(reply, notFound(slug));

    const idRes = allocateId(index, "REQ", slug);
    if (!idRes.ok) return sendErr(reply, idRes.error);
    const id = idRes.value;

    const created = body.value.created ?? today();
    const updated = body.value.updated ?? created; // 覆盖 created 时保持 updated ≥ created（01-数据规范 §1.2）
    const absPath = path.join(state.config.pmRoot, "projects", slug, "requirements", `${id}.md`);
    const w = createFile(state, absPath, requirementMd(id, body.value.title, body.value.status, body.value.priority, body.value.module, body.value.source, created, updated));
    if (!w.ok) return sendErr(reply, w.error);
    sendOk(reply, { id, path: absPath, mtimeMs: w.value.mtimeMs }, 201);
  });

  // --- 05-server §2.6 GET /api/requirements/:id（反链聚合 01-数据规范 §6.3） ---
  app.get("/api/requirements/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const requirement = index.requirements.find((r) => r.id === id);
    if (!requirement) return sendErr(reply, notFound(id));
    const relatedTasks = (index.requirementTasks.get(id) ?? [])
      .map((tid) => index.tasks.find((t) => t.id === tid))
      .filter((t): t is Task => t !== undefined);
    sendOk(reply, {
      requirement: { ...requirement, mtimeMs: mtimeOfRel(index, `projects/${slugOfId(id)}/requirements/${id}.md`) },
      relatedTasks,
    });
  });

  // --- 05-server §2.7 PATCH /api/requirements/:id ---
  app.patch("/api/requirements/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(ZPatchRequirement, req.body);
    if (!body.ok) return replyWith(reply, body);
    replyWith(reply, await patchStatus(state, id, body.value));
  });

  // --- 05-server §2.8 POST /api/requirements/:id/derive-task ---
  app.post("/api/requirements/:id/derive-task", async (req, reply) => {
    const { id } = req.params as { id: string };
    const requirement = index.requirements.find((r) => r.id === id);
    if (!requirement) return sendErr(reply, notFound(id));
    if (requirement.status !== "accepted") {
      return sendErr(reply, {
        code: E_INVALID_TRANSITION,
        message: `需求状态为 ${requirement.status}，仅 accepted 需求可派生任务（05-server §2.8）`,
        field: "status",
      });
    }
    const body = parseBody(ZDeriveTask, req.body);
    if (!body.ok) return replyWith(reply, body);

    const slug = slugOfId(requirement.id);
    const idRes = allocateId(index, "TASK", slug);
    if (!idRes.ok) return sendErr(reply, idRes.error);
    const taskId = idRes.value;

    const due = body.value.due ?? addDays(today(), 7); // 默认 today + 1 周（Q-07）
    const title = body.value.title ?? requirement.title;
    const absPath = path.join(state.config.pmRoot, "projects", slug, "tasks", `${taskId}.md`);
    const w = createFile(state, absPath, taskMd(taskId, title, "todo", `[[${requirement.id}]]`, requirement.priority, due, today(), today()));
    if (!w.ok) return sendErr(reply, w.error);

    const task = index.tasks.find((t) => t.id === taskId);
    sendOk(
      reply,
      {
        requirementId: requirement.id,
        task: task ? { ...task, mtimeMs: w.value.mtimeMs } : undefined,
        created: { id: taskId, path: absPath },
      },
      201,
    );
  });

  // --- 05-server §3.1 GET /api/projects/:slug/tasks ---
  app.get("/api/projects/:slug/tasks", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!index.projects.some((p) => p.id === slug)) return sendErr(reply, notFound(slug));
    const tasks = projectTasks(index, slug).map((t) => ({
      ...t,
      mtimeMs: mtimeOfRel(index, `projects/${slug}/tasks/${t.id}.md`),
    }));
    sendOk(reply, { tasks });
  });

  // --- 05-server §3.2 POST /api/projects/:slug/tasks（外键校验 §3.1 dangling 规则） ---
  app.post("/api/projects/:slug/tasks", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = parseBody(ZNewTask, req.body);
    if (!body.ok) return replyWith(reply, body);

    const targetId = parseWikiLinks(body.value.requirement)[0] ?? "";
    if (!index.requirements.some((r) => r.id === targetId)) {
      return sendErr(reply, {
        code: "E_VALIDATION",
        message: `requirement ${targetId} 不存在（01-数据规范 §6.2, R-108）`,
        field: "requirement",
      });
    }
    if (slugOfId(targetId) !== slug) {
      return sendErr(reply, {
        code: "E_VALIDATION",
        message: `requirement ${targetId} 不属于项目 ${slug}（跨项目，01-数据规范 §6.2）`,
        field: "requirement",
      });
    }
    if (!index.projects.some((p) => p.id === slug)) return sendErr(reply, notFound(slug));

    const idRes = allocateId(index, "TASK", slug);
    if (!idRes.ok) return sendErr(reply, idRes.error);
    const id = idRes.value;

    const now = today();
    const absPath = path.join(state.config.pmRoot, "projects", slug, "tasks", `${id}.md`);
    const w = createFile(state, absPath, taskMd(id, body.value.title, body.value.status, `[[${targetId}]]`, body.value.priority, body.value.due, now, now));
    if (!w.ok) return sendErr(reply, w.error);

    const task = index.tasks.find((t) => t.id === id);
    sendOk(reply, { created: { id, path: absPath, mtimeMs: w.value.mtimeMs }, task }, 201);
  });

  // --- 05-server §3.3 PATCH /api/tasks/:id ---
  app.patch("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(ZPatchTask, req.body);
    if (!body.ok) return replyWith(reply, body);
    replyWith(reply, await patchStatus(state, id, body.value));
  });

  // --- 05-server §3.4 GET /api/tasks/:id（反向查询 01-数据规范 §6.1） ---
  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = index.tasks.find((t) => t.id === id);
    if (!task) return sendErr(reply, notFound(id));
    const targetId = parseWikiLinks(task.requirement)[0];
    const relatedRequirement = targetId ? index.requirements.find((r) => r.id === targetId) : undefined;
    sendOk(reply, {
      task: { ...task, mtimeMs: mtimeOfRel(index, `projects/${slugOfId(id)}/tasks/${id}.md`) },
      relatedRequirement: relatedRequirement
        ? { ...relatedRequirement, mtimeMs: mtimeOfRel(index, `projects/${slugOfId(relatedRequirement.id)}/requirements/${relatedRequirement.id}.md`) }
        : undefined,
    });
  });

  // --- 05-server §4.1 GET /api/search?q= ---
  app.get("/api/search", async (req, reply) => {
    const q = parseSearchQuery(req.query as Record<string, unknown>);
    if (!q.ok) return replyWith(reply, q);
    const results = search(index, q.value.q).filter((r) => q.value.type === undefined || r.type === q.value.type).slice(0, q.value.limit);
    sendOk(reply, { results });
  });

  // --- 05-server §5.1 GET /api/events（SSE，hijack 原始流） ---
  app.get("/api/events", (_req, reply) => {
    reply.hijack();
    state.hub.addClient(reply.raw);
  });
}
