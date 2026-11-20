import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runCheck } from "../src/commands/check";
import { makeVaultRoot, writePmFile } from "./helpers";

/** TC-03 · CLI check 用例（03-cli §6，退出码 03-cli §6.5；临时目录 vault fixture） */

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
created: "2026-11-10"
updated: "2026-11-19"
---
`;

const TASK_MD = (id: string, reqLink: string, due: string): string => `---
type: task
id: ${id}
title: 任务
status: todo
requirement: "${reqLink}"
priority: P2
due: "${due}"
completed: null
created: "2026-11-10"
updated: "2026-11-19"
---
`;

describe("TC-03 check", () => {
  let root: string;
  let vault: string;

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-check-");
    return (vault = path.join(root, "vault"));
  }

  it("TC-03-028: pm check 无问题（exit 0，🟢 台账一致性健康）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("台账一致性健康");
  });

  it("TC-03-029: pm check dangling-wiki（exit 2，issue 指向 TASK 文件）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const taskAbs = writePmFile(v, "projects/proj/tasks/TASK-proj-003.md", TASK_MD("TASK-proj-003", "[[REQ-proj-999]]", "2026-12-01"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0].code).toBe("dangling-wiki");
    expect(parsed.issues[0].file).toBe(taskAbs);
  });

  it("TC-03-030: pm check id-conflict（两个文件 id 重复，exit 2）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001-dup.md", REQ_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.issues.some((i: { code: string }) => i.code === "id-conflict")).toBe(true);
  });

  it("TC-03-031: pm check date-inverted（updated<created / due<created，exit 2）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD.replace(`updated: "2026-11-19"`, `updated: "2026-11-01"`));
    writePmFile(v, "projects/proj/tasks/TASK-proj-001.md", TASK_MD("TASK-proj-001", "[[REQ-proj-001]]", "2026-11-05"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    const inverted = parsed.issues.filter((i: { code: string }) => i.code === "date-inverted");
    expect(inverted).toHaveLength(2);
    expect(inverted.map((i: { field?: string }) => i.field).sort()).toEqual(["due", "updated"]);
  });

  it("TC-03-032: pm check invalid-frontmatter（非法 frontmatter，exit 2）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD.replace("status: active", "status: pool"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.issues.some((i: { code: string }) => i.code === "invalid-frontmatter")).toBe(true);
  });

  it("TC-03-033: pm check invalid-link-target（requirement=\"[[xxx]]\"，exit 2）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    writePmFile(v, "projects/proj/tasks/TASK-proj-003.md", TASK_MD("TASK-proj-003", "[[xxx]]", "2026-12-01"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].code).toBe("invalid-link-target");
  });

  it("TC-03-034: pm check --json 输出结构（ok/issues[{file,field?,code,message}]，code ∈ 03-cli §6.3 枚举）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    writePmFile(v, "projects/proj/tasks/TASK-proj-003.md", TASK_MD("TASK-proj-003", "[[REQ-proj-999]]", "2026-12-01"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runCheck({ root, json: true });
    expect(code).toBe(2);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(typeof parsed.ok).toBe("boolean");
    expect(Array.isArray(parsed.issues)).toBe(true);
    const allowed = new Set(["dangling-wiki", "invalid-link-target", "id-conflict", "date-inverted", "invalid-frontmatter"]);
    for (const iss of parsed.issues) {
      expect(typeof iss.file).toBe("string");
      expect(typeof iss.message).toBe("string");
      expect(allowed.has(iss.code)).toBe(true);
    }
  });
});
