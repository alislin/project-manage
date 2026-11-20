// @vitest-environment happy-dom
// 任务详情模态测试（S7，TC-06-016）：全字段、需求链接可点击跳转、状态流转 PATCH、悬空链接
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TaskDetailModal from "./TaskDetailModal.vue";
import { useTasksStore } from "../../stores/tasks";
import type { TaskItem, TaskStatus } from "../../api/types";

const { getTask, patchTask, listTasks } = vi.hoisted(() => ({
  getTask: vi.fn(),
  patchTask: vi.fn(),
  listTasks: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { getTask, patchTask, listTasks },
  ApiError: class MockApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  setApiErrorHandler: () => {},
}));

function task(id: string, status: TaskStatus, requirement = "[[REQ-demo-001]]"): TaskItem {
  return {
    type: "task",
    id,
    title: "手机号登录",
    status,
    requirement,
    priority: "P1",
    estimate: 3,
    due: "2026-12-31",
    completed: null,
    created: "2026-01-01",
    updated: "2026-01-02",
    mtimeMs: 1700000000000,
  };
}

const relatedRequirement = {
  type: "requirement",
  id: "REQ-demo-001",
  title: "登录页改造",
  status: "accepted",
  priority: "P1",
  module: "web",
  source: "来源",
  created: "2026-01-01",
  updated: "2026-01-02",
  mtimeMs: 1700000000000,
};

async function mountModal(status: TaskStatus = "todo", requirement = "[[REQ-demo-001]]"): Promise<ReturnType<typeof mount>> {
  // 流转按钮走 store.moveStatus（与看板同源）；组件与测试共享同一 Pinia 实例
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useTasksStore();
  listTasks.mockResolvedValue({ tasks: [task("TASK-demo-001", status, requirement)] });
  await store.load("demo");

  getTask.mockResolvedValue({
    task: task("TASK-demo-001", status, requirement),
    relatedRequirement: requirement === "[[REQ-demo-001]]" ? relatedRequirement : undefined,
  });
  const wrapper = mount(TaskDetailModal, {
    props: { taskId: "TASK-demo-001" },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getTask.mockReset();
  patchTask.mockReset();
  listTasks.mockReset();
});

describe("TaskDetailModal（TC-06-016）", () => {
  it("展示 frontmatter 全字段（status/requirement/priority/due/estimate/completed 等）", async () => {
    const wrapper = await mountModal("todo");
    const fields = wrapper.find('[data-testid="task-fields"]').text();
    for (const field of ["TASK-demo-001", "手机号登录", "todo", "REQ-demo-001", "P1", "2026-12-31", "3 人日", "未完成", "2026-01-01", "2026-01-02", "mtimeMs"]) {
      expect(fields).toContain(field);
    }
  });

  it("需求链接可点击 → 发出 openRequirement（05-server §3.4 relatedRequirement）", async () => {
    const wrapper = await mountModal("todo");
    const linkBtn = wrapper.findAll(".pm-modal__link-btn").find((b) => b.text() === "REQ-demo-001");
    expect(linkBtn).toBeDefined();
    await linkBtn?.trigger("click");
    expect(wrapper.emitted("openRequirement")?.[0]).toEqual(["REQ-demo-001"]);
    // 关联需求区块同时展示标题与状态
    expect(wrapper.find(".pm-modal__links").text()).toContain("登录页改造");
  });

  it("悬空需求链接（relatedRequirement 缺失）→ 展示原文 + 悬空提示，不可点击", async () => {
    const wrapper = await mountModal("todo", "[[REQ-x-999]]");
    expect(wrapper.text()).toContain("悬空链接");
    expect(wrapper.findAll(".pm-modal__link-btn")).toHaveLength(0);
  });

  it("todo → 合法流转按钮（开始/完成/取消），点击 PATCH 成功后重载详情", async () => {
    const wrapper = await mountModal("todo");
    const flow = wrapper.findAll(".pm-modal__flow-btn");
    expect(flow.map((b) => b.text())).toEqual(["开始 → doing", "完成 → done", "取消 → cancelled"]);

    patchTask.mockResolvedValue({ id: "TASK-demo-001", from: "todo", to: "doing", updatedField: "updated", mtimeMs: 1700000001000 });
    await flow[0]?.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(patchTask).toHaveBeenCalledWith("TASK-demo-001", { status: "doing", expectedMtimeMs: 1700000000000 });
    expect(wrapper.emitted("moved")?.[0]).toEqual(["doing"]);
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it("done 终态 → 无流转按钮", async () => {
    const wrapper = await mountModal("done");
    expect(wrapper.findAll(".pm-modal__flow-btn")).toHaveLength(0);
    expect(wrapper.find(".pm-modal__flow-none").text()).toContain("终态");
  });
});
