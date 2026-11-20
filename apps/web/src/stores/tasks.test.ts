// 任务 store 测试（S7）：PATCH payload、回滚、409 自动重试一次（Q-05）、module 经关联需求解析筛选
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRequirementsStore } from "./requirements";
import { useTasksStore } from "./tasks";
import { useUiStore } from "./ui";
import type { TaskItem, TaskStatus } from "../api/types";

const { listTasks, patchTask, listRequirements } = vi.hoisted(() => ({
  listTasks: vi.fn(),
  patchTask: vi.fn(),
  listRequirements: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: { listTasks, patchTask, listRequirements },
  ApiError: class MockApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  setApiErrorHandler: () => {},
}));

function task(id: string, status: TaskStatus, over: Partial<TaskItem> = {}): TaskItem {
  return {
    type: "task",
    id,
    title: `任务 ${id}`,
    status,
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

describe("tasks store：加载与 module 解析筛选（S7-6）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listTasks.mockReset();
    patchTask.mockReset();
    listRequirements.mockReset();
  });

  it("load() 成功 → items 填充", async () => {
    listTasks.mockResolvedValue({ tasks: [task("TASK-demo-001", "todo")] });
    const store = useTasksStore();
    await store.load("demo");
    expect(store.items).toHaveLength(1);
    expect(store.activeSlug).toBe("demo");
  });

  it("moduleOf 经关联需求解析；悬空链接 → 空串", async () => {
    listRequirements.mockResolvedValue({
      requirements: [
        {
          type: "requirement",
          id: "REQ-demo-001",
          title: "需求一",
          status: "accepted",
          priority: "P2",
          module: "core",
          source: "来源",
          created: "2026-01-01",
          updated: "2026-01-02",
          mtimeMs: 1700000000000,
        },
      ],
    });
    listTasks.mockResolvedValue({
      tasks: [task("TASK-demo-001", "todo"), task("TASK-demo-002", "todo", { requirement: "[[REQ-x-999]]" })],
    });
    const reqStore = useRequirementsStore();
    const store = useTasksStore();
    await reqStore.load("demo");
    await store.load("demo");

    expect(store.moduleOf(store.items[0] as TaskItem)).toBe("core");
    expect(store.moduleOf(store.items[1] as TaskItem)).toBe("");
  });

  it("module 筛选：仅保留关联需求 module 匹配的任务（悬空被排除）", async () => {
    listRequirements.mockResolvedValue({
      requirements: [
        {
          type: "requirement",
          id: "REQ-demo-001",
          title: "需求一",
          status: "accepted",
          priority: "P2",
          module: "core",
          source: "来源",
          created: "2026-01-01",
          updated: "2026-01-02",
          mtimeMs: 1700000000000,
        },
      ],
    });
    listTasks.mockResolvedValue({
      tasks: [task("TASK-demo-001", "todo"), task("TASK-demo-002", "doing", { requirement: "[[REQ-x-999]]", priority: "P1" })],
    });
    const reqStore = useRequirementsStore();
    const store = useTasksStore();
    await reqStore.load("demo");
    await store.load("demo");

    store.moduleFilter = "core";
    expect(store.filtered.map((t) => t.id)).toEqual(["TASK-demo-001"]);
    store.moduleFilter = "";
    expect(store.filtered).toHaveLength(2);

    store.priorityFilter = "P1";
    expect(store.filtered.map((t) => t.id)).toEqual(["TASK-demo-002"]); // 仅 P1 留存
    store.priorityFilter = "";
  });
});

describe("tasks store：moveStatus（06-web §3.1 乐观更新）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listTasks.mockReset();
    patchTask.mockReset();
    listRequirements.mockReset();
    listTasks.mockResolvedValue({
      tasks: [task("TASK-demo-001", "todo"), task("TASK-demo-002", "doing")],
    });
  });

  it("TC-06-010：拖拽流转 → PATCH { status, expectedMtimeMs }，乐观移动 + 回填 mtimeMs", async () => {
    patchTask.mockResolvedValue({ id: "TASK-demo-001", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1700000001000 });
    const store = useTasksStore();
    await store.load("demo");

    const res = await store.moveStatus("TASK-demo-001", "doing");

    expect(res).toMatchObject({ ok: true });
    expect(patchTask).toHaveBeenCalledWith("TASK-demo-001", { status: "doing", expectedMtimeMs: 1700000000000 });
    expect(store.byId("TASK-demo-001")?.status).toBe("doing");
    expect(store.byId("TASK-demo-001")?.mtimeMs).toBe(1700000001000);
  });

  it("TC-06-007：非法流转失败 → 回滚 + toast", async () => {
    const { ApiError } = await import("../api/client");
    patchTask.mockRejectedValue(new (ApiError as new (c: string, m: string, s: number) => Error & { code: string })("E_INVALID_TRANSITION", "非法状态流转: doing -> todo", 409));
    const store = useTasksStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("TASK-demo-002", "todo");
    expect(res).toMatchObject({ ok: false, reason: "error" });
    expect(store.byId("TASK-demo-002")?.status).toBe("doing");
    expect(ui.toasts.length).toBe(1);
  });

  it("TC-06-006 / Q-05：409 → 刷新 → 自动重试一次成功", async () => {
    const { ApiError } = await import("../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    patchTask
      .mockRejectedValueOnce(new Ctor("E_CONFLICT", "冲突", 409))
      .mockResolvedValueOnce({ id: "TASK-demo-001", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1899999999999 });
    listTasks
      .mockResolvedValueOnce({ tasks: [task("TASK-demo-001", "todo")] })
      .mockResolvedValue({ tasks: [task("TASK-demo-001", "todo", { mtimeMs: 1899999999999 })] });

    const store = useTasksStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("TASK-demo-001", "doing");
    expect(res).toMatchObject({ ok: true, retried: true });
    expect(patchTask).toHaveBeenNthCalledWith(2, "TASK-demo-001", { status: "doing", expectedMtimeMs: 1899999999999 });
    expect(store.byId("TASK-demo-001")?.status).toBe("doing");
    expect(ui.toasts.some((t) => t.tone === "info")).toBe(true);
  });

  it("TC-06-006：重试仍 409 → 回滚 + ui.conflict 冲突弹窗", async () => {
    const { ApiError } = await import("../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    const conflict = () => new Ctor("E_CONFLICT", "冲突", 409);
    patchTask.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    listTasks
      .mockResolvedValueOnce({ tasks: [task("TASK-demo-001", "todo")] })
      .mockResolvedValue({ tasks: [task("TASK-demo-001", "todo", { mtimeMs: 1899999999999 })] });

    const store = useTasksStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("TASK-demo-001", "doing");
    expect(res).toMatchObject({ ok: false, conflict: true, retried: true });
    expect(store.byId("TASK-demo-001")?.status).toBe("todo");
    expect(ui.conflict?.entity).toBe("task");
    expect(ui.conflict?.message).toContain("刷新并重试");
  });
});
