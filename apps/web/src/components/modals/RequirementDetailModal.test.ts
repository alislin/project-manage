// @vitest-environment happy-dom
// 需求详情模态测试（S7，TC-06-008）：frontmatter 全字段、正文渲染、关联任务链接、状态流转 PATCH
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import RequirementDetailModal from "./RequirementDetailModal.vue";
import { useRequirementsStore } from "../../stores/requirements";
import type { ReqStatus, RequirementItem } from "../../api/types";

const { getRequirement, patchRequirement, listRequirements } = vi.hoisted(() => ({
  getRequirement: vi.fn(),
  patchRequirement: vi.fn(),
  listRequirements: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { getRequirement, patchRequirement, listRequirements },
  ApiError: class MockApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  setApiErrorHandler: () => {},
}));

function req(id: string, status: ReqStatus, over: Partial<RequirementItem> = {}): RequirementItem {
  return {
    type: "requirement",
    id,
    title: "登录页改造",
    status,
    priority: "P1",
    module: "web",
    source: "来自客户访谈\n希望支持手机号登录",
    created: "2026-01-01",
    updated: "2026-01-02",
    mtimeMs: 1700000000000,
    ...over,
  };
}

const detailOf = (status: ReqStatus) => ({
  requirement: req("REQ-demo-001", status),
  relatedTasks: [
    { type: "task", id: "TASK-demo-001", title: "任务一", status: "todo", requirement: "[[REQ-demo-001]]", priority: "P1", due: "2026-12-31", completed: null, created: "2026-01-01", updated: "2026-01-02" },
    { type: "task", id: "TASK-demo-002", title: "任务二", status: "done", requirement: "[[REQ-demo-001]]", priority: "P2", due: "2026-12-31", completed: "2026-02-01", created: "2026-01-01", updated: "2026-02-01" },
  ],
});

async function mountModal(status: ReqStatus = "pool"): Promise<ReturnType<typeof mount>> {
  // 流转按钮走 store.moveStatus（乐观/回滚同源）；组件与测试共享同一 Pinia 实例
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useRequirementsStore();
  listRequirements.mockResolvedValue({ requirements: [req("REQ-demo-001", status)] });
  await store.load("demo");

  getRequirement.mockResolvedValue(detailOf(status));
  const wrapper = mount(RequirementDetailModal, {
    props: { requirementId: "REQ-demo-001" },
    global: { plugins: [pinia] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getRequirement.mockReset();
  patchRequirement.mockReset();
  listRequirements.mockReset();
});

describe("RequirementDetailModal（TC-06-008）", () => {
  it("展示 frontmatter 全字段 + 正文（source 多段）渲染", async () => {
    const wrapper = await mountModal("pool");
    const fields = wrapper.find('[data-testid="req-fields"]').text();
    for (const field of ["REQ-demo-001", "requirement", "登录页改造", "pool", "P1", "web", "2026-01-01", "2026-01-02", "mtimeMs"]) {
      expect(fields).toContain(field);
    }
    const source = wrapper.find(".pm-modal__source").text();
    expect(source).toContain("来自客户访谈");
    expect(source).toContain("希望支持手机号登录");
  });

  it("关联任务反链列表 + 点击发出 openTask（05-server §2.6）", async () => {
    const wrapper = await mountModal("pool");
    const links = wrapper.findAll(".pm-modal__link");
    expect(links).toHaveLength(2);
    expect(links[0]?.text()).toContain("TASK-demo-001");

    await links[0]?.find(".pm-modal__link-btn").trigger("click");
    expect(wrapper.emitted("openTask")?.[0]).toEqual(["TASK-demo-001"]);
  });

  it("pool 状态 → 合法流转按钮（送审→reviewing / 拒绝→rejected），点击 PATCH 成功后重载详情", async () => {
    const wrapper = await mountModal("pool");
    const flow = wrapper.findAll(".pm-modal__flow-btn");
    expect(flow.map((b) => b.text())).toEqual(["送审 → reviewing", "拒绝 → rejected"]);

    patchRequirement.mockResolvedValue({ id: "REQ-demo-001", from: "pool", to: "reviewing", updatedField: "updated", mtimeMs: 1700000001000 });
    await flow[0]?.trigger("click");
    await flushPromises();
    await flushPromises();

    expect(patchRequirement).toHaveBeenCalledWith("REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1700000000000,
    });
    expect(wrapper.emitted("moved")?.[0]).toEqual(["reviewing"]);
    // 成功后重拉详情（updated/mtimeMs 收敛）
    expect(getRequirement).toHaveBeenCalledTimes(2);
  });

  it("done 终态 → 无流转按钮，提示终态", async () => {
    const wrapper = await mountModal("done");
    expect(wrapper.findAll(".pm-modal__flow-btn")).toHaveLength(0);
    expect(wrapper.find(".pm-modal__flow-none").text()).toContain("终态");
  });

  it("关闭按钮发出 close", async () => {
    const wrapper = await mountModal();
    await wrapper.find(".pm-modal__close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("详情加载失败 → 错误态 + 重试", async () => {
    const store = useRequirementsStore();
    listRequirements.mockResolvedValue({ requirements: [req("REQ-demo-001", "pool")] });
    await store.load("demo");
    getRequirement.mockRejectedValueOnce(new Error("boom"));

    const wrapper = mount(RequirementDetailModal, {
      props: { requirementId: "REQ-demo-001" },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    expect(wrapper.find(".pm-modal__state--error").exists()).toBe(true);

    getRequirement.mockResolvedValue(detailOf("pool"));
    await wrapper.find(".pm-modal__state--error button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".pm-modal__fields").exists()).toBe(true);
  });
});
