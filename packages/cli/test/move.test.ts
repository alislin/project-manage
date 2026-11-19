import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { runMove } from "../src/commands/move";
import { makeVaultRoot, writePmFile, readPmFile } from "./helpers";
import { today, shiftDays } from "./helpers";

/** TC-03 · CLI move 用例（P0，退出码 03-cli §4；临时目录 vault fixture） */

const PROJECT_MD = `---
type: project
id: proj
name: 项目Proj
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

const REQ_001_POOL_MD = `---
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

const TASK_001_MD = (status: string, due: string): string => `---
type: task
id: TASK-proj-001
title: 任务001
status: ${status}
requirement: "[[REQ-proj-001]]"
priority: P2
due: ${due}
completed: null
created: ${today()}
updated: ${today()}
---
`;

describe("TC-03 move", () => {
  let root: string;
  let vault: string;
  const TODAY = today();

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-move-");
    return (vault = path.join(root, "vault"));
  }

  it("TC-03-019: pm move pool→reviewing（副作用 updated=今天，exit 0）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_POOL_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runMove({ id: "REQ-proj-001", status: "reviewing", root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("✅");
    const content = readPmFile(v, "projects/proj/requirements/REQ-proj-001.md");
    expect(content).toContain("status: reviewing");
    expect(content).toContain(TODAY);
  });

  it("TC-03-020: pm move 非法流转（E_INVALID_TRANSITION exit 4）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_POOL_MD);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMove({ id: "REQ-proj-001", status: "done", root });
    expect(code).toBe(4);
    const out = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("E_INVALID_TRANSITION");
    // 非法流转不改文件
    const content = readPmFile(v, "projects/proj/requirements/REQ-proj-001.md");
    expect(content).toContain("status: pool");
  });

  it("TC-03-021: pm move id 不存在（E_NOT_FOUND exit 1）", async () => {
    newRoot();
    const code = await runMove({ id: "REQ-proj-999", status: "done", root });
    expect(code).toBe(1);
  });

  it("TC-03-022: pm move 缺 --status（E_USAGE exit 2）", async () => {
    newRoot();
    const code = await runMove({ id: "REQ-proj-001", root });
    expect(code).toBe(2);
  });

  it("TC-03-023: pm move todo→doing→done（全流程，completed=今天）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/tasks/TASK-proj-001.md", TASK_001_MD("todo", shiftDays(10)));
    // 两次 move 模拟两次 CLI 调用（CLI 单次调用内 buildIndex 会跳过本进程 self-write 的文件，design §5.3）
    const cli = path.join(process.cwd(), "dist", "index.js");
    const r1 = spawnSync(process.execPath, [cli, "move", "TASK-proj-001", "--status", "doing"], { cwd: root, encoding: "utf8" });
    expect(r1.status).toBe(0);
    const r2 = spawnSync(process.execPath, [cli, "move", "TASK-proj-001", "--status", "done"], { cwd: root, encoding: "utf8" });
    expect(r2.status).toBe(0);
    const content = readPmFile(v, "projects/proj/tasks/TASK-proj-001.md");
    expect(content).toContain("status: done");
    expect(content).toContain(TODAY);
  });

  it("TC-03-050: pm move project 流转（active→paused, exit 0）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/my-app/project.md", PROJECT_MD.replace(/id: proj/g, "id: my-app"));
    const code = await runMove({ id: "my-app", status: "paused", root });
    expect(code).toBe(0);
    const content = readPmFile(v, "projects/my-app/project.md");
    expect(content).toContain("status: paused");
  });
});
