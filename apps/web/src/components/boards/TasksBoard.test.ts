// @vitest-environment happy-dom
// 任务看板组件测试（S7）：四栏、拖拽 PATCH payload、逾期标红（TC-06-011）、module 筛选、回滚
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TasksBoard from "./TasksBoard.vue";
import { useUiStore } from "../../stores/ui";
import type { TaskItem, TaskStatus } from "../../api/types";

const { listTasks, patchTask, listRequirements, getTask, getRequirement, listProjects } = vi.hoisted(() => ({
  listTasks: vi.fn(),
  patchTask: vi.fn(),
  listRequirements: vi.fn(),
  getTask: vi.fn(),
  getRequirement: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { listTasks, patchTask, listRequirements, getTask, getRequirement, listProjects },
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

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: { slug: "demo" } }),
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

const baseTasks = () => [
  // 逾期：todo + due < today（TC-06-011）
  task("TASK-demo-001", "todo", { due: "2026-01-01", priority: "P1", estimate: 2 }),
  task("TASK-demo-002", "doing"),
  task("TASK-demo-003", "done"),
  task("TASK-demo-004", "cancelled"),
  // 悬空需求链接的任务（module 筛选应排除）
  task("TASK-demo-005", "todo", { requirement: "[[REQ-x-999]]" }),
];

const baseRequirements = () => ({
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

async function mountBoard(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TasksBoard, {
    props: { slug: "demo" },
    global: { plugins: [createPinia()] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  listTasks.mockReset();
  patchTask.mockReset();
  listRequirements.mockReset();
  getTask.mockReset();
  getRequirement.mockReset();
  listProjects.mockReset();
  listTasks.mockResolvedValue({ tasks: baseTasks() });
  listRequirements.mockResolvedValue(baseRequirements());
});

describe("TasksBoard：四栏与卡片（TC-06-009）", () => {
  it("todo/doing/done/cancelled 四栏存在，TaskCard 含 due/estimate", async () => {
    const wrapper = await mountBoard();

    const titles = wrapper.findAll(".pm-column__title").map((n) => n.text());
    expect(titles).toEqual(["Todo", "Doing", "Done", "Cancelled"]);
    expect(wrapper.find('.pm-column__lane[data-status="todo"]').text()).toContain("TASK-demo-001");
    expect(wrapper.find(".pm-task-card__due").exists()).toBe(true);
    expect(wrapper.find(".pm-task-card__estimate").text()).toContain("2d");
    // 卡片 module 来自关联需求（01-数据规范 §6.1）
    expect(wrapper.find(".pm-task-card__module").text()).toBe("core");
  });

  it("TC-06-011：逾期任务 due 标红，未逾期不标红", async () => {
    const wrapper = await mountBoard();

    const overdueCard = wrapper.find('.pm-task-card[data-id="TASK-demo-001"]');
    expect(overdueCard.find(".pm-date--overdue").exists()).toBe(true);

    const okCard = wrapper.find('.pm-task-card[data-id="TASK-demo-002"]');
    expect(okCard.find(".pm-date--overdue").exists()).toBe(false);
  });
});

describe("TasksBoard：拖拽流转（06-web §3.1）", () => {
  it("TC-06-010：drop → PATCH /api/tasks/:id { status, expectedMtimeMs }，乐观落列", async () => {
    patchTask.mockResolvedValue({ id: "TASK-demo-001", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1700000001000 });
    const wrapper = await mountBoard();

    const lane = wrapper.find('.pm-column__lane[data-status="doing"]');
    await lane.trigger("dragover");
    await lane.trigger("drop", { dataTransfer: { getData: () => "TASK-demo-001" } });
    await flushPromises();

    expect(patchTask).toHaveBeenCalledTimes(1);
    expect(patchTask).toHaveBeenCalledWith("TASK-demo-001", {
      status: "doing",
      expectedMtimeMs: 1700000000000,
    });
    expect(wrapper.find('.pm-column__lane[data-status="doing"]').text()).toContain("TASK-demo-001");
    expect(wrapper.find('.pm-column__lane[data-status="todo"]').text()).not.toContain("TASK-demo-001");
  });

  it("TC-06-007：非法流转失败 → 回滚原列 + 提示", async () => {
    const { ApiError } = await import("../../api/client");
    patchTask.mockRejectedValue(
      new (ApiError as new (c: string, m: string, s: number) => Error & { code: string })(
        "E_INVALID_TRANSITION",
        "非法状态流转: done -> doing",
        409,
      ),
    );
    const wrapper = await mountBoard();
    const ui = useUiStore();

    const lane = wrapper.find('.pm-column__lane[data-status="doing"]');
    await lane.trigger("drop", { dataTransfer: { getData: () => "TASK-demo-003" } });
    await flushPromises();

    expect(wrapper.find('.pm-column__lane[data-status="done"]').text()).toContain("TASK-demo-003");
    expect(ui.toasts.length).toBe(1);
  });

  it("TC-06-006 / Q-05：409 → 自动刷新重试一次成功", async () => {
    const { ApiError } = await import("../../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    patchTask
      .mockRejectedValueOnce(new Ctor("E_CONFLICT", "冲突", 409))
      .mockResolvedValueOnce({ id: "TASK-demo-001", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1899999999999 });
    listTasks
      .mockResolvedValueOnce({ tasks: baseTasks() })
      .mockResolvedValue({ tasks: baseTasks().map((t) => (t.id === "TASK-demo-001" ? { ...t, mtimeMs: 1899999999999 } : t)) });

    const wrapper = await mountBoard();
    const lane = wrapper.find('.pm-column__lane[data-status="doing"]');
    await lane.trigger("drop", { dataTransfer: { getData: () => "TASK-demo-001" } });
    await flushPromises();
    await flushPromises();

    expect(patchTask).toHaveBeenNthCalledWith(2, "TASK-demo-001", {
      status: "doing",
      expectedMtimeMs: 1899999999999,
    });
    expect(wrapper.find('.pm-column__lane[data-status="doing"]').text()).toContain("TASK-demo-001");
  });

  it("TC-06-006：重试仍 409 → 冲突弹窗（刷新并重试/取消）", async () => {
    const { ApiError } = await import("../../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    const conflict = () => new Ctor("E_CONFLICT", "冲突", 409);
    patchTask.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    const wrapper = await mountBoard();

    const lane = wrapper.find('.pm-column__lane[data-status="doing"]');
    await lane.trigger("drop", { dataTransfer: { getData: () => "TASK-demo-001" } });
    await flushPromises();
    await flushPromises();

    expect(wrapper.find(".pm-conflict").exists()).toBe(true);
    expect(wrapper.find(".pm-conflict").text()).toContain("刷新并重试");
    expect(wrapper.find('.pm-column__lane[data-status="todo"]').text()).toContain("TASK-demo-001");
  });
});

describe("TasksBoard：module 筛选（S7-6，经关联需求解析）", () => {
  it("选 module=core → 仅保留链接到 core 模块需求的任务；悬空任务被排除", async () => {
    const wrapper = await mountBoard();

    const select = wrapper.findAll("select")[0];
    await select?.setValue("core");
    await flushPromises();

    const todoLane = wrapper.find('.pm-column__lane[data-status="todo"]');
    expect(todoLane.text()).toContain("TASK-demo-001");
    expect(todoLane.text()).not.toContain("TASK-demo-005"); // 悬空链接被排除

    // 恢复全部
    await select?.setValue("");
    await flushPromises();
    expect(wrapper.find('.pm-column__lane[data-status="todo"]').text()).toContain("TASK-demo-005");
  });
});

describe("TasksBoard：三态（S7-8）", () => {
  it("加载态/错误态/空态", async () => {
    // 加载态
    listTasks.mockReturnValue(new Promise(() => {}));
    const loading = mount(TasksBoard, { props: { slug: "demo" }, global: { plugins: [createPinia()] } });
    await flushPromises();
    expect((loading as ReturnType<typeof mount>).find(".pm-board__state").text()).toContain("加载中…");

    // 错误态 + 重试
    listTasks.mockRejectedValueOnce(new Error("boom"));
    const failed = await mountBoard();
    expect(failed.find(".pm-board__state--error").exists()).toBe(true);
    listTasks.mockResolvedValue({ tasks: baseTasks() });
    await failed.find(".pm-board__state--error button").trigger("click");
    await flushPromises();
    expect(failed.find(".pm-board__grid").exists()).toBe(true);

    // 空态
    listTasks.mockResolvedValue({ tasks: [] });
    const empty = await mountBoard();
    expect(empty.find(".pm-board__state--empty").text()).toContain("任务看板为空");
  });
});
