// @vitest-environment happy-dom
// 需求池看板组件测试（S7）：四栏渲染、拖拽回调 PATCH payload、乐观回滚、409 冲突流程、筛选、三态
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import RequirementsBoard from "./RequirementsBoard.vue";
import { useRequirementsStore } from "../../stores/requirements";
import { useUiStore } from "../../stores/ui";
import type { ReqStatus, RequirementItem } from "../../api/types";

const { listRequirements, patchRequirement, getRequirement, getTask, listTasks, listProjects } = vi.hoisted(() => ({
  listRequirements: vi.fn(),
  patchRequirement: vi.fn(),
  getRequirement: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { listRequirements, patchRequirement, getRequirement, getTask, listTasks, listProjects },
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

function req(id: string, status: ReqStatus, mtimeMs = 1700000000000, over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    type: "requirement",
    id,
    title: `需求 ${id}`,
    status,
    priority: "P2",
    module: "core",
    source: "来源说明",
    created: "2026-01-01",
    updated: "2026-01-02",
    mtimeMs,
    ...over,
  };
}

function task(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "task",
    id,
    title: `任务 ${id}`,
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

const baseList = () => ({
  requirements: [
    req("REQ-demo-001", "pool"),
    req("REQ-demo-002", "pool", 1700000000000, { module: "web", priority: "P1" }),
    req("REQ-demo-003", "reviewing"),
    req("REQ-demo-004", "accepted"),
    req("REQ-demo-005", "done"),
    req("REQ-demo-006", "rejected"),
  ],
});

async function mountBoard(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(RequirementsBoard, {
    props: { slug: "demo" },
    global: { plugins: [createPinia()] },
  });
  await flushPromises();
  return wrapper;
}

/** 模拟跨列拖放（HTML5 DnD：dragover 高亮 + drop 携带 dataTransfer） */
async function dropCard(wrapper: ReturnType<typeof mount>, toStatus: string, id: string): Promise<void> {
  const lane = wrapper.find(`.pm-column__lane[data-status="${toStatus}"]`);
  await lane.trigger("dragover");
  await lane.trigger("drop", { dataTransfer: { getData: () => id } });
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  listRequirements.mockReset();
  patchRequirement.mockReset();
  getRequirement.mockReset();
  getTask.mockReset();
  listTasks.mockReset();
  listProjects.mockReset();
  listRequirements.mockResolvedValue(baseList());
});

describe("RequirementsBoard：四栏与卡片（TC-06-004）", () => {
  it("四栏存在（Pool/Reviewing/Accepted/Done + Rejected），卡片按状态落列", async () => {
    const wrapper = await mountBoard();

    const titles = wrapper.findAll(".pm-column__title").map((n) => n.text());
    expect(titles).toEqual(["Pool", "Reviewing", "Accepted", "Done + Rejected"]);
    // 第 4 列双泳道：done + rejected
    expect(wrapper.find('.pm-column__lane[data-status="done"]').exists()).toBe(true);
    expect(wrapper.find('.pm-column__lane[data-status="rejected"]').exists()).toBe(true);
    // 卡片按状态分组
    expect(wrapper.find('.pm-column__lane[data-status="pool"]').text()).toContain("REQ-demo-001");
    expect(wrapper.find('.pm-column__lane[data-status="reviewing"]').text()).toContain("REQ-demo-003");
    // 卡片含 priority 圆点与状态徽标
    expect(wrapper.find(".pm-req-card .pm-dot").exists()).toBe(true);
    expect(wrapper.find(".pm-req-card .pm-badge--pool").exists()).toBe(true);
  });
});

describe("RequirementsBoard：拖拽流转（06-web §3.1）", () => {
  it("TC-06-005：drop → PATCH { status, expectedMtimeMs }，乐观更新卡片落新列", async () => {
    patchRequirement.mockResolvedValue({ id: "REQ-demo-001", from: "pool", to: "reviewing", updatedField: "updated", mtimeMs: 1700000001000 });
    const wrapper = await mountBoard();

    await dropCard(wrapper, "reviewing", "REQ-demo-001");

    expect(patchRequirement).toHaveBeenCalledTimes(1);
    expect(patchRequirement).toHaveBeenCalledWith("REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1700000000000,
    });
    expect(wrapper.find('.pm-column__lane[data-status="reviewing"]').text()).toContain("REQ-demo-001");
    expect(wrapper.find('.pm-column__lane[data-status="pool"]').text()).not.toContain("REQ-demo-001");
  });

  it("拖拽悬停高亮目标列（06-web §6 步骤 1 showDropZone）", async () => {
    const wrapper = await mountBoard();
    const lane = wrapper.find('.pm-column__lane[data-status="accepted"]');
    await lane.trigger("dragover");
    expect(lane.classes()).toContain("pm-column__lane--over");
  });

  it("TC-06-007：非法流转失败 → 卡片回滚原列 + 提示", async () => {
    const { ApiError } = await import("../../api/client");
    patchRequirement.mockRejectedValue(
      new (ApiError as new (c: string, m: string, s: number) => Error & { code: string })(
        "E_INVALID_TRANSITION",
        "非法状态流转: pool -> done（01-数据规范 §3.4）",
        409,
      ),
    );
    const wrapper = await mountBoard();
    const ui = useUiStore();

    await dropCard(wrapper, "done", "REQ-demo-001");

    expect(patchRequirement).toHaveBeenCalledTimes(1); // 非冲突不自动重试
    expect(wrapper.find('.pm-column__lane[data-status="pool"]').text()).toContain("REQ-demo-001");
    expect(wrapper.find('.pm-column__lane[data-status="done"]').text()).not.toContain("REQ-demo-001");
    expect(ui.toasts.length).toBe(1);
  });

  it("TC-06-006 / Q-05：409 → 自动刷新重试一次（新 mtimeMs）→ 成功", async () => {
    const { ApiError } = await import("../../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    patchRequirement
      .mockRejectedValueOnce(new Ctor("E_CONFLICT", "文件已被外部修改", 409))
      .mockResolvedValueOnce({ id: "REQ-demo-001", from: "pool", to: "reviewing", updatedField: "updated", mtimeMs: 1899999999999 });
    listRequirements
      .mockResolvedValueOnce(baseList())
      .mockResolvedValue({ requirements: baseList().requirements.map((r) => (r.id === "REQ-demo-001" ? { ...r, mtimeMs: 1899999999999 } : r)) });

    const wrapper = await mountBoard();
    await dropCard(wrapper, "reviewing", "REQ-demo-001");
    await flushPromises();
    await flushPromises();

    expect(patchRequirement).toHaveBeenCalledTimes(2);
    expect(patchRequirement).toHaveBeenNthCalledWith(2, "REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1899999999999,
    });
    expect(wrapper.find('.pm-column__lane[data-status="reviewing"]').text()).toContain("REQ-demo-001");
  });

  it("TC-06-006：重试仍 409 → 冲突弹窗（刷新并重试/取消）→ 取消关闭弹窗", async () => {
    const { ApiError } = await import("../../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    const conflict = () => new Ctor("E_CONFLICT", "文件已被外部修改", 409);
    patchRequirement.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    const wrapper = await mountBoard();

    await dropCard(wrapper, "reviewing", "REQ-demo-001");
    await flushPromises();
    await flushPromises();

    // 冲突弹窗可见（Q-05 定案文案）
    const dialog = wrapper.find(".pm-conflict");
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain("文件已被外部修改（mtime 冲突），是否刷新并重试？");

    // 卡片已回滚
    expect(wrapper.find('.pm-column__lane[data-status="pool"]').text()).toContain("REQ-demo-001");

    // 取消 → 关闭弹窗
    const buttons = dialog.findAll("button");
    await buttons.find((b) => b.text() === "取消")?.trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-conflict").exists()).toBe(false);
  });

  it("TC-06-006：冲突弹窗点『刷新并重试』→ refresh + 再次 PATCH 成功", async () => {
    const { ApiError } = await import("../../api/client");
    const Ctor = ApiError as new (c: string, m: string, s: number) => Error & { code: string };
    const conflict = () => new Ctor("E_CONFLICT", "文件已被外部修改", 409);
    patchRequirement
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ id: "REQ-demo-001", from: "pool", to: "reviewing", updatedField: "updated", mtimeMs: 1900000000000 });
    const wrapper = await mountBoard();

    await dropCard(wrapper, "reviewing", "REQ-demo-001");
    await flushPromises();
    await flushPromises();

    const retryBtn = wrapper.find(".pm-conflict").findAll("button").find((b) => b.text() === "刷新并重试");
    await retryBtn?.trigger("click");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(wrapper.find(".pm-conflict").exists()).toBe(false);
    expect(patchRequirement).toHaveBeenCalledTimes(3);
    expect(wrapper.find('.pm-column__lane[data-status="reviewing"]').text()).toContain("REQ-demo-001");
  });
});

describe("RequirementsBoard：筛选（S7-6）", () => {
  it("按 module 筛选 → 列内仅剩匹配卡片", async () => {
    const wrapper = await mountBoard();
    const selects = wrapper.findAll("select");
    await selects[0]?.setValue("web");
    await flushPromises();

    const poolLane = wrapper.find('.pm-column__lane[data-status="pool"]');
    expect(poolLane.text()).toContain("REQ-demo-002");
    expect(poolLane.text()).not.toContain("REQ-demo-001");
  });

  it("按 priority 筛选；叠加后无匹配 → 『无匹配需求』空态", async () => {
    const wrapper = await mountBoard();
    const selects = wrapper.findAll("select");
    await selects[1]?.setValue("P0"); // fixture 无 P0
    await flushPromises();

    expect(wrapper.find(".pm-board__state--empty").text()).toContain("无匹配需求");
    // 看板网格隐藏
    expect(wrapper.find(".pm-board__grid").exists()).toBe(false);
  });
});

describe("RequirementsBoard：三态（S7-8）", () => {
  it("加载态：loading → 『加载中…』", async () => {
    listRequirements.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(RequirementsBoard, {
      props: { slug: "demo" },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    expect(wrapper.find(".pm-board__state").text()).toContain("加载中…");
  });

  it("错误态：失败 → 错误信息 + 重试按钮，点击后恢复", async () => {
    listRequirements.mockRejectedValueOnce(new Error("boom"));
    const wrapper = await mountBoard();
    expect(wrapper.find(".pm-board__state--error").text()).toContain("重试");

    listRequirements.mockResolvedValue(baseList());
    await wrapper.find(".pm-board__state--error button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-board__grid").exists()).toBe(true);
  });

  it("空态：需求池为空 → 引导文案（TC-06-024 精神）", async () => {
    listRequirements.mockResolvedValue({ requirements: [] });
    const wrapper = await mountBoard();
    expect(wrapper.find(".pm-board__state--empty").text()).toContain("需求池为空");
  });
});

describe("RequirementsBoard：详情模态交叉跳转（06-web §3.3）", () => {
  it("点击卡片 → 需求详情模态；关联任务 → 任务详情模态", async () => {
    getRequirement.mockResolvedValue({
      requirement: req("REQ-demo-001", "pool"),
      relatedTasks: [task("TASK-demo-001")],
    });
    getTask.mockResolvedValue({
      task: task("TASK-demo-001"),
      relatedRequirement: req("REQ-demo-001", "pool"),
    });
    const wrapper = await mountBoard();

    await wrapper.find('.pm-column__lane[data-status="pool"] .pm-req-card').trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-modal__dialog").exists()).toBe(true);
    expect(wrapper.find(".pm-modal__dialog").text()).toContain("REQ-demo-001");

    // 需求 → 任务
    await wrapper.find(".pm-modal__link-btn").trigger("click");
    await flushPromises();
    expect(getTask).toHaveBeenCalledWith("TASK-demo-001");

    // 关闭
    await wrapper.find(".pm-modal__close").trigger("click");
    expect(wrapper.find(".pm-modal").exists()).toBe(false);
  });
});
