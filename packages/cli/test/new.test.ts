import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { runNewProject, runNewRequirement, runNewTask } from "../src/commands/new";
import { makeVaultRoot, writePmFile, readPmFile, pathExists } from "./helpers";

/** TC-03 · CLI new 用例（P0，退出码 03-cli §3；临时目录 vault fixture） */

const PROJECT_MD = `---
type: project
id: proj
name: 项目Proj
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

const REQ_001_MD = `---
type: requirement
id: REQ-proj-001
title: 需求001
status: pool
priority: P2
module: auth
source: human
created: 2026-11-19
updated: 2026-11-19
---
`;

describe("TC-03 new", () => {
  let root: string;
  let vault: string;

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-new-");
    return (vault = path.join(root, "vault"));
  }

  it("TC-03-006: pm new project --name \"我的应用 v2\"（slug 规范化，exit 0）", async () => {
    const v = newRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runNewProject({ name: "我的应用 v2", tags: "frontend", root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("已创建项目");
    expect(pathExists(v, "projects/我的应用-v2/project.md")).toBe(true);
    const content = readPmFile(v, "projects/我的应用-v2/project.md");
    expect(content).toContain('id: "我的应用-v2"');
    expect(content).toContain('name: "我的应用 v2"');
    expect(content).toContain("status: active");
    expect(content).toContain('tags: ["frontend"]');
  });

  it("TC-03-006b: pm new project --json 输出 created{id, slug, path}（03-cli §3.1）", async () => {
    const v = newRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runNewProject({ name: "app", json: true, root });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.created.id).toBe("app");
    expect(parsed.created.slug).toBe("app");
    expect(parsed.created.path.replace(/\\/g, "/")).toContain("projects/app/project.md");
    expect(pathExists(v, "projects/app/project.md")).toBe(true);
  });

  it("TC-03-007: pm new project 重名 slug（E_CONFLICT exit 3）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/app/project.md", PROJECT_MD.replace(/id: proj/g, "id: app"));
    const code = await runNewProject({ name: "app", root });
    expect(code).toBe(3);
  });

  it("TC-03-008: pm new project 缺 --name（exit 2）", async () => {
    newRoot();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runNewProject({ root });
    expect(code).toBe(2);
    expect(errorSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("TC-03-009: pm new project period start>end（E_VALIDATION exit 4）", async () => {
    newRoot();
    const code = await runNewProject({ name: "test", period: ["2026-12-31", "2026-01-01"], root });
    expect(code).toBe(4);
  });

  it("TC-03-010: pm new requirement 默认 source=human（R-102, exit 0）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runNewRequirement({ slug: "proj", title: "需求一", module: "auth", root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("已创建需求");
    expect(pathExists(v, "projects/proj/requirements/REQ-proj-001.md")).toBe(true);
    const content = readPmFile(v, "projects/proj/requirements/REQ-proj-001.md");
    expect(content).toContain('source: "human"');
    expect(content).toContain("status: pool");
    expect(content).toContain('priority: "P2"');
    expect(content).toContain('id: "REQ-proj-001"');
  });

  it("TC-03-011: pm new requirement 空 title（E_VALIDATION field=title exit 4）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const code = await runNewRequirement({ slug: "proj", title: "", root });
    expect(code).toBe(4);
  });

  it("TC-03-012: pm new requirement 项目不存在（E_NOT_FOUND exit 1）", async () => {
    newRoot();
    const code = await runNewRequirement({ slug: "no-such", title: "t", root });
    expect(code).toBe(1);
  });

  it("TC-03-013: pm new task 正常", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runNewTask({ slug: "proj", requirement: "REQ-proj-001", title: "任务一", priority: "P1", due: "2026-11-30", root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("已创建任务");
    expect(pathExists(v, "projects/proj/tasks/TASK-proj-001.md")).toBe(true);
    const content = readPmFile(v, "projects/proj/tasks/TASK-proj-001.md");
    expect(content).toContain('requirement: "[[REQ-proj-001]]"');
    expect(content).toContain("status: todo");
    expect(content).toContain('priority: "P1"');
  });

  it("TC-03-014: pm new task 缺 --due（E_USAGE exit 2）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const code = await runNewTask({ slug: "proj", requirement: "REQ-proj-001", title: "t", root });
    expect(code).toBe(2);
  });

  it("TC-03-015: pm new task requirement 格式不合法（E_VALIDATION field=requirement exit 4）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const code = await runNewTask({ slug: "proj", requirement: "REQ-proj-01", title: "t", due: "2026-11-30", root });
    expect(code).toBe(4);
  });

  it("TC-03-016: pm new task requirement 目标不存在 fail-fast（E_VALIDATION exit 4）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const code = await runNewTask({ slug: "proj", requirement: "REQ-proj-999", title: "t", due: "2026-11-30", root });
    expect(code).toBe(4);
  });
});
