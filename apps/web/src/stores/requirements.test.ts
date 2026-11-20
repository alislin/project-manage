// 需求池 store 测试（S7）：乐观流转 PATCH payload、失败回滚、409 自动重试一次（Q-05）、筛选
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRequirementsStore } from "./requirements";
import { useUiStore } from "./ui";
import type { ReqStatus, RequirementItem } from "../api/types";

const { listRequirements, patchRequirement } = vi.hoisted(() => ({
  listRequirements: vi.fn(),
  patchRequirement: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: { listRequirements, patchRequirement },
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

const patchOk = (id: string, to: string, mtimeMs: number) => ({
  id,
  from: "pool",
  to,
  updatedField: "updated",
  mtimeMs,
});

describe("requirements store：加载与筛选", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listRequirements.mockReset();
    patchRequirement.mockReset();
  });

  it("load() 成功 → items 填充、loaded=true", async () => {
    listRequirements.mockResolvedValue({ requirements: [req("REQ-demo-001", "pool")] });
    const store = useRequirementsStore();
    await store.load("demo");
    expect(store.items).toHaveLength(1);
    expect(store.loaded).toBe(true);
    expect(store.activeSlug).toBe("demo");
  });

  it("refresh() 未激活项目时为无操作（SSE 在无看板页时不发请求）", async () => {
    const store = useRequirementsStore();
    await store.refresh();
    expect(listRequirements).not.toHaveBeenCalled();
  });

  it("S7-6：module + priority 筛选（filtered/moduleOptions）", async () => {
    listRequirements.mockResolvedValue({
      requirements: [
        req("REQ-demo-001", "pool", 1700000000000, { module: "core", priority: "P0" }),
        req("REQ-demo-002", "pool", 1700000000000, { module: "web", priority: "P1" }),
        req("REQ-demo-003", "pool", 1700000000000, { module: "", priority: "P1" }),
      ],
    });
    const store = useRequirementsStore();
    await store.load("demo");

    store.moduleFilter = "core";
    expect(store.filtered.map((r) => r.id)).toEqual(["REQ-demo-001"]);
    store.moduleFilter = "";
    store.priorityFilter = "P1";
    expect(store.filtered.map((r) => r.id)).toEqual(["REQ-demo-002", "REQ-demo-003"]);
    expect(store.moduleOptions).toEqual(["core", "web"]);
  });
});

describe("requirements store：moveStatus（06-web §3.1 乐观更新）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listRequirements.mockReset();
    patchRequirement.mockReset();
    listRequirements.mockResolvedValue({
      requirements: [
        req("REQ-demo-001", "pool", 1700000000000),
        req("REQ-demo-002", "reviewing", 1700000000001),
      ],
    });
  });

  it("TC-06-005：先乐观移动，PATCH 携带 { status, expectedMtimeMs }，成功后回填新 mtimeMs", async () => {
    patchRequirement.mockResolvedValue(patchOk("REQ-demo-001", "reviewing", 1700000001000));
    const store = useRequirementsStore();
    await store.load("demo");

    const res = await store.moveStatus("REQ-demo-001", "reviewing");

    expect(res).toMatchObject({ ok: true });
    expect(patchRequirement).toHaveBeenCalledTimes(1);
    expect(patchRequirement).toHaveBeenCalledWith("REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1700000000000,
    });
    const item = store.byId("REQ-demo-001");
    expect(item?.status).toBe("reviewing");
    expect(item?.mtimeMs).toBe(1700000001000);
    // 目标列底部落位（06-web §6 步骤 2）
    expect(store.items.at(-1)?.id).toBe("REQ-demo-001");
  });

  it("同状态流转为无操作（01-数据规范 §3.4 同状态非法）", async () => {
    const store = useRequirementsStore();
    await store.load("demo");
    const res = await store.moveStatus("REQ-demo-002", "reviewing");
    expect(res).toMatchObject({ ok: true, reason: "same" });
    expect(patchRequirement).not.toHaveBeenCalled();
  });

  it("TC-06-007：非流转失败（E_INVALID_TRANSITION）→ 回滚原列 + toast 提示", async () => {
    const { ApiError } = await import("../api/client");
    patchRequirement.mockRejectedValue(
      new (ApiError as new (code: string, message: string, status: number) => Error & { code: string })(
        "E_INVALID_TRANSITION",
        "非法状态流转: pool -> done（01-数据规范 §3.4）",
        409,
      ),
    );
    const store = useRequirementsStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("REQ-demo-001", "done");

    expect(res).toMatchObject({ ok: false, reason: "error" });
    expect(store.byId("REQ-demo-001")?.status).toBe("pool"); // 回滚
    expect(patchRequirement).toHaveBeenCalledTimes(1); // 未自动重试（非 409 冲突）
    expect(ui.toasts.length).toBe(1);
    expect(ui.toasts[0]?.message).toContain("非法状态流转");
  });

  it("TC-06-006 / Q-05：409 → 回滚 → 刷新（GET）→ 自动重试一次（新 mtimeMs）→ 成功", async () => {
    const { ApiError } = await import("../api/client");
    const Ctor = ApiError as new (code: string, message: string, status: number) => Error & { code: string };
    patchRequirement
      .mockRejectedValueOnce(new Ctor("E_CONFLICT", "文件已被外部修改，请刷新后重试", 409))
      .mockResolvedValueOnce(patchOk("REQ-demo-001", "reviewing", 1899999999999));
    // 刷新返回新 mtimeMs（外部已改文件）
    listRequirements
      .mockResolvedValueOnce({ requirements: [req("REQ-demo-001", "pool", 1700000000000)] })
      .mockResolvedValue({ requirements: [req("REQ-demo-001", "pool", 1899999999999)] });

    const store = useRequirementsStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("REQ-demo-001", "reviewing");

    expect(res).toMatchObject({ ok: true, retried: true });
    expect(patchRequirement).toHaveBeenCalledTimes(2);
    expect(patchRequirement).toHaveBeenNthCalledWith(1, "REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1700000000000,
    });
    expect(patchRequirement).toHaveBeenNthCalledWith(2, "REQ-demo-001", {
      status: "reviewing",
      expectedMtimeMs: 1899999999999, // 刷新后的新基准
    });
    expect(store.byId("REQ-demo-001")?.status).toBe("reviewing");
    expect(ui.toasts.some((t) => t.tone === "info" && t.message.includes("重试成功"))).toBe(true);
  });

  it("TC-06-006：409 自动重试仍失败 → 二次回滚 + 冲突弹窗（ui.conflict，Q-05）", async () => {
    const { ApiError } = await import("../api/client");
    const Ctor = ApiError as new (code: string, message: string, status: number) => Error & { code: string };
    const conflict = () => new Ctor("E_CONFLICT", "文件已被外部修改，请刷新后重试", 409);
    patchRequirement.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    listRequirements
      .mockResolvedValueOnce({ requirements: [req("REQ-demo-001", "pool", 1700000000000)] })
      .mockResolvedValue({ requirements: [req("REQ-demo-001", "pool", 1899999999999)] });

    const store = useRequirementsStore();
    const ui = useUiStore();
    await store.load("demo");

    const res = await store.moveStatus("REQ-demo-001", "reviewing");

    expect(res).toMatchObject({ ok: false, conflict: true, retried: true });
    expect(store.byId("REQ-demo-001")?.status).toBe("pool"); // 最终回滚
    expect(ui.conflict).not.toBeNull();
    expect(ui.conflict?.entity).toBe("requirement");
    expect(ui.conflict?.id).toBe("REQ-demo-001");
    expect(ui.conflict?.to).toBe("reviewing");
    expect(ui.conflict?.message).toContain("刷新并重试");
  });

  it("TC-06-021/022：同 id 在途时拒绝并发流转（busy，canvasWriteLock 精神）", async () => {
    let resolvePatch!: (v: ReturnType<typeof patchOk>) => void;
    patchRequirement.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );
    const store = useRequirementsStore();
    await store.load("demo");

    const first = store.moveStatus("REQ-demo-001", "reviewing");
    const second = await store.moveStatus("REQ-demo-001", "accepted");

    expect(second).toMatchObject({ ok: false, reason: "busy" });

    resolvePatch(patchOk("REQ-demo-001", "reviewing", 1700000001000));
    expect(await first).toMatchObject({ ok: true });
    expect(patchRequirement).toHaveBeenCalledTimes(1);
  });

  it("409 刷新后发现后端已处于目标状态 → 视为收敛，不再 PATCH", async () => {
    const { ApiError } = await import("../api/client");
    const Ctor = ApiError as new (code: string, message: string, status: number) => Error & { code: string };
    patchRequirement.mockRejectedValueOnce(new Ctor("E_CONFLICT", "冲突", 409));
    listRequirements
      .mockResolvedValueOnce({ requirements: [req("REQ-demo-001", "pool", 1700000000000)] })
      .mockResolvedValue({ requirements: [req("REQ-demo-001", "reviewing", 1899999999999)] }); // 他人已流转

    const store = useRequirementsStore();
    await store.load("demo");

    const res = await store.moveStatus("REQ-demo-001", "reviewing");
    expect(res).toMatchObject({ ok: true, retried: true });
    expect(patchRequirement).toHaveBeenCalledTimes(1);
    expect(store.byId("REQ-demo-001")?.status).toBe("reviewing");
  });
});
