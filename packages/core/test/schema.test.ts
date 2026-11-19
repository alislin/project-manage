import { describe, it, expect } from "vitest";
import { ZProject, ZRequirement, ZTask, ZInboxEntry, Slug } from "../src/schema";
import type { Project, Requirement, Task, InboxEntry } from "../src/schema";

/** TC-01 · 01-数据规范 §5 Zod schema（P0/P1 用例） */

const baseProject = {
  type: "project",
  id: "proj",
  name: "我的应用",
  status: "active",
  period: ["2026-01-01", "2026-12-31"],
  tags: ["frontend"],
};

const baseRequirement = {
  type: "requirement",
  id: "REQ-proj-001",
  title: "需求",
  status: "pool",
  priority: "P2",
  module: "auth",
  source: "human",
  created: "2026-11-19",
  updated: "2026-11-19",
};

const baseTask = {
  type: "task",
  id: "TASK-proj-001",
  title: "任务",
  status: "todo",
  requirement: "[[REQ-proj-001]]",
  priority: "P1",
  due: "2026-11-30",
  completed: null,
  created: "2026-11-19",
  updated: "2026-11-19",
};

describe("TC-01 project schema", () => {
  it("TC-01-001: project 必填字段全通过", () => {
    const res = ZProject.safeParse(baseProject);
    expect(res.success).toBe(true);
    if (res.success) {
      const p: Project = res.data;
      expect(p.name).toBe("我的应用");
      expect(p.period[0]).toBe("2026-01-01");
      expect(p.period[1]).toBe("2026-12-31");
      expect(p.tags).toEqual(["frontend"]);
    }
  });

  it("TC-01-002: project period start>end 非法", () => {
    const res = ZProject.safeParse({ ...baseProject, period: ["2026-12-31", "2026-01-01"] });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === "period")).toBe(true);
    }
  });

  it("TC-01-003: project period 元素缺失/非法", () => {
    const res1 = ZProject.safeParse({ ...baseProject, period: ["2026-01-01"] });
    expect(res1.success).toBe(false);
    if (!res1.success) expect(res1.error.issues.some((i) => i.path[0] === "period")).toBe(true);
    const res2 = ZProject.safeParse({ ...baseProject, period: ["", "2026-12-31"] });
    expect(res2.success).toBe(false);
    if (!res2.success) expect(res2.error.issues.some((i) => i.path[0] === "period")).toBe(true);
  });

  it("TC-01-004: project status/id/name 非法", () => {
    const res = ZProject.safeParse({
      ...baseProject,
      status: "online",
      id: "a--b",
      name: "   ",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === "status")).toBe(true);
      expect(res.error.issues.some((i) => i.path[0] === "id")).toBe(true);
      expect(res.error.issues.some((i) => i.path[0] === "name")).toBe(true);
    }
  });

  it("TC-01-005: project tags 重复/非空元素（01-数据规范 §1.1：去重 + 每元素 trim 后非空）", () => {
    expect(ZProject.safeParse({ ...baseProject, tags: ["a", "b"] }).success).toBe(true);
    expect(ZProject.safeParse({ ...baseProject, tags: ["a", "a"] }).success).toBe(false);
    expect(ZProject.safeParse({ ...baseProject, tags: ["a", " "] }).success).toBe(false);
  });
});

describe("TC-01 requirement schema", () => {
  it("TC-01-006: requirement 必填字段全通过", () => {
    const res = ZRequirement.safeParse(baseRequirement);
    expect(res.success).toBe(true);
    if (res.success) {
      const r: Requirement = res.data;
      expect(r.id).toBe("REQ-proj-001");
      expect(r.status).toBe("pool");
      expect(r.source).toBe("human");
    }
  });

  it("TC-01-007: requirement id 正则 ^REQ-[A-Za-z0-9一-鿿]+-\\d{3}$", () => {
    for (const bad of ["REQ-proj-01", "REQ-proj-0001", "req-proj-001", "REQ-proj-"]) {
      const res = ZRequirement.safeParse({ ...baseRequirement, id: bad });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "id")).toBe(true);
    }
    expect(ZRequirement.safeParse({ ...baseRequirement, id: "REQ-proj-001" }).success).toBe(true);
  });

  it("TC-01-008: requirement title/status/priority 非法", () => {
    const cases: Array<{ title?: string; status?: string; priority?: string }> = [
      { title: "" },
      { title: "x".repeat(201) },
      { status: "foo" },
      { priority: "P4" },
    ];
    for (const patch of cases) {
      const res = ZRequirement.safeParse({ ...baseRequirement, ...patch });
      expect(res.success).toBe(false);
      const field = Object.keys(patch)[0];
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path[0] === field)).toBe(true);
      }
    }
  });

  it("TC-01-009: requirement source 非空（R-102）", () => {
    for (const source of ["", " "]) {
      const res = ZRequirement.safeParse({ ...baseRequirement, source });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "source")).toBe(true);
    }
    expect(ZRequirement.safeParse({ ...baseRequirement, source: "human" }).success).toBe(true);
  });

  it("TC-01-010: requirement updated<created 日期倒挂", () => {
    const res = ZRequirement.safeParse({ ...baseRequirement, created: "2026-01-02", updated: "2026-01-01" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "updated")).toBe(true);
  });

  it("TC-01-010/TC-01-026: updated ≥ created（等值合法）", () => {
    const r1 = ZRequirement.safeParse({ ...baseRequirement, created: "2026-01-02", updated: "2026-01-02" });
    expect(r1.success).toBe(true);
    const r2 = ZRequirement.safeParse({ ...baseRequirement, created: "2026-11-19", updated: "2026-11-19" });
    expect(r2.success).toBe(true);
  });
});

describe("TC-01 task schema", () => {
  it("TC-01-011: task 必填字段全通过", () => {
    const res = ZTask.safeParse(baseTask);
    expect(res.success).toBe(true);
    if (res.success) {
      const t: Task = res.data;
      expect(t.id).toBe("TASK-proj-001");
      expect(t.status).toBe("todo");
      expect(t.requirement).toBe("[[REQ-proj-001]]");
      expect(t.completed).toBeNull();
    }
  });

  it("TC-01-012: task requirement 字段不匹配 wiki-link", () => {
    for (const req of ["REQ-proj-001", "[[REQ-proj-01]]"]) {
      const res = ZTask.safeParse({ ...baseTask, requirement: req });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "requirement")).toBe(true);
    }
  });

  it("TC-01-013: task due 非法日期 + 日历边界", () => {
    for (const due of ["2026-13-01", "2026-02-30"]) {
      const res = ZTask.safeParse({ ...baseTask, due });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "due")).toBe(true);
    }
    expect(ZTask.safeParse({ ...baseTask, due: "2024-02-29" }).success).toBe(true);
  });

  it("TC-01-014: task completed 语义", () => {
    expect(ZTask.safeParse(baseTask).success).toBe(true);
    expect(ZTask.safeParse({ ...baseTask, completed: "2026-11-20" }).success).toBe(true);
    expect(ZTask.safeParse({ ...baseTask, completed: "not-a-date" }).success).toBe(false);
  });

  it("TC-01-015: task estimate 校验", () => {
    expect(ZTask.safeParse({ ...baseTask, estimate: 2.5 }).success).toBe(true);
    expect(ZTask.safeParse({ ...baseTask, estimate: 0 }).success).toBe(false);
    expect(ZTask.safeParse({ ...baseTask, estimate: -1 }).success).toBe(false);
    expect(ZTask.safeParse({ ...baseTask, estimate: "2" }).success).toBe(false);
    expect(ZTask.safeParse(baseTask).success).toBe(true);
  });

  it("TC-01-016: task updated<created 日期倒挂", () => {
    const res = ZTask.safeParse({ ...baseTask, created: "2026-01-02", updated: "2026-01-01" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "updated")).toBe(true);
  });
});

describe("TC-01 inbox schema", () => {
  it("TC-01-017: inbox 必填字段全通过（R-101，slug 默认 inbox）", () => {
    const res = ZInboxEntry.safeParse({ type: "inbox", id: "INBOX-inbox-001", created: "2026-11-19" });
    expect(res.success).toBe(true);
    if (res.success) {
      const e: InboxEntry = res.data;
      expect(e.slug).toBe("inbox");
      expect(e.tags).toEqual([]);
      expect(e.archived).toBeNull();
    }
  });

  it("TC-01-018: inbox id 正则（R-101）", () => {
    for (const id of ["INBOX-proj-01", "INBOX-inbox-1", "INBOX--001"]) {
      const res = ZInboxEntry.safeParse({ type: "inbox", id, created: "2026-11-19" });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues.some((i) => i.path[0] === "id")).toBe(true);
    }
  });

  it("TC-01-019: inbox slug 默认与合法", () => {
    const r1 = ZInboxEntry.safeParse({ type: "inbox", id: "INBOX-inbox-001", created: "2026-11-19" });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.slug).toBe("inbox");
    const r2 = ZInboxEntry.safeParse({ type: "inbox", id: "INBOX-proj-001", created: "2026-11-19", slug: "proj" });
    expect(r2.success).toBe(true);
  });
});

describe("TC-01 编号/slug 正则（01-数据规范 §1.5，R-106）", () => {
  it("TC-01-020: 编号三位零填充", () => {
    expect(ZRequirement.safeParse({ ...baseRequirement, id: "REQ-proj-001" }).success).toBe(true);
    expect(ZRequirement.safeParse({ ...baseRequirement, id: "REQ-proj-1" }).success).toBe(false);
  });

  it("TC-01-021: slug 规范化（Zod Slug 正则，01-数据规范 §5）", () => {
    expect(Slug.safeParse("我的应用-v2").success).toBe(true);
    expect(Slug.safeParse("a--b").success).toBe(false);
    expect(Slug.safeParse("").success).toBe(false);
    // "My App"（含空格）在 Zod 正则下非法；字符串归一化（"My App"→"my-app"）属 01-数据规范 §1.5 创建期策略，S1 未实现。
    expect(Slug.safeParse("My App").success).toBe(false);
  });
});
