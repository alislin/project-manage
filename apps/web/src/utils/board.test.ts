// 看板纯逻辑单元测试（S7）：流转表 / 逾期 / 筛选 / 排序 / 分组，测试名标注 TC 编号
import { describe, expect, it } from "vitest";
import {
  MOVE_LABELS,
  defaultSortTasks,
  filterRequirements,
  filterTasks,
  groupRequirements,
  groupTasks,
  isTaskOverdue,
  legalReqTargets,
  legalTaskTargets,
  requirementModuleOptions,
  sortTaskItems,
  todayIso,
  wikiId,
} from "./board";
import type { RequirementItem, TaskItem } from "../api/types";

function req(over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    type: "requirement",
    id: "REQ-demo-001",
    title: "需求一",
    status: "pool",
    priority: "P2",
    module: "",
    source: "来源说明",
    created: "2026-01-01",
    updated: "2026-01-02",
    mtimeMs: 1700000000000,
    ...over,
  };
}

function task(over: Partial<TaskItem> = {}): TaskItem {
  return {
    type: "task",
    id: "TASK-demo-001",
    title: "任务一",
    status: "todo",
    requirement: "[[REQ-demo-001]]",
    priority: "P2",
    due: "2026-12-31",
    completed: null,
    created: "2026-01-01",
    updated: "2026-01-02",
    mtimeMs: 1700000000000,
    ...over,
  };
}

describe("board utils：状态流转表（01-数据规范 §3.2/§3.3 同源）", () => {
  it("TC-06-005 前置：需求流转表（done 终态；rejected→pool 退回）", () => {
    expect(legalReqTargets("pool")).toEqual(["reviewing", "rejected"]);
    expect(legalReqTargets("reviewing")).toEqual(["accepted", "rejected"]);
    expect(legalReqTargets("accepted")).toEqual(["done"]);
    expect(legalReqTargets("rejected")).toEqual(["pool"]);
    expect(legalReqTargets("done")).toEqual([]);
  });

  it("TC-06-007 前置：任务流转表（doing→todo 不可回退；done 终态；cancelled→todo）", () => {
    expect(legalTaskTargets("todo")).toEqual(["doing", "done", "cancelled"]);
    expect(legalTaskTargets("doing")).toEqual(["done", "cancelled"]);
    expect(legalTaskTargets("done")).toEqual([]);
    expect(legalTaskTargets("cancelled")).toEqual(["todo"]);
  });

  it("流转按钮文案覆盖所有目标状态", () => {
    expect(MOVE_LABELS["doing"]).toBe("开始");
    expect(MOVE_LABELS["cancelled"]).toBe("取消");
    expect(MOVE_LABELS["pool"]).toBe("退回重塑");
  });
});

describe("board utils：逾期与日期（02-core §2.4 口径）", () => {
  it("TC-06-011：todo/doing 且 due<today → 逾期；done/cancelled 与今天到期不逾期", () => {
    expect(isTaskOverdue(task({ status: "todo", due: "2026-01-01" }), "2026-11-20")).toBe(true);
    expect(isTaskOverdue(task({ status: "doing", due: "2026-11-19" }), "2026-11-20")).toBe(true);
    expect(isTaskOverdue(task({ status: "done", due: "2026-01-01" }), "2026-11-20")).toBe(false);
    expect(isTaskOverdue(task({ status: "cancelled", due: "2026-01-01" }), "2026-11-20")).toBe(false);
    expect(isTaskOverdue(task({ status: "todo", due: "2026-11-20" }), "2026-11-20")).toBe(false);
  });

  it("todayIso 输出 YYYY-MM-DD 本地日期", () => {
    expect(todayIso(new Date(2026, 10, 20, 10, 30))).toBe("2026-11-20");
  });
});

describe("board utils：wiki-link 解析（01-数据规范 §6.1）", () => {
  it("[[REQ-x-001]] → REQ-x-001；非 wiki 形式返回空串", () => {
    expect(wikiId("[[REQ-demo-001]]")).toBe("REQ-demo-001");
    expect(wikiId("REQ-demo-001")).toBe("");
    expect(wikiId("")).toBe("");
  });
});

describe("board utils：需求筛选（S7-6 module + priority）", () => {
  const items = [
    req({ id: "REQ-demo-001", module: "core", priority: "P0" }),
    req({ id: "REQ-demo-002", module: "web", priority: "P1" }),
    req({ id: "REQ-demo-003", module: "core", priority: "P1" }),
    req({ id: "REQ-demo-004", module: "", priority: "P2" }),
  ];

  it("按 module 筛选（空 module 项被排除）", () => {
    const ids = filterRequirements(items, { module: "core", priority: "" }).map((r) => r.id);
    expect(ids).toEqual(["REQ-demo-001", "REQ-demo-003"]);
  });

  it("按 priority 筛选；两者叠加", () => {
    expect(filterRequirements(items, { module: "", priority: "P1" }).map((r) => r.id)).toEqual([
      "REQ-demo-002",
      "REQ-demo-003",
    ]);
    expect(filterRequirements(items, { module: "core", priority: "P0" }).map((r) => r.id)).toEqual(["REQ-demo-001"]);
  });

  it("全部（不筛选）→ 不筛除任何项", () => {
    expect(filterRequirements(items, { module: "", priority: "" })).toHaveLength(4);
  });

  it("moduleOptions：非空模块去重 + 字典序", () => {
    expect(requirementModuleOptions(items)).toEqual(["core", "web"]);
  });
});

describe("board utils：任务筛选（TC-06-012 状态/优先级多选 + 搜索）", () => {
  const items = [
    task({ id: "TASK-demo-001", status: "todo", priority: "P0", title: "登录页改造" }),
    task({ id: "TASK-demo-002", status: "doing", priority: "P1", title: "看板拖拽" }),
    task({ id: "TASK-demo-003", status: "done", priority: "P0", title: "数据层" }),
    task({ id: "TASK-demo-004", status: "cancelled", priority: "P2", title: "旧版迁移" }),
  ];

  it("状态多选（空数组 = 全部）", () => {
    expect(filterTasks(items, { statuses: ["todo", "doing"], priorities: [], query: "" })).toHaveLength(2);
    expect(filterTasks(items, { statuses: [], priorities: [], query: "" })).toHaveLength(4);
  });

  it("优先级多选叠加状态多选", () => {
    const ids = filterTasks(items, { statuses: ["todo", "done"], priorities: ["P0"], query: "" }).map((t) => t.id);
    expect(ids).toEqual(["TASK-demo-001", "TASK-demo-003"]);
  });

  it("搜索 ID/标题子串（大小写不敏感）", () => {
    expect(filterTasks(items, { statuses: [], priorities: [], query: "demo-002" }).map((t) => t.id)).toEqual([
      "TASK-demo-002",
    ]);
    expect(filterTasks(items, { statuses: [], priorities: [], query: "拖拽" }).map((t) => t.id)).toEqual([
      "TASK-demo-002",
    ]);
  });
});

describe("board utils：任务排序（06-web §11）", () => {
  const a = task({ id: "TASK-demo-001", priority: "P0", due: "2026-06-01", updated: "2026-01-05" });
  const b = task({ id: "TASK-demo-002", priority: "P0", due: "2026-01-01", updated: "2026-01-02" });
  const c = task({ id: "TASK-demo-003", priority: "P1", due: "2026-12-31", updated: "2026-01-06" });
  const d = task({ id: "TASK-demo-004", priority: "P2", due: "2026-01-01", updated: "2026-01-03" });

  it("TC-06-012：默认排序 = 优先级倒序 > due 升序 > updated 倒序", () => {
    expect(defaultSortTasks([d, c, b, a]).map((t) => t.id)).toEqual([
      "TASK-demo-002", // P0，due 最早
      "TASK-demo-001", // P0，due 较晚
      "TASK-demo-003", // P1
      "TASK-demo-004", // P2
    ]);
  });

  it("同优先级同 due → updated 倒序（近者在前）", () => {
    const e = task({ id: "TASK-demo-005", priority: "P1", due: "2026-06-01", updated: "2026-02-01" });
    const f = task({ id: "TASK-demo-006", priority: "P1", due: "2026-06-01", updated: "2026-01-15" });
    expect(defaultSortTasks([f, e]).map((t) => t.id)).toEqual(["TASK-demo-005", "TASK-demo-006"]);
  });

  it("显式表头排序：due 升/降序切换", () => {
    const items = [a, b, c, d];
    expect(sortTaskItems(items, "due", 1).map((t) => t.id)).toEqual([
      "TASK-demo-002",
      "TASK-demo-004",
      "TASK-demo-001",
      "TASK-demo-003",
    ]);
    expect(sortTaskItems(items, "due", -1).map((t) => t.id)).toEqual([
      "TASK-demo-003",
      "TASK-demo-001",
      "TASK-demo-002",
      "TASK-demo-004",
    ]);
  });

  it("显式表头排序：status 按枚举序、priority 按 P0 前", () => {
    const items = [d, c, b, a];
    expect(sortTaskItems(items, "status", 1).map((t) => t.id)[0]).toBe("TASK-demo-001"); // todo 最前
    expect(sortTaskItems(items, "priority", 1).map((t) => t.id)[0]).toBe("TASK-demo-001"); // P0 最前
  });
});

describe("board utils：看板分组（06-web §6.1 四栏）", () => {
  it("TC-06-004：需求按状态分组到五泳道（done/rejected 同列双泳道）", () => {
    const grouped = groupRequirements([
      req({ id: "REQ-demo-001", status: "pool" }),
      req({ id: "REQ-demo-002", status: "reviewing" }),
      req({ id: "REQ-demo-003", status: "accepted" }),
      req({ id: "REQ-demo-004", status: "done" }),
      req({ id: "REQ-demo-005", status: "rejected" }),
    ]);
    expect(Object.keys(grouped)).toEqual(["pool", "reviewing", "accepted", "rejected", "done"]);
    expect(grouped.done.map((r) => r.id)).toEqual(["REQ-demo-004"]);
    expect(grouped.rejected.map((r) => r.id)).toEqual(["REQ-demo-005"]);
  });

  it("TC-06-009：任务按状态分组四栏", () => {
    const grouped = groupTasks([
      task({ id: "TASK-demo-001", status: "todo" }),
      task({ id: "TASK-demo-002", status: "doing" }),
      task({ id: "TASK-demo-003", status: "done" }),
      task({ id: "TASK-demo-004", status: "cancelled" }),
    ]);
    expect(Object.keys(grouped)).toEqual(["todo", "doing", "done", "cancelled"]);
    expect(grouped.todo).toHaveLength(1);
  });
});
