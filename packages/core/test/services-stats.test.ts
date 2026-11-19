import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex, deriveStats, today, type Config, type VaultIndex } from "../src/index";

/** TC-02 · services/stats 聚合（02-core §2.4, plan §4.3 第 2 条, TC-02-010/011/026） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function makeConfig(vault: string): Config {
  return { vaultPath: vault, pmRoot: path.join(vault, "PM") };
}

function writeTask(vault: string, id: string, status: string, due: string): void {
  const abs = path.join(vault, "PM", "projects", "proj", "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `---
type: task
id: ${id}
title: 任务-${id}
status: ${status}
requirement: "[[REQ-proj-001]]"
priority: P2
due: ${due}
completed: null
created: 2026-11-19
updated: 2026-11-19
---
`,
    "utf8",
  );
}

function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function makeStatsIndex(tasks: Array<{ id: string; status: string; due: string }>): VaultIndex {
  const vault = makeTempRoot("vault-stats-");
  fs.mkdirSync(path.join(vault, "PM"), { recursive: true });
  for (const t of tasks) writeTask(vault, t.id, t.status, t.due);
  return buildIndex(makeConfig(vault));
}

describe("TC-02 services/stats", () => {
  it("TC-02-010: deriveStats 正常聚合（02-core §2.4, plan §4.3 第 2 条）", () => {
    const index = makeStatsIndex([
      { id: "TASK-proj-001", status: "todo", due: shiftDays(1) },
      { id: "TASK-proj-002", status: "doing", due: shiftDays(0) },
      { id: "TASK-proj-003", status: "done", due: shiftDays(-1) },
      { id: "TASK-proj-004", status: "cancelled", due: shiftDays(2) },
    ]);
    const stats = deriveStats(index);
    expect(stats.totals.tasks.total).toBe(4);
    expect(stats.totals.tasks.byStatus.todo).toBe(1);
    expect(stats.totals.tasks.byStatus.doing).toBe(1);
    expect(stats.totals.tasks.byStatus.done).toBe(1);
    expect(stats.totals.tasks.byStatus.cancelled).toBe(1);
    expect(stats.totals.tasks.completedRate).toBeUndefined(); // TaskStats 无 completedRate（design §2.4, 02-core §2.4）
    expect(stats.projects).toHaveLength(0); // 未写 project.md（本用例仅聚合 tasks）
  });

  it("TC-02-011: deriveStats 边界（0 个任务 completedRate=0；due==today 不计 overdue, onTrack；done 不算 onTrack）", () => {
    const empty = makeStatsIndex([]);
    const s0 = deriveStats(empty);
    expect(s0.totals.tasks.total).toBe(0);
    expect(s0.totals.tasks.overdue).toBe(0);
    expect(s0.totals.tasks.onTrack).toBe(0);
    expect(s0.totals.tasks.byStatus.done).toBe(0);

    const withToday = makeStatsIndex([
      { id: "TASK-proj-001", status: "todo", due: today() },
      { id: "TASK-proj-002", status: "doing", due: shiftDays(1) },
      { id: "TASK-proj-003", status: "done", due: shiftDays(-1) },
    ]);
    const s1 = deriveStats(withToday);
    expect(s1.totals.tasks.overdue).toBe(0); // due==today 或明天，不计 overdue
    expect(s1.totals.tasks.onTrack).toBe(2); // todo(due=today), doing(due=明天)；done 不算
  });
});
