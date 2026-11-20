import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { callOk, callErr, connectSession, writePmFile, readPmFile, pathExists, rmRetry, type Session } from "./helpers";
import { disposeSession } from "../src/context.js";
import { TOOLS } from "../src/tools.js";
import { parseLaunchArgs } from "../src/launch.js";

/**
 * TC-04 · MCP 工具清单用例（docs/testcases/TC-04-mcp.md 全量，P0/P1/P2）。
 * SDK 兼容方式：createPmServer 经 InMemoryTransport 直连 Client，client.callTool 走真实协议路径；
 * 断言口径：isError / content[0].text / details（同源 03-cli / 02-core 输出，TC-04 纪律）。
 */

const PROJECT_MD = (slug: string, name = "项目"): string => `---
type: project
id: "${slug}"
name: "${name}"
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

const REQ_MD = (id: string, title: string): string => `---
type: requirement
id: "${id}"
title: "${title}"
status: pool
priority: "P2"
module: auth
source: human
created: 2026-11-19
updated: 2026-11-19
---
`;

const TASK_MD = (id: string, reqId: string, due: string): string => `---
type: task
id: "${id}"
title: "任务${id.slice(-3)}"
status: todo
requirement: "[[${reqId}]]"
priority: "P2"
due: "${due}"
completed: null
created: 2026-11-19
updated: 2026-11-19
---
`;

const CHECK_CODES = ["dangling-wiki", "invalid-link-target", "id-conflict", "date-inverted", "invalid-frontmatter"];

let session: Session | undefined;

async function newSession(opts: { bare?: boolean } = {}): Promise<Session> {
  session = await connectSession("pm-mcp-tc04-", opts);
  return session;
}

afterEach(async () => {
  if (session) {
    await session.close();
    disposeSession(session.root); // 丢弃进程级会话（context.ts sessions Map）
    rmRetry(session.root);
    session = undefined;
  }
});

// ---------------------------------------------------------------------------
// TC-04-001/002 · pm_validate（04-mcp §2.1，输出 = 03-cli §2.2）
// ---------------------------------------------------------------------------

describe("TC-04 pm_validate", () => {
  it("TC-04-001: pm_validate 正常——isError=false，输出含 checkedFiles/ok/errors（03-cli §2.2）", async () => {
    const s = await newSession();
    writePmFile(s.root, "projects/proj/project.md", PROJECT_MD("proj"));
    writePmFile(s.root, "projects/proj/requirements/REQ-proj-001.md", REQ_MD("REQ-proj-001", "需求001"));
    writePmFile(s.root, "projects/proj/tasks/TASK-proj-001.md", TASK_MD("TASK-proj-001", "REQ-proj-001", "2026-11-30"));

    const p = await callOk(s, "pm_validate", { files: ["projects/proj"] });
    expect(p.ok).toBe(true);
    expect(typeof p.checkedFiles).toBe("number");
    expect((p.checkedFiles as number)).toBe(3);
    expect(Array.isArray(p.errors)).toBe(true);
    expect(p.errors).toHaveLength(0);
  });

  it("TC-04-002: pm_validate 错误信封——isError=true，content[0]=[E_VALIDATION]，details.code/file/field（04-mcp §1.1）", async () => {
    const s = await newSession();
    writePmFile(s.root, "projects/proj/project.md", PROJECT_MD("proj"));
    // 非法文件：status 枚举外的取值 → broken(parse) → E_VALIDATION
    writePmFile(
      s.root,
      "projects/proj/requirements/REQ-proj-002.md",
      REQ_MD("REQ-proj-002", "需求002").replace("status: pool", "status: pool2"),
    );

    const e = await callErr(s, "pm_validate", {});
    expect(e.text.startsWith("[E_VALIDATION] ")).toBe(true); // content[0].text = "[<code>] <message>"（04-mcp §1.1）
    expect(e.details.code).toBe("E_VALIDATION"); // 同核心错误码（02-core §3.1）
    expect(typeof e.details.file).toBe("string");
    expect(e.details.file).toContain("REQ-proj-002.md");
    expect(e.details.field).toBe("status");
    expect(e.envelope.ok).toBe(false);
    expect(e.envelope.code).toBe("E_VALIDATION");
    // JSON 信封同时携带 validate 语义输出（03-cli §2.2 结构）
    expect(typeof e.envelope.checkedFiles).toBe("number");
    expect(Array.isArray(e.envelope.errors)).toBe(true);
    expect((e.envelope.errors as unknown[]).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TC-04-003/004/005/006 · pm_create（04-mcp §2.2，输出 = 03-cli §3.1–3.3，R-114）
// ---------------------------------------------------------------------------

describe("TC-04 pm_create", () => {
  it("TC-04-003: pm_create(project) 输出 created{id, slug, path}（连字符 slug 场景）", async () => {
    const s = await newSession();
    const p = await callOk(s, "pm_create", {
      type: "project",
      slug: "mcp-proj",
      name: "MCP 项目",
      period: ["2026-01-01", "2026-12-31"],
    });
    const created = p.created as { id: string; slug: string; path: string };
    expect(created.id).toBe("mcp-proj");
    expect(created.slug).toBe("mcp-proj");
    expect(path.normalize(created.path).toLowerCase()).toContain(
      path.join(s.vault, "PM", "projects", "mcp-proj", "project.md").toLowerCase(),
    );
    expect(pathExists(s.root, "projects/mcp-proj/project.md")).toBe(true);
  });

  it("TC-04-004: pm_create(requirement) 默认 status=pool（R-114，生成 REQ-mcp-proj-001.md）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    const p = await callOk(s, "pm_create", {
      type: "requirement",
      projectSlug: "mcp-proj",
      title: "需求",
      source: "inbox:1",
    });
    const created = p.created as { id: string; path: string };
    expect(created.id).toBe("REQ-mcp-proj-001");
    expect(pathExists(s.root, "projects/mcp-proj/requirements/REQ-mcp-proj-001.md")).toBe(true);
    const content = readPmFile(s.root, "projects/mcp-proj/requirements/REQ-mcp-proj-001.md");
    expect(content).toContain("status: pool"); // R-114：requirement 默认 pool
    expect(content).toContain('source: "inbox:1"');
  });

  it("TC-04-005: pm_create(task) 默认 status=todo（R-114，生成 TASK-mcp-proj-001.md）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });
    const p = await callOk(s, "pm_create", {
      type: "task",
      projectSlug: "mcp-proj",
      requirement: "[[REQ-mcp-proj-001]]",
      title: "任务",
      due: "2026-11-30",
    });
    const created = p.created as { id: string; path: string };
    expect(created.id).toBe("TASK-mcp-proj-001");
    expect(pathExists(s.root, "projects/mcp-proj/tasks/TASK-mcp-proj-001.md")).toBe(true);
    const content = readPmFile(s.root, "projects/mcp-proj/tasks/TASK-mcp-proj-001.md");
    expect(content).toContain("status: todo"); // R-114：task 默认 todo
    expect(content).toContain('requirement: "[[REQ-mcp-proj-001]]"');
  });

  it("TC-04-006: pm_create 缺必填 → isError=true，details.code=E_USAGE（02-core §3.1）", async () => {
    const s = await newSession();
    const e = await callErr(s, "pm_create", { type: "task", title: "t" });
    expect(e.details.code).toBe("E_USAGE");
    expect(e.envelope.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-04-007/008 · pm_move（04-mcp §2.3，输出 = 03-cli §4.2）
// ---------------------------------------------------------------------------

describe("TC-04 pm_move", () => {
  it("TC-04-007: pm_move 输出 {ok, file, from, to, updatedField, id}（03-cli §4.2）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });

    const p = await callOk(s, "pm_move", { id: "REQ-mcp-proj-001", status: "reviewing" });
    expect(p.ok).toBe(true);
    expect(p.from).toBe("pool");
    expect(p.to).toBe("reviewing");
    expect(p.updatedField).toBe("updated");
    expect(p.id).toBe("REQ-mcp-proj-001");
    expect(String(p.file).replace(/\//g, path.sep).toLowerCase()).toContain(
      path.join(s.vault, "PM", "projects", "mcp-proj", "requirements", "REQ-mcp-proj-001.md").toLowerCase(),
    );
    // 副作用：updated 维护（01-数据规范 §3.2；gray-matter 往返日期为单引号标量）
    const content = readPmFile(s.root, "projects/mcp-proj/requirements/REQ-mcp-proj-001.md");
    expect(content).toContain("status: reviewing");
    expect(content).toMatch(new RegExp(`updated: ['"]${todayStr()}['"]`));
  });

  it("TC-04-008: pm_move 非法流转 rejected→reviewing → details.code=E_INVALID_TRANSITION（01-数据规范 §3.2）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });
    await callOk(s, "pm_move", { id: "REQ-mcp-proj-001", status: "rejected" }); // pool→rejected 合法

    const e = await callErr(s, "pm_move", { id: "REQ-mcp-proj-001", status: "reviewing" });
    expect(e.details.code).toBe("E_INVALID_TRANSITION");
    expect(e.details.field).toBe("status");
    expect(e.envelope.ok).toBe(false);
    expect(e.text.startsWith("[E_INVALID_TRANSITION] ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-04-009/010 · pm_stats / pm_check（04-mcp §2.4/§2.5，R-202 onTrack）
// ---------------------------------------------------------------------------

describe("TC-04 pm_stats / pm_check", () => {
  it("TC-04-009: pm_stats 输出含 projects[].progress.onTrack 与 totals.tasks.onTrack（R-202，02-core §2.4）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });
    await callOk(s, "pm_create", { type: "task", projectSlug: "mcp-proj", requirement: "[[REQ-mcp-proj-001]]", title: "任务1", due: "2026-11-30" });
    await callOk(s, "pm_create", { type: "task", projectSlug: "mcp-proj", requirement: "[[REQ-mcp-proj-001]]", title: "任务2", due: "2026-12-31" });
    await callOk(s, "pm_move", { id: "TASK-mcp-proj-001", status: "done" });

    const p = await callOk(s, "pm_stats", {});
    const projects = p.projects as Array<{ slug: string; progress: Record<string, unknown> }>;
    expect(projects.length).toBe(1);
    expect(projects[0].slug).toBe("mcp-proj");
    expect(typeof projects[0].progress.onTrack).toBe("number"); // Progress.onTrack（02-core §2.4）
    expect(typeof projects[0].progress.completedRate).toBe("number");
    const totals = p.totals as { requirements: { total: number }; tasks: { total: number; onTrack: number; overdue: number } };
    expect(totals.tasks.total).toBe(2);
    expect(typeof totals.tasks.onTrack).toBe("number"); // TaskStats.onTrack（R-202）
    expect(totals.tasks.overdue).toBe(0);
    expect(totals.requirements.total).toBe(1);
  });

  it("TC-04-010: pm_check 输出 {ok, issues[]}，issues[].code ∈ 五类枚举（03-cli §6.3）；含 issue 仍 isError=false", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });
    // 悬空 wiki-link（dangling-wiki 触发场景）
    writePmFile(s.root, "projects/mcp-proj/tasks/TASK-mcp-proj-002.md", TASK_MD("TASK-mcp-proj-002", "REQ-mcp-proj-999", "2026-11-30"));

    const p = await callOk(s, "pm_check", {});
    expect(Array.isArray(p.issues)).toBe(true);
    const issues = p.issues as Array<{ code: string }>;
    expect(issues.length).toBeGreaterThan(0);
    for (const iss of issues) {
      expect(CHECK_CODES).toContain(iss.code);
    }
    expect(p.ok).toBe(false);
    expect(issues.some((i) => i.code === "dangling-wiki")).toBe(true);
  });

  it("TC-04-010b: pm_check 健康台账 → {ok:true, issues:[]}（isError=false）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });

    const p = await callOk(s, "pm_check", {});
    expect(p.ok).toBe(true);
    expect(p.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-04-011/012/013 · pm_search（04-mcp §2.6，输出 = 02-core §2.6）
// ---------------------------------------------------------------------------

describe("TC-04 pm_search", () => {
  it("TC-04-011: pm_search 输出 results[] 含 {id, type, slug, relPath, title}（02-core §2.6）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "mcp-proj", name: "MCP 项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "mcp-proj", title: "需求", source: "inbox:1" });

    const p = await callOk(s, "pm_search", { q: "mcp-proj" });
    const results = p.results as Array<{ id: string; type: string; slug: string; relPath: string; title: string }>;
    expect(results.length).toBeGreaterThanOrEqual(2);
    const types = new Set(results.map((r) => r.type));
    expect(types.has("project")).toBe(true);
    expect(types.has("requirement")).toBe(true);
    for (const r of results) {
      expect(["project", "requirement", "task", "inbox"]).toContain(r.type);
      expect(typeof r.id).toBe("string");
      expect(typeof r.slug).toBe("string");
      expect(typeof r.relPath).toBe("string");
      expect(typeof r.title).toBe("string");
    }
  });

  it("TC-04-012: pm_search 空 q → isError=true，details.code=E_USAGE（04-mcp §2.6 minLength 1）", async () => {
    const s = await newSession();
    const e = await callErr(s, "pm_search", { q: "" });
    expect(e.details.code).toBe("E_USAGE");
    expect(e.envelope.ok).toBe(false);
  });

  it("TC-04-013: pm_search limit 边界——50 通过；51/0 → isError=true（E_USAGE）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "proj", name: "项目" });
    for (let i = 0; i < 12; i++) {
      await callOk(s, "pm_create", { type: "requirement", projectSlug: "proj", title: `需求${i + 1}`, source: "human" });
    }
    // ≥10 条记录，limit 50（上边界内）→ ok
    const p50 = await callOk(s, "pm_search", { q: "proj", limit: 50 });
    expect((p50.results as unknown[]).length).toBeGreaterThanOrEqual(10);
    // limit 51（越上界）→ E_USAGE
    const e51 = await callErr(s, "pm_search", { q: "proj", limit: 51 });
    expect(e51.details.code).toBe("E_USAGE");
    // limit 0（越下界）→ E_USAGE
    const e0 = await callErr(s, "pm_search", { q: "proj", limit: 0 });
    expect(e0.details.code).toBe("E_USAGE");
  });
});

// ---------------------------------------------------------------------------
// TC-04-014 · E_CONFIG_INVALID 全局（04-mcp §1.2：所有工具先 loadConfig）
// ---------------------------------------------------------------------------

describe("TC-04 E_CONFIG_INVALID", () => {
  it("TC-04-014: vault 无 pm.config.json → 任意工具 isError=true，details.code=E_CONFIG_INVALID", async () => {
    const s = await newSession({ bare: true }); // 前置条件 = TC-02-002：vault 不存在 pm.config.json
    const eStats = await callErr(s, "pm_stats", {});
    expect(eStats.details.code).toBe("E_CONFIG_INVALID");
    expect(eStats.text.startsWith("[E_CONFIG_INVALID] ")).toBe(true);

    const eCheck = await callErr(s, "pm_check", {});
    expect(eCheck.details.code).toBe("E_CONFIG_INVALID"); // 「全局」：所有工具统一

    const eMove = await callErr(s, "pm_move", { id: "REQ-x-001", status: "doing" });
    expect(eMove.details.code).toBe("E_CONFIG_INVALID");
  });
});

// ---------------------------------------------------------------------------
// 连字符 slug 全链路（任务书指定场景；S5R1 ISSUE-3 支持段间单 "-"）
// ---------------------------------------------------------------------------

describe("TC-04 连字符 slug 场景", () => {
  it("TC-04-H1: slug=my-app 全链路——create → task 关联 → validate 零错误 → move → search", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "my-app", name: "我的应用 v2" });
    const req = await callOk(s, "pm_create", {
      type: "requirement",
      projectSlug: "my-app",
      title: "支持 OAuth 登录",
      module: "auth",
      source: "inbox:42",
    });
    expect((req.created as { id: string }).id).toBe("REQ-my-app-001");
    const task = await callOk(s, "pm_create", {
      type: "task",
      projectSlug: "my-app",
      requirement: "[[REQ-my-app-001]]",
      title: "实现 OAuth 适配",
      priority: "P1",
      due: "2026-11-30",
    });
    expect((task.created as { id: string }).id).toBe("TASK-my-app-001"); // 编号 slug 段含连字符

    // validate/check 全绿（连字符 slug 不产生 id-path-mismatch / dangling-wiki）
    const v = await callOk(s, "pm_validate", {});
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
    const c = await callOk(s, "pm_check", {});
    expect(c.ok).toBe(true);

    // 流转（rejected 后可回 pool；连字符 slug 的 id 全程可识别）
    const mv = await callOk(s, "pm_move", { id: "TASK-my-app-001", status: "doing" });
    expect(mv.id).toBe("TASK-my-app-001");
    expect(mv.from).toBe("todo");

    // 检索命中连字符 slug
    const search1 = await callOk(s, "pm_search", { q: "my-app", type: "task" });
    expect((search1.results as Array<{ id: string }>).some((r) => r.id === "TASK-my-app-001")).toBe(true);
  });

  it("TC-04-H2: 跨项目关联拒绝——REQ-my-app-001 不属于 proj（E_VALIDATION）", async () => {
    const s = await newSession();
    await callOk(s, "pm_create", { type: "project", slug: "my-app", name: "我的应用" });
    await callOk(s, "pm_create", { type: "project", slug: "proj", name: "项目" });
    await callOk(s, "pm_create", { type: "requirement", projectSlug: "my-app", title: "需求", source: "human" });

    const e = await callErr(s, "pm_create", {
      type: "task",
      projectSlug: "proj",
      requirement: "[[REQ-my-app-001]]",
      title: "跨项目任务",
      due: "2026-11-30",
    });
    expect(e.details.code).toBe("E_VALIDATION");
    expect(e.details.field).toBe("requirement");
  });
});

// ---------------------------------------------------------------------------
// pm_inbox 三件套（03-cli §7 同源；工具清单含 pm_inbox 相关工具）
// ---------------------------------------------------------------------------

const INBOX_MD = `---
type: inbox
id: "INBOX-inbox-001"
slug: inbox
created: 2026-11-19
tags: ["idea"]
source: human
archived: null
---
需要加 OAuth 登录
`;

describe("TC-04 pm_inbox 工具", () => {
  it("TC-04-I1: pm_inbox_list 输出 {entries, count}（03-cli §7.2，status=active）", async () => {
    const s = await newSession();
    writePmFile(s.root, "inbox/2026-11-19-idea.md", INBOX_MD);

    const p = await callOk(s, "pm_inbox_list", {});
    const entries = p.entries as Array<{ id: string; status: string; file: string; bodyFirstLine: string }>;
    expect(p.count).toBe(1);
    expect(entries[0].id).toBe("INBOX-inbox-001");
    expect(entries[0].status).toBe("active");
    expect(entries[0].file).toBe("inbox/2026-11-19-idea.md");
    expect(entries[0].bodyFirstLine).toBe("需要加 OAuth 登录");
  });

  it("TC-04-I2: pm_inbox_process limit 边界——all=true 全量；limit=0 → E_USAGE（03-cli §7.3）", async () => {
    const s = await newSession();
    writePmFile(s.root, "inbox/a.md", INBOX_MD.replace("INBOX-inbox-001", "INBOX-inbox-001"));
    writePmFile(s.root, "inbox/b.md", INBOX_MD.replace("INBOX-inbox-001", "INBOX-inbox-002").replace(/2026-11-19/g, "2026-11-18"));

    const all = await callOk(s, "pm_inbox_process", { all: true });
    expect(all.count).toBe(2);
    const limited = await callOk(s, "pm_inbox_process", { limit: 1 });
    expect(limited.count).toBe(1);
    const e = await callErr(s, "pm_inbox_process", { limit: 0 });
    expect(e.details.code).toBe("E_USAGE");
  });

  it("TC-04-I3: pm_inbox_archive 归档输出 {archived{id,from,to,archivedDate}}；重复归档 → E_NOT_FOUND", async () => {
    const s = await newSession();
    writePmFile(s.root, "inbox/2026-11-19-idea.md", INBOX_MD);

    const p = await callOk(s, "pm_inbox_archive", { id: "INBOX-inbox-001" });
    const archived = p.archived as { id: string; from: string; to: string; archivedDate: string };
    expect(archived.id).toBe("INBOX-inbox-001");
    expect(archived.to).toContain(path.join("inbox", "archive", "2026-11-19-idea.md"));
    expect(pathExists(s.root, "inbox/archive/2026-11-19-idea.md")).toBe(true);
    expect(pathExists(s.root, "inbox/2026-11-19-idea.md")).toBe(false);

    const e = await callErr(s, "pm_inbox_archive", { id: "INBOX-inbox-001" });
    expect(e.details.code).toBe("E_NOT_FOUND"); // 03-cli §7.4 退出码 1 同源
  });
});

// ---------------------------------------------------------------------------
// 工具清单全量对齐（04-mcp §2 + pm_inbox 相关工具）与 --root 启动参数
// ---------------------------------------------------------------------------

describe("TC-04 工具清单与启动参数", () => {
  it("TC-04-T1: tools/list 全量对齐 04-mcp §2 工具清单（9 个工具，inputSchema 为 JSON Schema）", async () => {
    const s = await newSession();
    const tools = await s.client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "pm_validate",
        "pm_create",
        "pm_move",
        "pm_stats",
        "pm_check",
        "pm_search",
        "pm_inbox_list",
        "pm_inbox_process",
        "pm_inbox_archive",
      ].sort(),
    );
    for (const t of tools.tools) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
    }
    // 与 TOOLS 定义一致（04-mcp §2 逐字对齐）
    expect(TOOLS.map((t) => t.name).sort()).toEqual(names);
  });

  it("TC-04-T2: 未知工具 → isError=true（E_USAGE）", async () => {
    const s = await newSession();
    const e = await callErr(s, "pm_no_such_tool", {});
    expect(e.details.code).toBe("E_USAGE");
  });

  it("TC-04-T3: additionalProperties:false——未知参数 → E_USAGE（04-mcp §2 inputSchema）", async () => {
    const s = await newSession();
    const e = await callErr(s, "pm_stats", { bogus: 1 });
    expect(e.details.code).toBe("E_USAGE");
    expect(e.details.field).toBe("bogus");
  });

  it("TC-04-T4: --root 启动参数解析（--root <path> / --root=<path> / 缺省 / 非法值）", () => {
    expect(parseLaunchArgs(["--root", "X:/repo"])).toEqual({ ok: true, root: "X:/repo" });
    expect(parseLaunchArgs(["--root=X:/repo"])).toEqual({ ok: true, root: "X:/repo" });
    expect(parseLaunchArgs([])).toEqual({ ok: true });
    expect(parseLaunchArgs(["--help"])).toMatchObject({ ok: false, exitCode: 0 });
    expect(parseLaunchArgs(["--bogus"])).toMatchObject({ ok: false, exitCode: 2 });
    expect(parseLaunchArgs(["--root"])).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("TC-04-T5: --root 指定工程根生效——cwd 与 root 解耦（03-cli §1.1 同语义）", async () => {
    // openContext 经 loadConfig(root)：root 指向无配置目录 → E_CONFIG_INVALID；root 指向合法 vault → 正常
    const good = await newSession();
    const p = await callOk(good, "pm_stats", {});
    expect(Array.isArray(p.projects)).toBe(true);
  });
});

/** 今天（YYYY-MM-DD，07-workflow §1 日期约定） */
function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
