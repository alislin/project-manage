import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { runStats } from "../src/commands/stats";
import { makeVaultRoot, writePmFile } from "./helpers";
import { today, shiftDays } from "./helpers";

/** TC-03 · CLI stats 用例（P0，退出码 03-cli §5；临时目录 vault fixture） */

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
created: ${today()}
updated: ${today()}
---
`;

const TASK_001_MD = (due: string): string => `---
type: task
id: TASK-proj-001
title: 任务001
status: todo
requirement: "[[REQ-proj-001]]"
priority: P2
due: ${due}
completed: null
created: ${today()}
updated: ${today()}
---
`;

describe("TC-03 stats", () => {
  let root: string;

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-stats-");
    return path.join(root, "vault");
  }

  it("TC-03-025: pm stats 聚合正常（exit 0, onTrack, 03-cli §5.2 结构）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    writePmFile(v, "projects/proj/tasks/TASK-proj-001.md", TASK_001_MD(shiftDays(10)));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runStats({ json: true, root });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.projects).toHaveLength(1);
    const p = parsed.projects[0];
    expect(p.slug).toBe("proj");
    expect(p.name).toBe("项目Proj");
    expect(p.status).toBe("active");
    expect(p.progress).toEqual(
      expect.objectContaining({
        completedRate: 0,
        overdueCount: 0,
        totalTasks: 1,
        doneTasks: 0,
        cancelledTasks: 0,
        onTrack: 1,
      }),
    );
    expect(Object.keys(p.progress)).toEqual(expect.arrayContaining(["completedRate", "overdueCount", "totalTasks", "doneTasks", "cancelledTasks", "onTrack"]));
    expect(parsed.totals.requirements).toEqual({ total: 1, byStatus: { pool: 1, reviewing: 0, accepted: 0, rejected: 0, done: 0 } });
    expect(parsed.totals.tasks).toEqual(expect.objectContaining({ total: 1, overdue: 0, onTrack: 1 }));
  });

  it("TC-03-026: pm stats 空 vault（exit 0）", async () => {
    newRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runStats({ root });
    expect(code).toBe(0);
    expect(logSpy.mock.calls).toEqual([]);
  });

  it("TC-03-043: vault 不存在（E_CONFIG_INVALID exit 2）", async () => {
    const root2 = makeVaultRoot("pm-cli-novault-");
    const vault2 = path.join(root2, "vault-missing");
    fs.writeFileSync(path.join(root2, "pm.config.json"), JSON.stringify({ vaultPath: vault2, pmRoot: path.join(vault2, "PM") }));
    const code = await runStats({ root: root2 });
    expect(code).toBe(2);
    fs.rmSync(root2, { recursive: true, force: true });
  });
});
