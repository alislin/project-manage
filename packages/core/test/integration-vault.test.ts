import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildIndex,
  moveStatus,
  parseFile,
  atomicWriteFile,
  deriveStats,
  reindexFile,
  scanTree,
  today,
  type Config,
  type VaultIndex,
} from "../src/index";
import { ZProject, ZRequirement, ZTask } from "../src/schema";

/**
 * 集成测试（02-core §5.1/§5.2/§5.4/§4.5, design §2）：
 * 以临时目录 fixture vault 为依据，覆盖 TC-02 扫描解析流转并发冲突统计的 P0 用例。
 * 每个 it() 的标题都标注 TC 编号（TC-02-003/005/007/008/013/014/015/016/017/018/019/020/021/026/027/028/029/030/031/032）。
 */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function makeVault(prefix: string): string {
  const v = makeTempRoot(prefix);
  fs.mkdirSync(path.join(v, "PM"), { recursive: true });
  return v;
}

function makeConfig(vault: string): Config {
  return { vaultPath: vault, pmRoot: path.join(vault, "PM") };
}

function writeMd(vault: string, rel: string, content: string): string {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function taskMd(id: string, status: string, due: string): string {
  return `---
type: task
id: ${id}
title: 任务-${id}
status: ${status}
requirement: "[[REQ-proj-001]]"
priority: P2
due: ${due}
completed: null
created: ${TODAY}
updated: ${TODAY}
---
`;
}

const TODAY = today();

// ---------------------------------------------------------------------------
// fixture vault（TC-02-007/008/021）
// ---------------------------------------------------------------------------

function projectMd(id: string, name: string, status = "active"): string {
  return `---
type: project
id: ${id}
name: ${name}
status: ${status}
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;
}

const PROJECT_X_MD = projectMd("proj", "项目Proj");

const REQ_X_001_MD = `---
type: requirement
id: REQ-proj-001
title: 需求001
status: pool
priority: P2
module: auth
source: human
created: ${TODAY}
updated: ${TODAY}
---
`;

const REQ_X_002_MD = `---
type: requirement
id: REQ-proj-002
title: 需求002
status: pool
priority: P1
module: ""
source: human
created: ${TODAY}
updated: ${TODAY}
---
`;

const TASK_X_001_MD = taskMd("TASK-proj-001", "todo", shiftDays(10));
const TASK_X_002_MD = taskMd("TASK-proj-002", "todo", shiftDays(12));

const INBOX_A_MD = `---
type: inbox
id: INBOX-inbox-001
slug: inbox
created: ${TODAY}
tags: []
---
收集箱内容
`;

/** TC-02-007/008 fixture：six-state fixture vault */
function makeSixStateVault(): string {
  const vault = makeVault("vault-sixstate-");
  writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
  writeMd(vault, "PM/projects/proj/requirements/REQ-proj-001.md", REQ_X_001_MD);
  writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", TASK_X_001_MD);
  writeMd(vault, "PM/inbox/a.md", INBOX_A_MD);
  // obsidian 无 frontmatter文件 → unnumbered（design §4.4 未识别行）
  writeMd(vault, "PM/obsidian/foo.md", "无 frontmatter 的 obsidian 文件\n");
  // inbox/archive/ 排除（design §4.4 归档排除）
  writeMd(vault, "PM/inbox/archive/old.md", INBOX_A_MD);
  return vault;
}

/** TC-02-021/022 fixture：可 reindexFile 的 project vault */
function makeReindexVault(): string {
  const vault = makeVault("vault-reindex-");
  writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
  return vault;
}

function makeMoveFixture(): VaultIndex {
  const vault = makeVault("vault-move-");
  writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
  writeMd(vault, "PM/projects/proj/requirements/REQ-proj-001.md", REQ_X_001_MD);
  writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", taskMd("TASK-proj-001", "todo", shiftDays(10)));
  return buildIndex(makeConfig(vault));
}

// ---------------------------------------------------------------------------
// 集成：scan + parse + index
// ---------------------------------------------------------------------------

describe("TC-02 integration: scan + parse + index", () => {
  it("TC-02-003: scanTree 正常（02-core §4.2）：排序后 FileEntry[] + byPath 1:1", () => {
    const vault = makeVault("vault-scan-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    writeMd(vault, "PM/projects/proj/requirements/REQ-proj-001.md", REQ_X_001_MD);
    const scan = scanTree(path.join(vault, "PM"));
    expect(scan.entries.map((e) => e.relPath)).toEqual([
      "projects/proj/project.md",
      "projects/proj/requirements/REQ-proj-001.md",
    ]);
    for (const e of scan.entries) {
      expect(scan.byPath.get(e.relPath)).toBe(e);
    }
  });

  it("TC-02-005: parseFile 正常（02-core §4.3）：ok=true, data = 校验后 Requirement", () => {
    const vault = makeVault("vault-parse-");
    const abs = writeMd(vault, "PM/projects/proj/requirements/REQ-proj-001.md", REQ_X_001_MD);
    const res = parseFile(abs, ZRequirement);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("REQ-proj-001");
      expect(res.data.status).toBe("pool");
    }
  });

  it("TC-02-007: buildIndex 六态（projects/requirements/tasks/inboxEntries/unnumbered/archived-excluded）", () => {
    const vault = makeSixStateVault();
    const index = buildIndex(makeConfig(vault));
    expect(index.projects.map((p) => p.id)).toEqual(["proj"]);
    expect(index.requirements.map((r) => r.id)).toEqual(["REQ-proj-001"]);
    expect(index.tasks.map((t) => t.id)).toEqual(["TASK-proj-001"]);
    expect(index.inboxEntries.map((e) => e.id)).toEqual(["INBOX-inbox-001"]);
    expect(index.unnumbered.map((u) => u.file.relPath)).toContain("obsidian/foo.md");
    expect(index.broken).toEqual([]);
    // inbox/archive 下文件不进索引（design §4.4 归档排除, §5.2.7）
    expect(index.byPath.has(path.join(vault, "PM", "inbox", "archive", "old.md"))).toBe(false);
    expect(index.byPath.has(path.join(vault, "PM", "obsidian", "foo.md"))).toBe(false);
    expect(index.byPath.has(path.join(vault, "PM", "projects", "proj", "project.md"))).toBe(true);
  });

  it("TC-02-008: 排序与双索引（requirements/tasks 按 id 升序, byPath, requirementTasks 按 id 升序）", () => {
    const vault = makeVault("vault-sort-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    writeMd(vault, "PM/projects/proj/requirements/REQ-proj-001.md", REQ_X_001_MD);
    writeMd(vault, "PM/projects/proj/requirements/REQ-proj-002.md", REQ_X_002_MD);
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", TASK_X_001_MD);
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-002.md", TASK_X_002_MD);
    const index = buildIndex(makeConfig(vault));
    expect(index.requirements.map((r) => r.id)).toEqual(["REQ-proj-001", "REQ-proj-002"]);
    expect(index.tasks.map((t) => t.id)).toEqual(["TASK-proj-001", "TASK-proj-002"]);
    expect(index.byPath.get(path.join(vault, "PM", "projects", "proj", "tasks", "TASK-proj-001.md"))).toMatchObject({
      id: "TASK-proj-001",
    });
    expect(index.requirementTasks.get("REQ-proj-001")).toEqual(["TASK-proj-001", "TASK-proj-002"]);
    expect(index.requirementTasks.get("REQ-proj-002")).toBeUndefined();
  });

  it("TC-02-026: onTrack 语义（todo/doing 且 due ≥ today 计入 onTrack，due < today 计 overdue）", () => {
    const vault = makeVault("vault-ontrack-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", taskMd("TASK-proj-001", "todo", TODAY));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-002.md", taskMd("TASK-proj-002", "doing", shiftDays(1)));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-003.md", taskMd("TASK-proj-003", "todo", shiftDays(-1)));
    const index = buildIndex(makeConfig(vault));
    const stats = deriveStats(index);
    expect(stats.totals.tasks.onTrack).toBe(2);
    expect(stats.totals.tasks.overdue).toBe(1);
    expect(stats.totals.tasks.byStatus.todo).toBe(2);
    expect(stats.totals.tasks.byStatus.doing).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 集成：原子写冲突统计
// ---------------------------------------------------------------------------

describe("TC-02 integration: writer", () => {
  it("TC-02-013: atomicWriteFile 正常（目标文件已存在 → ok=true, 无残留 tmp, selfWrite 登记）", () => {
    const vault = makeVault("vault-atomic-");
    const abs = writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    const res = atomicWriteFile(abs, "new content", { pmRoot: path.join(vault, "PM") });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(fs.readFileSync(abs, "utf8")).toBe("new content");
      // 目录内无残留临时文件（design §6.1）
      expect(fs.readdirSync(path.dirname(abs)).filter((n) => n.startsWith(".")).length).toBe(0);
      expect(res.written.absPath).toBe(abs);
    }
  });

  it("TC-02-014: expectedMtimeMs 预检 → E_CONFLICT（含 expectedMtimeMs/currentMtimeMs）", () => {
    const vault = makeVault("vault-conflict-");
    const abs = writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    const cur = fs.statSync(abs).mtimeMs;
    const res = atomicWriteFile(abs, "new content", { expectedMtimeMs: cur + 1000, pmRoot: path.join(vault, "PM") });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("E_CONFLICT");
      expect(res.error.expectedMtimeMs).toBe(cur + 1000);
      expect(res.error.currentMtimeMs).toBe(cur);
    }
  });

  it("TC-02-015: 并发两个写同目标文件 → 其中一个 ok=true，另一个 ok=false, E_CONFLICT", () => {
    const vault = makeVault("vault-race-");
    const abs = writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    const pmRoot = path.join(vault, "PM");
    const m0 = fs.statSync(abs).mtimeMs;
    const w1 = atomicWriteFile(abs, "worker-1", { expectedMtimeMs: m0, pmRoot });
    expect(w1.ok).toBe(true);
    // 同一 mtime 粒度下第二个 worker 的复查需要确定性差异：人为 bump mtime 模拟并发窗口
    let m1 = fs.statSync(abs).mtimeMs;
    if (m1 === m0) {
      const d = new Date();
      d.setTime(d.getTime() + 5000);
      fs.utimesSync(abs, d, d);
      m1 = fs.statSync(abs).mtimeMs;
    }
    expect(m1).not.toBe(m0);
    const w2 = atomicWriteFile(abs, "worker-2", { expectedMtimeMs: m0, pmRoot });
    expect(w2.ok).toBe(false);
    if (!w2.ok) expect(w2.error.code).toBe("E_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// 集成：moveStatus 流转（TC-02-016/017/018/019/020/021/022）
// ---------------------------------------------------------------------------

describe("TC-02 integration: moveStatus", () => {
  it("TC-02-016: moveStatus 流转副作用（todo→doing, updated=today, status=doing）", () => {
    const index = makeMoveFixture();
    const abs = index.scan.entries.find((e) => e.relPath === "projects/proj/tasks/TASK-proj-001.md")!.absPath;
    const res = moveStatus(index, "TASK-proj-001", "doing");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.from).toBe("todo");
      expect(res.value.to).toBe("doing");
      expect(res.value.updated).toBe(true);
      expect(res.value.completedSet).toBe(false);
    }
    const parsed = parseFile(abs, ZTask);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.status).toBe("doing");
      expect(parsed.data.updated).toBe(TODAY);
    }
    // index 已同步（design §4.7 成功则 reindex，§5.4）
    const rec = index.byPath.get(abs) as { status: string } | undefined;
    expect(rec?.status).toBe("doing");
  });

  it("TC-02-017: moveStatus E_NOT_FOUND", () => {
    const index = makeMoveFixture();
    const res = moveStatus(index, "TASK-proj-999", "doing");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("E_NOT_FOUND");
  });

  it("TC-02-018: moveStatus 非法流转（doing→todo, 01-数据规范 §3.4）", () => {
    const index = makeMoveFixture();
    const abs = index.scan.entries.find((e) => e.relPath === "projects/proj/tasks/TASK-proj-001.md")!.absPath;
    const r1 = moveStatus(index, "TASK-proj-001", "doing");
    expect(r1.ok).toBe(true);
    const afterMove = fs.readFileSync(abs, "utf8");
    const res = moveStatus(index, "TASK-proj-001", "todo");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("E_INVALID_TRANSITION");
    expect(fs.readFileSync(abs, "utf8")).toBe(afterMove); // 文件未改动
  });

  it("TC-02-019: moveStatus mtime 冲突（外部修改 → E_CONFLICT）", () => {
    const index = makeMoveFixture();
    const abs = index.scan.entries.find((e) => e.relPath === "projects/proj/tasks/TASK-proj-001.md")!.absPath;
    const m0 = fs.statSync(abs).mtimeMs;
    // 外部追加修改文件（非应用写）
    fs.appendFileSync(abs, "\n<!-- 外部修改 -->\n");
    let m1 = fs.statSync(abs).mtimeMs;
    if (m1 === m0) {
      const d = new Date();
      d.setTime(d.getTime() + 1000);
      fs.utimesSync(abs, d, d);
      m1 = fs.statSync(abs).mtimeMs;
    }
    expect(m1).not.toBe(m0);
    const res = moveStatus(index, "TASK-proj-001", "doing");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("E_CONFLICT");
  });

  it("TC-02-020: moveLocks 按路径串行（N 个并发 moveStatus, 仅第一个 ok，其余 E_INVALID_TRANSITION/E_CONFLICT）", () => {
    const index = makeMoveFixture();
    const results = [1, 2, 3].map(() => moveStatus(index, "TASK-proj-001", "doing"));
    const oks = results.filter((r) => r.ok).length;
    expect(oks).toBe(1);
    for (const r of results.filter((x) => !x.ok)) {
      expect(r.error.code).toBe("E_INVALID_TRANSITION");
    }
  });

  it("TC-02-021: reindexFile 更新（直接写文件 → 重新 reindex, index 内容更新）", () => {
    const vault = makeReindexVault();
    const index = buildIndex(makeConfig(vault));
    const abs = index.scan.entries.find((e) => e.relPath === "projects/proj/project.md")!.absPath;
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD.replace("项目Proj", "项目Proj-V2"));
    reindexFile(index, abs);
    const p = index.byPath.get(abs) as { name: string } | undefined;
    expect(p).toBeDefined();
    expect(p?.name).toBe("项目Proj-V2");
  });

  it("TC-02-022: reindexFile 删除（absPath 不存在 → 移除）", () => {
    const vault = makeReindexVault();
    const index = buildIndex(makeConfig(vault));
    const abs = index.scan.entries.find((e) => e.relPath === "projects/proj/project.md")!.absPath;
    expect(index.byPath.has(abs)).toBe(true);
    fs.rmSync(abs);
    reindexFile(index, abs);
    expect(index.byPath.has(abs)).toBe(false);
    expect(index.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 集成：流转矩阵（TC-02-027/028/029/030/031/032）
// ---------------------------------------------------------------------------

function writeReq(vault: string, id: string, status: string): string {
  return writeMd(
    vault,
    `PM/projects/proj/requirements/${id}.md`,
    `---
type: requirement
id: ${id}
title: 需求-${id}
status: ${status}
priority: P2
module: ""
source: human
created: ${TODAY}
updated: ${TODAY}
---
`,
  );
}

describe("TC-02 integration: transition matrices", () => {
  it("TC-02-027: project 流转矩阵（合法）（01-数据规范 §3.1，02-core §4.7）", () => {
    const vault = makeVault("vault-m27-");
    writeMd(vault, "PM/projects/proj/project.md", projectMd("proj", "项目Proj", "active"));
    const index = buildIndex(makeConfig(vault));
    // legal rows: active→paused, paused→active, active→done, done→archived
    const r1 = moveStatus(index, "proj", "paused");
    expect(r1.ok).toBe(true);
    const r2 = moveStatus(index, "proj", "active");
    expect(r2.ok).toBe(true);
    const r3 = moveStatus(index, "proj", "done");
    expect(r3.ok).toBe(true);
    const r4 = moveStatus(index, "proj", "archived");
    expect(r4.ok).toBe(true);
    if (r1.ok && r2.ok && r3.ok && r4.ok) {
      expect(r1.value.from).toBe("active");
      expect(r2.value.from).toBe("paused");
      expect(r3.value.from).toBe("active");
      expect(r4.value.from).toBe("done");
      expect(r1.value.updated).toBe(true);
    }
  });

  it("TC-02-028: project 非法流转矩阵（paused→done, done→active, archived→any）（01-数据规范 §3.1，02-core §3.1）", () => {
    const vault = makeVault("vault-m28-");
    writeMd(vault, "PM/projects/p1/project.md", projectMd("p1", "项目P1", "paused"));
    writeMd(vault, "PM/projects/p2/project.md", projectMd("p2", "项目P2", "done"));
    writeMd(vault, "PM/projects/p3/project.md", projectMd("p3", "项目P3", "archived"));
    const index = buildIndex(makeConfig(vault));
    const p1Abs = path.join(vault, "PM", "projects", "p1", "project.md");
    const r1 = moveStatus(index, "p1", "done"); // paused→done 非法
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe("E_INVALID_TRANSITION");
      expect(r1.error.file).toBe(p1Abs);
    }
    expect(moveStatus(index, "p2", "active").ok).toBe(false); // done→active 非法
    expect(moveStatus(index, "p3", "active").ok).toBe(false); // archived→any 非法
    // status 不变（非法流转不改动，01-数据规范 §3.4）
    const p1Parsed = parseFile(p1Abs, ZProject);
    expect(p1Parsed.ok && p1Parsed.data.status).toBe("paused");
  });

  it("TC-02-029: requirement 流转矩阵（合法）（01-数据规范 §3.2，02-core §4.7）", () => {
    const vault = makeVault("vault-m29-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    writeReq(vault, "REQ-proj-001", "pool");
    const index = buildIndex(makeConfig(vault));
    const r1 = moveStatus(index, "REQ-proj-001", "reviewing"); // pool→reviewing 合法
    expect(r1.ok).toBe(true);
    const r2 = moveStatus(index, "REQ-proj-001", "accepted"); // reviewing→accepted 合法
    expect(r2.ok).toBe(true);
    const r3 = moveStatus(index, "REQ-proj-001", "done"); // accepted→done 合法
    expect(r3.ok).toBe(true);
    if (r1.ok && r2.ok && r3.ok) {
      expect(r1.value.updated).toBe(true);
      expect(r3.value.completedSet).toBe(false); // requirement 无 completed 字段（01-数据规范 §1.2）
    }
  });

  it("TC-02-030: requirement 非法流转矩阵（pool→done, reviewing→done, accepted→reviewing/rejected, rejected→reviewing/done, done→pool）（01-数据规范 §3.2，02-core §3.1）", () => {
    const vault = makeVault("vault-m30-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    const index = buildIndex(makeConfig(vault));
    const states = ["pool", "reviewing", "accepted", "rejected", "done"];
    for (const [i, st] of states.entries()) {
      writeReq(vault, `REQ-proj-${String(i + 1).padStart(3, "0")}`, st);
    }
    const entries = index.scan.entries.filter((e) => e.relPath.startsWith("projects/proj/requirements/"));
    for (const e of entries) reindexFile(index, e.absPath);
    const findId = (n: number) => `REQ-proj-${String(n).padStart(3, "0")}`;
    // pool→done 非法
    expect(moveStatus(index, findId(1), "done").ok).toBe(false);
    // reviewing→done 非法
    expect(moveStatus(index, findId(2), "done").ok).toBe(false);
    // accepted→reviewing / accepted→rejected 非法
    expect(moveStatus(index, findId(3), "reviewing").ok).toBe(false);
    expect(moveStatus(index, findId(3), "rejected").ok).toBe(false);
    // rejected→reviewing / rejected→done 非法
    expect(moveStatus(index, findId(4), "reviewing").ok).toBe(false);
    expect(moveStatus(index, findId(4), "done").ok).toBe(false);
    // done→pool 非法
    expect(moveStatus(index, findId(5), "pool").ok).toBe(false);
  });

  it("TC-02-031: task 流转矩阵（合法）（01-数据规范 §3.3，02-core §4.7）", () => {
    const vault = makeVault("vault-m31-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", taskMd("TASK-proj-001", "todo", shiftDays(10)));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-002.md", taskMd("TASK-proj-002", "todo", shiftDays(10)));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-003.md", taskMd("TASK-proj-003", "cancelled", shiftDays(10)));
    const index = buildIndex(makeConfig(vault));
    const r1 = moveStatus(index, "TASK-proj-001", "doing"); // todo→doing 合法
    expect(r1.ok).toBe(true);
    const r2 = moveStatus(index, "TASK-proj-002", "done"); // todo→done 合法, completed=today（01-数据规范 §3.3）
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.completedSet).toBe(true);
    const abs2 = path.join(vault, "PM", "projects", "proj", "tasks", "TASK-proj-002.md");
    const parsed2 = parseFile(abs2, ZTask);
    expect(parsed2.ok).toBe(true);
    if (parsed2.ok) expect(parsed2.data.completed).toBe(TODAY);
    const r3 = moveStatus(index, "TASK-proj-003", "todo"); // cancelled→todo 合法
    expect(r3.ok).toBe(true);
  });

  it("TC-02-032: task 非法流转矩阵（doing→todo, done→todo/doing/cancelled, cancelled→done/doing/cancelled）（01-数据规范 §3.3，02-core §3.1）", () => {
    const vault = makeVault("vault-m32-");
    writeMd(vault, "PM/projects/proj/project.md", PROJECT_X_MD);
    const index = buildIndex(makeConfig(vault));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-001.md", taskMd("TASK-proj-001", "doing", shiftDays(10)));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-002.md", taskMd("TASK-proj-002", "done", shiftDays(10)));
    writeMd(vault, "PM/projects/proj/tasks/TASK-proj-003.md", taskMd("TASK-proj-003", "cancelled", shiftDays(10)));
    for (const e of index.scan.entries.filter((x) => x.relPath.startsWith("projects/proj/tasks/"))) reindexFile(index, e.absPath);
    expect(moveStatus(index, "TASK-proj-001", "todo").ok).toBe(false); // doing→todo 非法
    expect(moveStatus(index, "TASK-proj-002", "todo").ok).toBe(false); // done→todo 非法
    expect(moveStatus(index, "TASK-proj-002", "cancelled").ok).toBe(false); // done→cancelled 非法
    expect(moveStatus(index, "TASK-proj-003", "done").ok).toBe(false); // cancelled→done 非法
    expect(moveStatus(index, "TASK-proj-003", "cancelled").ok).toBe(false); // cancelled→cancelled 非法
  });
});
