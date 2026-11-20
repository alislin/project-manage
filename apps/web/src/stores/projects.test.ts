import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectsStore } from "./projects";
import { useUiStore } from "./ui";

const { listProjects } = vi.hoisted(() => ({ listProjects: vi.fn() }));

// mock api 层（store 只依赖 api.listProjects / ApiError）
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

const sample = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `proj-${i + 1}`,
    name: `项目 ${i + 1}`,
    status: "active",
    period: ["2026-01-01", "2026-12-31"],
    tags: [],
    progress: { completedRate: 0.5, overdueCount: i, totalTasks: 10, doneTasks: 5, cancelledTasks: 0, onTrack: 4 },
    mtimeMs: 1700000000000 + i,
  }));

describe("projects store：列表加载与 SSE 增量刷新", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listProjects.mockReset();
  });

  it("load() 成功 → items 填充、loaded=true、loading 归位", async () => {
    listProjects.mockResolvedValue({ projects: sample(2) });
    const store = useProjectsStore();

    await store.load();

    expect(store.items).toHaveLength(2);
    expect(store.loaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.isEmpty).toBe(false);
    expect(store.bySlug("proj-2")?.name).toBe("项目 2");
  });

  it("load() 失败 → error 有值、isEmpty=false，且 pushToast 提示", async () => {
    listProjects.mockRejectedValue(new Error("boom"));
    const store = useProjectsStore();
    const ui = useUiStore();

    await store.load();

    expect(store.error).toBe("加载项目列表失败");
    expect(store.loaded).toBe(false);
    expect(store.isEmpty).toBe(false);
    expect(ui.toasts).toHaveLength(1);
  });

  it("refresh()（SSE 静默刷新）→ 不置 loading，静默更新 items", async () => {
    listProjects.mockResolvedValue({ projects: sample(1) });
    const store = useProjectsStore();
    await store.load();

    listProjects.mockResolvedValue({ projects: sample(3) });
    await store.refresh();

    expect(store.loading).toBe(false);
    expect(store.items).toHaveLength(3);
    expect(store.error).toBeNull();
  });

  it("refresh() 失败 → 静默：不清空现有数据、不置 error，仅 toast 提示", async () => {
    listProjects.mockResolvedValue({ projects: sample(1) });
    const store = useProjectsStore();
    await store.load();
    const ui = useUiStore();
    const toastsBefore = ui.toasts.length;

    listProjects.mockRejectedValue(new Error("network down"));
    await store.refresh();

    expect(store.items).toHaveLength(1); // 保留现有视图（后端为唯一真值，下次 SSE 收敛）
    expect(store.error).toBeNull();
    expect(ui.toasts.length).toBe(toastsBefore + 1);
  });

  it("空 vault → isEmpty=true（TC-06-024 引导态）", async () => {
    listProjects.mockResolvedValue({ projects: [] });
    const store = useProjectsStore();

    expect(store.isEmpty).toBe(false); // 未加载过
    await store.load();
    expect(store.isEmpty).toBe(true);
  });
});
