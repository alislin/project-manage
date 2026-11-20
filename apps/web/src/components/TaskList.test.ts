// @vitest-environment happy-dom
// 任务列表组件测试（S7，TC-06-012）：筛选/排序、逾期标红、状态徽标、行内快捷流转 PATCH 与回滚
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TaskList from "./TaskList.vue";
import { useTasksStore } from "../stores/tasks";
import { useUiStore } from "../stores/ui";
import type { TaskItem, TaskStatus } from "../api/types";

const { listTasks, patchTask, listRequirements, getTask, getRequirement, listProjects } = vi.hoisted(() => ({
  listTasks: vi.fn(),
  patchTask: vi.fn(),
  listRequirements: vi.fn(),
  getTask: vi.fn(),
  getRequirement: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../api/client", () => ({
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

/** 覆盖默认排序三要素：优先级倒序 > due 升序 > updated 倒序（06-web §11） */
const baseTasks = () => [
  task("TASK-demo-001", "todo", { priority: "P0", due: "2026-06-01", updated: "2026-01-05" }), // 逾期
  task("TASK-demo-002", "todo", { priority: "P0", due: "2026-01-01", updated: "2026-01-02" }), // 逾期
  task("TASK-demo-003", "doing", { priority: "P1", due: "2026-12-31", updated: "2026-01-06" }),
  task("TASK-demo-004", "done", { priority: "P2", due: "2026-01-01", updated: "2026-01-01" }), // done 不逾期
  task("TASK-demo-005", "cancelled", { priority: "P1", requirement: "[[REQ-x-999]]" }),
];

async function mountList(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TaskList, {
    props: { slug: "demo" },
    global: { plugins: [createPinia()] },
  });
  await flushPromises();
  return wrapper;
}

const rowIds = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll("tbody tr").map((r) => r.find(".pm-tasklist__cell-id").text());

beforeEach(() => {
  setActivePinia(createPinia());
  listTasks.mockReset();
  patchTask.mockReset();
  listRequirements.mockReset();
  getTask.mockReset();
  getRequirement.mockReset();
  listProjects.mockReset();
  listTasks.mockResolvedValue({ tasks: baseTasks() });
  listRequirements.mockResolvedValue({ requirements: [] });
});

describe("TaskList：默认排序与逾期标红（TC-06-011/012）", () => {
  it("默认排序 = 优先级倒序 > due 升序 > updated 倒序", async () => {
    const wrapper = await mountList();
    expect(rowIds(wrapper)).toEqual([
      "TASK-demo-002", // P0 due 最早
      "TASK-demo-001", // P0
      "TASK-demo-003", // P1，due 同则 updated 倒序（01-06 近者在前）
      "TASK-demo-005", // P1
      "TASK-demo-004", // P2
    ]);
  });

  it("逾期行标红（todo/doing 且 due<today）；done 不标红", async () => {
    const wrapper = await mountList();
    const overdueRows = wrapper.findAll("tbody tr.pm-tasklist__row--overdue");
    expect(overdueRows).toHaveLength(2);
    const ids = overdueRows.map((r) => r.find(".pm-tasklist__cell-id").text());
    expect(ids).toEqual(["TASK-demo-002", "TASK-demo-001"]);
    // overdue 行内 due 红色
    expect(overdueRows[0]?.find(".pm-date--overdue").exists()).toBe(true);
    // done 行无红色
    const doneRow = wrapper.findAll("tbody tr").find((r) => r.text().includes("TASK-demo-004"));
    expect(doneRow?.classes()).not.toContain("pm-tasklist__row--overdue");
  });

  it("每行展示状态徽标", async () => {
    const wrapper = await mountList();
    expect(wrapper.find(".pm-badge--todo").exists()).toBe(true);
    expect(wrapper.find(".pm-badge--doing").exists()).toBe(true);
    expect(wrapper.find(".pm-badge--done").exists()).toBe(true);
    expect(wrapper.find(".pm-badge--cancelled").exists()).toBe(true);
  });
});

describe("TaskList：筛选（TC-06-012 状态/优先级多选 + 搜索）", () => {
  it("状态多选：勾选 todo → 仅 todo 行", async () => {
    const wrapper = await mountList();
    const todoCheck = wrapper.findAll('input[type="checkbox"]').find((c) => c.element.parentElement?.textContent?.trim() === "todo");
    await todoCheck?.setValue(true);
    await flushPromises();
    expect(rowIds(wrapper)).toEqual(["TASK-demo-002", "TASK-demo-001"]);
  });

  it("优先级多选叠加状态多选", async () => {
    const wrapper = await mountList();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    // 前 4 个为状态，后 4 个为优先级
    await checkboxes[0]?.setValue(true); // todo
    await checkboxes[4]?.setValue(true); // P0
    await flushPromises();
    expect(rowIds(wrapper)).toEqual(["TASK-demo-002", "TASK-demo-001"]);
  });

  it("搜索 ID 子串", async () => {
    const wrapper = await mountList();
    await wrapper.find(".pm-tasklist__search").setValue("demo-003");
    await flushPromises();
    expect(rowIds(wrapper)).toEqual(["TASK-demo-003"]);
  });

  it("筛选后无匹配 → 『无匹配任务』空态；重置按钮恢复", async () => {
    const wrapper = await mountList();
    await wrapper.find(".pm-tasklist__search").setValue("不存在的任务");
    await flushPromises();
    expect(wrapper.find(".pm-board__state--empty").text()).toContain("无匹配任务");

    await wrapper.find(".pm-tasklist__reset").trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-tasklist__table").exists()).toBe(true);
  });
});

describe("TaskList：表头排序（TC-06-012）", () => {
  it("点击『截止』表头 → due 升序；再点切换降序", async () => {
    const wrapper = await mountList();
    const headers = wrapper.findAll("thead th .pm-tasklist__sort");
    const dueHeader = headers[3]; // 标题/状态/优先级/截止/更新

    await dueHeader?.trigger("click");
    await flushPromises();
    expect(rowIds(wrapper)).toEqual([
      "TASK-demo-002",
      "TASK-demo-004",
      "TASK-demo-001",
      "TASK-demo-003",
      "TASK-demo-005",
    ]);

    await dueHeader?.trigger("click");
    await flushPromises();
    expect(rowIds(wrapper)[0]).toBe("TASK-demo-003");
    expect(dueHeader?.find(".pm-tasklist__sort-ind").text()).toBe("▼");
  });
});

describe("TaskList：行内快捷流转（S7-7）", () => {
  it("todo 行显示 开始/完成/取消 按钮，点击 → PATCH { status, expectedMtimeMs } 且徽标乐观变更", async () => {
    patchTask.mockResolvedValue({ id: "TASK-demo-002", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1700000001000 });
    const wrapper = await mountList();

    const row = wrapper.findAll("tbody tr").find((r) => r.text().includes("TASK-demo-002")) as ReturnType<typeof wrapper.findAll>[number];
    const ops = row.findAll(".pm-tasklist__op");
    expect(ops.map((b) => b.text())).toEqual(["开始", "完成", "取消"]); // todo 的合法流转

    await ops[0]?.trigger("click");
    await flushPromises();

    expect(patchTask).toHaveBeenCalledWith("TASK-demo-002", { status: "doing", expectedMtimeMs: 1700000000000 });
    expect(row.find(".pm-badge--doing").exists()).toBe(true);
    // 流转后操作按钮刷新（doing 的合法流转 = 完成/取消）
    expect(row.findAll(".pm-tasklist__op").map((b) => b.text())).toEqual(["完成", "取消"]);
  });

  it("TC-06-007：流转失败 → 状态回滚 + toast 提示", async () => {
    const { ApiError } = await import("../api/client");
    patchTask.mockRejectedValue(
      new (ApiError as new (c: string, m: string, s: number) => Error & { code: string })(
        "E_INVALID_TRANSITION",
        "非法状态流转",
        409,
      ),
    );
    const wrapper = await mountList();
    const ui = useUiStore();

    const row = wrapper.findAll("tbody tr").find((r) => r.text().includes("TASK-demo-002")) as ReturnType<typeof wrapper.findAll>[number];
    await row.findAll(".pm-tasklist__op")[0]?.trigger("click");
    await flushPromises();

    expect(row.find(".pm-badge--todo").exists()).toBe(true); // 回滚
    expect(ui.toasts.length).toBe(1);
  });
});

describe("TaskList：详情模态与三态", () => {
  it("行点击 → 任务详情模态（TC-06-016 入口）；需求列点击 → 需求详情模态", async () => {
    getTask.mockResolvedValue({
      task: task("TASK-demo-002", "todo"),
      relatedRequirement: {
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
    });
    getRequirement.mockResolvedValue({
      requirement: {
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
      relatedTasks: [],
    });
    const wrapper = await mountList();

    await wrapper.findAll("tbody tr")[0]?.trigger("click");
    await flushPromises();
    expect(getTask).toHaveBeenCalledWith("TASK-demo-002");
    expect(wrapper.find(".pm-modal__dialog").exists()).toBe(true);

    await wrapper.find(".pm-modal__close").trigger("click");

    // 需求列链接 → 需求详情
    await wrapper.find("tbody .pm-tasklist__link").trigger("click");
    await flushPromises();
    expect(getRequirement).toHaveBeenCalledWith("REQ-demo-001");
  });

  it("加载态/错误态/空态齐全（S7-8）", async () => {
    listTasks.mockReturnValue(new Promise(() => {}));
    const loading = mount(TaskList, { props: { slug: "demo" }, global: { plugins: [createPinia()] } });
    await flushPromises();
    expect((loading as ReturnType<typeof mount>).find(".pm-board__state").text()).toContain("加载中…");

    listTasks.mockRejectedValueOnce(new Error("boom"));
    const failed = await mountList();
    expect(failed.find(".pm-board__state--error").exists()).toBe(true);

    listTasks.mockResolvedValue({ tasks: [] });
    const empty = await mountList();
    expect(empty.find(".pm-board__state--empty").text()).toContain("暂无任务");
  });
});
