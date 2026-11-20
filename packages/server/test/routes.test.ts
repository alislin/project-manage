import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  makeVaultRoot,
  writePmFile,
  readPmFile,
  pmPath,
  rmRetry,
  buildTestServer,
  teardownServer,
  waitMtimeChange,
  waitFor,
  sleep,
  today,
  shiftDays,
  PROJECT_MD_WEB,
  reqMd,
  taskMd,
  type BuiltServer,
} from "./helpers";

/** TC-05 · REST API 用例（P0 全覆盖 + P1/P2 补充；05-server §1–§6；fastify inject） */

describe("TC-05 REST API", () => {
  let root: string;
  let vault: string;
  let built: BuiltServer;

  afterEach(async () => {
    if (built) await teardownServer(built);
    if (root) rmRetry(root);
  });

  async function newServer(seed?: (vaultPath: string) => void): Promise<void> {
    root = makeVaultRoot("pm-server-routes-");
    vault = path.join(root, "vault");
    seed?.(vault);
    built = await buildTestServer(root);
  }

  const seedWeb = (opts?: { reqStatus?: string; withTask?: boolean; taskStatus?: string; taskDue?: string }) =>
    (v: string): void => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", opts?.reqStatus ?? "pool"));
      if (opts?.withTask) {
        writePmFile(
          v,
          "projects/web/tasks/TASK-web-001.md",
          taskMd("TASK-web-001", opts.taskStatus ?? "todo", opts.taskDue ?? shiftDays(10)),
        );
      }
    };

  /** 仅播种项目（POST 创建类用例：编号从 REQ-web-001 分配） */
  const seedProjectOnly =
    (v: string): void => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
    };

  /** 从需求列表响应取 REQ-web-001 的 mtimeMs（冲突检测基准 M0） */
  async function getReqMtime(): Promise<number> {
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/requirements" });
    const body = JSON.parse(res.body) as { data: { requirements: Array<{ id: string; mtimeMs: number }> } };
    return body.data.requirements.find((r) => r.id === "REQ-web-001")!.mtimeMs;
  }

  async function getTaskMtime(): Promise<number> {
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/tasks" });
    const body = JSON.parse(res.body) as { data: { tasks: Array<{ id: string; mtimeMs: number }> } };
    return body.data.tasks.find((t) => t.id === "TASK-web-001")!.mtimeMs;
  }

  // ----- 项目端点（05-server §2.1–§2.3） -----

  it("TC-05-001: GET /api/projects 含聚合统计 progress（P0）", async () => {
    await newServer(seedWeb({ withTask: true, taskDue: shiftDays(10) }));
    const res = await built.app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { projects: Array<Record<string, unknown>> } };
    expect(body.ok).toBe(true);
    expect(body.data.projects).toHaveLength(1);
    const p = body.data.projects[0];
    expect(p).toMatchObject({ slug: "web", name: "Web 平台", status: "active", period: ["2026-01-01", "2026-12-31"], tags: ["a"] });
    expect(p.progress).toEqual({
      completedRate: 0,
      overdueCount: 0,
      totalTasks: 1,
      doneTasks: 0,
      cancelledTasks: 0,
      onTrack: 1,
    });
    expect(typeof p.mtimeMs).toBe("number");
    expect((p.mtimeMs as number)).toBeGreaterThan(0);
  });

  it("TC-05-002: GET /api/projects 空 vault → projects=[]（P1）", async () => {
    await newServer();
    const res = await built.app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { projects: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.projects).toEqual([]);
  });

  it("TC-05-003: POST /api/projects 201，created.id=slug（R-110，P0）", async () => {
    await newServer();
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { slug: "web", name: "Web", period: ["2026-01-01", "2026-12-31"], tags: ["a"] },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      data: { created: { id: string; slug: string; path: string; mtimeMs: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.created).toMatchObject({ id: "web", slug: "web" });
    expect(body.data.created.mtimeMs).toBeGreaterThan(0);
    expect(fs.existsSync(body.data.created.path)).toBe(true); // project.md 生成
    expect(fs.readFileSync(body.data.created.path, "utf8")).toContain('id: "web"');
  });

  it("TC-05-004: POST /api/projects 缺 name → 400 E_USAGE（P1）", async () => {
    await newServer();
    const res = await built.app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("E_USAGE");
  });

  it("TC-05-005: POST /api/projects 非法 slug → 422 E_VALIDATION field=slug（P1）", async () => {
    await newServer();
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "x", slug: "a--b", period: ["2026-01-01", "2026-12-31"] },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("E_VALIDATION");
    expect(body.error.field).toBe("slug");
  });

  it("TC-05-006: POST /api/projects 重复 slug → 409 E_CONFLICT（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { slug: "web", name: "Web 2", period: ["2026-01-01", "2026-12-31"] },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("E_CONFLICT");
  });

  it("TC-05-007: GET /api/projects/:slug/overview 项目进度总览（P0）", async () => {
    await newServer((v) => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "done"));
      writePmFile(v, "projects/web/requirements/REQ-web-002.md", reqMd("REQ-web-002", "pool", "需求二"));
      writePmFile(v, "projects/web/tasks/TASK-web-001.md", taskMd("TASK-web-001", "done", shiftDays(-1)));
      writePmFile(v, "projects/web/tasks/TASK-web-002.md", taskMd("TASK-web-002", "todo", shiftDays(-1), "REQ-web-002", "任务二"));
    });
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/overview" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: Record<string, any> };
    expect(body.ok).toBe(true);
    expect(body.data.project).toMatchObject({ id: "web", name: "Web 平台" });
    expect(body.data.project.mtimeMs).toBeGreaterThan(0);
    expect(body.data.totals.requirements).toEqual({
      total: 2,
      byStatus: expect.objectContaining({ pool: 1, done: 1 }),
    });
    expect(body.data.totals.tasks).toEqual({
      total: 2,
      overdue: 1, // todo 且 due < today（02-core §2.4）
      byStatus: expect.objectContaining({ done: 1, todo: 1 }),
      onTrack: 0,
    });
    expect(body.data.periods).toEqual({ done: 1, total: 2, rate: 0.5 }); // 需求交付漏斗
    expect(typeof body.data.lastSync).toBe("string");
  });

  it("TC-05-008: GET /api/projects/nope/overview → 404 E_NOT_FOUND（P1）", async () => {
    await newServer();
    const res = await built.app.inject({ method: "GET", url: "/api/projects/nope/overview" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("E_NOT_FOUND");
  });

  // ----- 需求端点（05-server §2.4–§2.7） -----

  it("TC-05-009: GET /api/projects/:slug/requirements 需求池列表（P0）", async () => {
    await newServer((v) => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "pool"));
      // broken 文件：frontmatter 非法（01-数据规范 §2.2 降级可见）
      writePmFile(v, "projects/web/requirements/broken.md", "---\ntype: requirement\nid: 123\n---\n");
    });
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/requirements" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { requirements: Array<Record<string, unknown>>; brokenFiles?: Array<Record<string, unknown>> } };
    expect(body.ok).toBe(true);
    expect(body.data.requirements).toHaveLength(1);
    expect(body.data.requirements[0]).toMatchObject({ id: "REQ-web-001", status: "pool" });
    expect(body.data.requirements[0].mtimeMs).toBeGreaterThan(0);
    expect(body.data.brokenFiles).toBeDefined();
    expect(body.data.brokenFiles![0].file).toContain("broken.md");
  });

  it("TC-05-010: POST /api/projects/:slug/requirements 201，id=REQ-web-001（P0）", async () => {
    await newServer(seedProjectOnly);
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/requirements",
      payload: { title: "需求一", source: "inbox:1", module: "auth", priority: "P2" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string; path: string; mtimeMs: number } };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("REQ-web-001");
    expect(body.data.mtimeMs).toBeGreaterThan(0);
    expect(fs.existsSync(body.data.path)).toBe(true);
  });

  it("TC-05-011: POST requirements 缺 title → 400 E_USAGE（P1）", async () => {
    await newServer(seedProjectOnly);
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/requirements",
      payload: { source: "human" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("E_USAGE");
  });

  it("TC-05-012: POST requirements 默认 status=pool（R-112，P0）", async () => {
    await newServer(seedProjectOnly);
    await built.app.inject({
      method: "POST",
      url: "/api/projects/web/requirements",
      payload: { title: "需求二", source: "human" },
    });
    const detail = await built.app.inject({ method: "GET", url: "/api/requirements/REQ-web-001" });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).data.requirement.status).toBe("pool");
  });

  it("TC-05-013: GET /api/requirements/:id 含反链 relatedTasks（P0）", async () => {
    await newServer((v) => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "accepted"));
      writePmFile(v, "projects/web/tasks/TASK-web-001.md", taskMd("TASK-web-001", "todo", shiftDays(10)));
      writePmFile(v, "projects/web/tasks/TASK-web-002.md", taskMd("TASK-web-002", "todo", shiftDays(10)));
    });
    const res = await built.app.inject({ method: "GET", url: "/api/requirements/REQ-web-001" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { requirement: Record<string, unknown>; relatedTasks: Array<{ id: string }> } };
    expect(body.ok).toBe(true);
    expect(body.data.requirement).toMatchObject({ id: "REQ-web-001" });
    expect(body.data.requirement.mtimeMs).toBeGreaterThan(0);
    expect(body.data.relatedTasks.map((t) => t.id)).toEqual(["TASK-web-001", "TASK-web-002"]); // TASK id 升序
  });

  it("TC-05-014: GET /api/requirements/REQ-web-999 → 404 E_NOT_FOUND（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({ method: "GET", url: "/api/requirements/REQ-web-999" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("E_NOT_FOUND");
  });

  it("TC-05-015: PATCH /api/requirements/:id pool→reviewing（P0）", async () => {
    await newServer(seedWeb());
    const m0 = await getReqMtime();
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/requirements/REQ-web-001",
      payload: { status: "reviewing", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { id: string; from: string; to: string; updatedField: string; mtimeMs: number } };
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ id: "REQ-web-001", from: "pool", to: "reviewing", updatedField: "updated" });
    expect(body.data.mtimeMs).toBeGreaterThan(0);
    const content = readPmFile(vault, "projects/web/requirements/REQ-web-001.md");
    expect(content).toContain("status: reviewing");
    // 副作用 updated=<today>（gray-matter 回写为单引号 YAML 标量，断言兼容两种引号）
    expect(content).toMatch(new RegExp(`updated: ['"]${today()}['"]`));
  });

  it("TC-05-016: PATCH 非法流转 pool→done → 409 E_INVALID_TRANSITION（P1）", async () => {
    await newServer(seedWeb());
    const m0 = await getReqMtime();
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/requirements/REQ-web-001",
      payload: { status: "done", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("E_INVALID_TRANSITION");
    expect(readPmFile(vault, "projects/web/requirements/REQ-web-001.md")).toContain("status: pool"); // 未写入
  });

  it("TC-05-017: PATCH 缺 status → 400 E_USAGE（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({ method: "PATCH", url: "/api/requirements/REQ-web-001", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("E_USAGE");
  });

  it("TC-05-018: PATCH mtime 冲突 409 + 刷新重试恢复（并发，P1）", async () => {
    await newServer(seedWeb());
    const m0 = await getReqMtime();
    await sleep(400); // 等 chokidar 初始化完成（初始化窗口内的写入事件会被丢弃，core 测试同款缓冲）
    // 1) 外部修改（Obsidian 语义：绕过 server 直接写盘）
    const abs = pmPath(vault, "projects/web/requirements/REQ-web-001.md");
    fs.appendFileSync(abs, "\n外部修改内容\n");
    const actual = await waitMtimeChange(abs, m0);
    // 2) 以过期基准 PATCH → 409 E_CONFLICT + expectedMtimeMs/currentMtimeMs（05-server §6.4）
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/requirements/REQ-web-001",
      payload: { status: "reviewing", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { ok: boolean; error: { code: string; expectedMtimeMs?: number; currentMtimeMs?: number } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("E_CONFLICT");
    expect(body.error.expectedMtimeMs).toBe(m0);
    expect(body.error.currentMtimeMs).toBe(actual);
    // 外部内容未被覆盖（05-server §6.1 步骤 3）
    expect(readPmFile(vault, "projects/web/requirements/REQ-web-001.md")).toContain("外部修改内容");
    // 3) 前端刷新后以新基准重试（§6.1 步骤 5）→ 200（等待 watcher 防抖后索引刷新）
    await waitFor(async () => (await getReqMtime()) !== m0);
    const m2 = await getReqMtime();
    const retry = await built.app.inject({
      method: "PATCH",
      url: "/api/requirements/REQ-web-001",
      payload: { status: "reviewing", expectedMtimeMs: m2 },
    });
    expect(retry.statusCode).toBe(200);
    expect(JSON.parse(retry.body).data.to).toBe("reviewing");
  });

  // ----- derive-task（05-server §2.8） -----

  it("TC-05-019: derive-task 默认 due=today+7、status=todo（Q-07，P0）", async () => {
    await newServer(seedWeb({ reqStatus: "accepted" }));
    const res = await built.app.inject({ method: "POST", url: "/api/requirements/REQ-web-001/derive-task", payload: {} });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      data: { requirementId: string; task: { id: string; status: string; due: string; priority: string }; created: { id: string; path: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.requirementId).toBe("REQ-web-001");
    expect(body.data.task).toMatchObject({ id: "TASK-web-001", status: "todo", due: shiftDays(7), priority: "P2" });
    expect(fs.existsSync(body.data.created.path)).toBe(true);
  });

  it("TC-05-020: derive-task 非 accepted → 409 E_INVALID_TRANSITION（P1）", async () => {
    await newServer(seedWeb({ reqStatus: "pool" }));
    const res = await built.app.inject({ method: "POST", url: "/api/requirements/REQ-web-001/derive-task", payload: {} });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("E_INVALID_TRANSITION");
  });

  it("TC-05-021: derive-task 编号耗尽 → 409 E_SEQ_EXHAUSTED（P2）", async () => {
    await newServer((v) => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "pool"));
      writePmFile(v, "projects/web/requirements/REQ-web-002.md", reqMd("REQ-web-002", "accepted", "需求二"));
      writePmFile(v, "projects/web/tasks/TASK-web-999.md", taskMd("TASK-web-999", "todo", shiftDays(10)));
    });
    const res = await built.app.inject({ method: "POST", url: "/api/requirements/REQ-web-002/derive-task", payload: {} });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("E_SEQ_EXHAUSTED");
  });

  it("TC-05-041: derive-task 自定义 due 与 title 覆盖（P2）", async () => {
    await newServer(seedWeb({ reqStatus: "accepted" }));
    const res = await built.app.inject({
      method: "POST",
      url: "/api/requirements/REQ-web-001/derive-task",
      payload: { title: "自定义任务", due: "2026-12-31" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { data: { task: { title: string; due: string } } };
    expect(body.data.task).toMatchObject({ title: "自定义任务", due: "2026-12-31" });
  });

  // ----- 任务端点（05-server §3） -----

  it("TC-05-022: GET /api/projects/:slug/tasks 任务列表（P0）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/tasks" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { tasks: Array<Record<string, unknown>> } };
    expect(body.ok).toBe(true);
    expect(body.data.tasks).toHaveLength(1);
    expect(body.data.tasks[0]).toMatchObject({ id: "TASK-web-001", status: "todo" });
    expect(body.data.tasks[0].mtimeMs).toBeGreaterThan(0);
  });

  it("TC-05-023: GET tasks 项目无任务 → tasks=[]（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({ method: "GET", url: "/api/projects/web/tasks" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.tasks).toEqual([]);
  });

  it("TC-05-024: POST /api/projects/:slug/tasks 201（P0）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/tasks",
      payload: { title: "任务一", requirement: "[[REQ-web-001]]", due: "2026-11-30", priority: "P1" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      data: { created: { id: string; path: string; mtimeMs: number }; task: Record<string, unknown> };
    };
    expect(body.ok).toBe(true);
    expect(body.data.created).toMatchObject({ id: "TASK-web-001" });
    expect(body.data.created.mtimeMs).toBeGreaterThan(0);
    expect(body.data.task).toMatchObject({ title: "任务一", requirement: "[[REQ-web-001]]", priority: "P1", due: "2026-11-30", status: "todo" });
    expect(fs.existsSync(body.data.created.path)).toBe(true);
  });

  it("TC-05-025: POST tasks requirement 目标不存在 → 422 E_VALIDATION（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/tasks",
      payload: { title: "任务一", requirement: "[[REQ-web-999]]", due: "2026-11-30" },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe("E_VALIDATION");
    expect(body.error.field).toBe("requirement");
  });

  it("TC-05-026: POST tasks 缺 due → E_USAGE（Q-02 due 必填，P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/tasks",
      payload: { title: "任务一", requirement: "[[REQ-web-001]]" },
    });
    // 缺字段 → E_USAGE（05-server §1.2 映射 400；TC 文档 422/E_USAGE 二选一中的 E_USAGE 分支）
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("E_USAGE");
  });

  it("TC-05-027: PATCH /api/tasks/:id todo→doing（P0）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const m0 = await getTaskMtime();
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/tasks/TASK-web-001",
      payload: { status: "doing", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: string; from: string; to: string; updatedField: string; mtimeMs: number } };
    expect(body.data).toMatchObject({ id: "TASK-web-001", from: "todo", to: "doing", updatedField: "updated" });
    expect(readPmFile(vault, "projects/web/tasks/TASK-web-001.md")).toContain("status: doing");
  });

  it("TC-05-028: PATCH /api/tasks/TASK-web-999 → 404 E_NOT_FOUND（P1）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const res = await built.app.inject({ method: "PATCH", url: "/api/tasks/TASK-web-999", payload: { status: "doing" } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("E_NOT_FOUND");
  });

  it("TC-05-029: PATCH tasks 非法流转 doing→todo → 409（P1）", async () => {
    await newServer(seedWeb({ withTask: true, taskStatus: "doing" }));
    const m0 = await getTaskMtime();
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/tasks/TASK-web-001",
      payload: { status: "todo", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("E_INVALID_TRANSITION");
    expect(readPmFile(vault, "projects/web/tasks/TASK-web-001.md")).toContain("status: doing");
  });

  it("TC-05-030: PATCH tasks mtime 冲突 → 409 E_CONFLICT（并发，P1）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const m0 = await getTaskMtime();
    const abs = pmPath(vault, "projects/web/tasks/TASK-web-001.md");
    fs.appendFileSync(abs, "\n外部修改内容\n");
    await waitMtimeChange(abs, m0);
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/tasks/TASK-web-001",
      payload: { status: "doing", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: { code: string; expectedMtimeMs?: number; currentMtimeMs?: number } };
    expect(body.error.code).toBe("E_CONFLICT");
    expect(body.error.expectedMtimeMs).toBe(m0);
    expect(typeof body.error.currentMtimeMs).toBe("number");
    expect(readPmFile(vault, "projects/web/tasks/TASK-web-001.md")).toContain("外部修改内容");
  });

  it("TC-05-031: PATCH todo→done 设置 completed=今天（P0）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const m0 = await getTaskMtime();
    const res = await built.app.inject({
      method: "PATCH",
      url: "/api/tasks/TASK-web-001",
      payload: { status: "done", expectedMtimeMs: m0 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { updatedField: string } };
    expect(body.data.updatedField).toBe("updated+completed");
    const content = readPmFile(vault, "projects/web/tasks/TASK-web-001.md");
    expect(content).toContain("status: done");
    expect(content).toMatch(new RegExp(`completed: ['"]${today()}['"]`));
  });

  it("TC-05-032: GET /api/tasks/:id 含 relatedRequirement（P0）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const res = await built.app.inject({ method: "GET", url: "/api/tasks/TASK-web-001" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { task: Record<string, unknown>; relatedRequirement?: Record<string, unknown> } };
    expect(body.ok).toBe(true);
    expect(body.data.task).toMatchObject({ id: "TASK-web-001" });
    expect(body.data.task.mtimeMs).toBeGreaterThan(0);
    expect(body.data.relatedRequirement).toMatchObject({ id: "REQ-web-001" });
  });

  it("TC-05-033: GET /api/tasks/TASK-web-999 → 404 E_NOT_FOUND（P1）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const res = await built.app.inject({ method: "GET", url: "/api/tasks/TASK-web-999" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("E_NOT_FOUND");
  });

  // ----- 检索（05-server §4.1） -----

  it("TC-05-034: GET /api/search?q=web 命中全部类型（P0）", async () => {
    await newServer(seedWeb({ withTask: true }));
    const res = await built.app.inject({ method: "GET", url: "/api/search?q=web" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; data: { results: Array<{ id: string; type: string; slug: string; relPath: string; title: string }> } };
    expect(body.ok).toBe(true);
    const types = body.data.results.map((r) => r.type);
    expect(types).toContain("project");
    expect(types).toContain("requirement");
    expect(types).toContain("task");
    for (const r of body.data.results) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("slug");
      expect(r).toHaveProperty("relPath");
      expect(r).toHaveProperty("title");
    }
  });

  it("TC-05-034b: GET /api/search type 过滤与 limit（P1）", async () => {
    await newServer((v) => {
      writePmFile(v, "projects/web/project.md", PROJECT_MD_WEB);
      writePmFile(v, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "pool"));
      writePmFile(v, "projects/web/requirements/REQ-web-002.md", reqMd("REQ-web-002", "pool", "需求二"));
      writePmFile(v, "projects/web/requirements/REQ-web-003.md", reqMd("REQ-web-003", "pool", "需求三"));
    });
    const res = await built.app.inject({ method: "GET", url: "/api/search?q=web&type=requirement&limit=2" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { results: Array<{ type: string; id: string }> } };
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results.every((r) => r.type === "requirement")).toBe(true);
  });

  it("TC-05-035: GET /api/search?q=（空）→ 400 E_USAGE（P1）", async () => {
    await newServer(seedWeb());
    const res = await built.app.inject({ method: "GET", url: "/api/search?q=" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("E_USAGE");
  });

  // ----- 信封与校验（05-server §1.1 / §1.2） -----

  it("TC-05-038: 错误信封统一 {ok:false, error:{code,message}}（R-115，P1）", async () => {
    await newServer();
    const res = await built.app.inject({ method: "GET", url: "/api/projects/nope/overview" });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("E_NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });

  it("TC-05-040: POST requirements title 空串 → 422 E_VALIDATION（P2）", async () => {
    await newServer(seedProjectOnly);
    const res = await built.app.inject({
      method: "POST",
      url: "/api/projects/web/requirements",
      payload: { title: "", source: "x" },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe("E_VALIDATION");
  });

  it("API 未知路径 → 404 信封 E_NOT_FOUND（05-server §1.1）", async () => {
    await newServer();
    const res = await built.app.inject({ method: "GET", url: "/api/unknown" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("E_NOT_FOUND");
  });
});
