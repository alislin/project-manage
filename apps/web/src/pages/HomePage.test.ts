// @vitest-environment happy-dom
/**
 * HomePage 挂载冒烟测试（TC-06-001/024 骨架版）：
 * dev 页面验收断言 —— 页面含总览标题与卡片容器；空 vault 显示引导文案。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import HomePage from "./HomePage.vue";
import { useProjectsStore } from "../stores/projects";

const { listProjects } = vi.hoisted(() => ({ listProjects: vi.fn() }));

vi.mock("../api/client", () => ({
  api: { listProjects },
  ApiError: class MockApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  setApiErrorHandler: () => {},
}));

// ProjectCard 内 useRouter —— 冒烟测试不关心跳转
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const project = (slug: string) => ({
  slug,
  name: `项目 ${slug}`,
  status: "active",
  period: ["2026-01-01", "2026-12-31"],
  tags: [],
  progress: { completedRate: 0.5, overdueCount: 1, totalTasks: 10, doneTasks: 5, cancelledTasks: 0, onTrack: 4 },
  mtimeMs: 1700000000000,
});

async function mountHome(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(HomePage, { global: { plugins: [createPinia()] } });
  await flushPromises();
  return wrapper;
}

describe("HomePage：总览标题与卡片容器", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listProjects.mockReset();
  });

  it("有项目 → 渲染『项目总览』标题与卡片墙容器及项目卡片", async () => {
    listProjects.mockResolvedValue({ projects: [project("demo"), project("web")] });
    const wrapper = await mountHome();

    expect(wrapper.find(".pm-home__title").text()).toContain("项目总览");
    expect(wrapper.find(".pm-home__board").exists()).toBe(true);
    expect(wrapper.findAll(".pm-project-card")).toHaveLength(2);
    // 进度环（纯 CSS conic-gradient）与状态徽标
    expect(wrapper.find(".pm-progress-ring").exists()).toBe(true);
    expect(wrapper.find(".pm-badge--active").exists()).toBe(true);
    expect(wrapper.html()).toContain("conic-gradient");
  });

  it("空 vault → 卡片容器内显示引导文案（TC-06-024）", async () => {
    listProjects.mockResolvedValue({ projects: [] });
    const wrapper = await mountHome();

    expect(wrapper.find(".pm-home__board").exists()).toBe(true);
    expect(wrapper.find(".pm-home__empty").text()).toContain("vault 为空");
  });
});
