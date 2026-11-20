/**
 * 需求池 store（06-web §4 RequirementsStore，S7）：
 * - `load(slug)` / `refresh()`：列表拉取（SSE 静默收敛，后端为唯一真值）；
 * - `filtered`：module + priority 筛选（S7-6）；
 * - `moveStatus(id, to)`：拖拽/手动流转（06-web §3.1 乐观更新）：
 *   1. 先移动卡片（本地 status 置目标列）→ PATCH `{ status, expectedMtimeMs }`（05-server §2.7）；
 *   2. 失败 → 回滚原列 + 提示（TC-06-007 非法流转回滚）；
 *   3. E_CONFLICT(409) → 按 Q-05 定案：静默刷新后**自动重试一次**（带新 mtimeMs）；
 *      重试仍冲突 → 回滚 + 弹冲突提示（ui.showConflict，06-web §3.2"刷新并重试/取消"）；
 * - 同 id 在途（pending）时拒绝并发 PATCH（06-web §6 canvasWriteLock 精神，TC-06-021/022）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { PatchStatusData, Priority, ReqStatus, RequirementItem } from "../api/types";
import { filterRequirements, requirementModuleOptions } from "../utils/board";
import { useUiStore } from "./ui";

export interface MoveResult {
  ok: boolean;
  /** E_CONFLICT 自动重试仍失败 → 冲突弹窗已置入 ui.conflict */
  conflict?: boolean;
  /** 409 后自动刷新重试成功（Q-05） */
  retried?: boolean;
  reason?: "not-found" | "busy" | "same" | "error";
}

export const useRequirementsStore = defineStore("requirements", () => {
  const activeSlug = ref<string | null>(null);
  const items = ref<RequirementItem[]>([]);
  /** 首屏加载中（refresh 静默，不置位） */
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  /** 在途流转 id（防并发重复 PATCH） */
  const pendingIds = ref<string[]>([]);

  // --- 筛选（S7-6：module + priority） ---
  const moduleFilter = ref<string>("");
  const priorityFilter = ref<"" | Priority>("");
  const filtered = computed(() =>
    filterRequirements(items.value, { module: moduleFilter.value, priority: priorityFilter.value }),
  );
  const moduleOptions = computed(() => requirementModuleOptions(items.value));

  function byId(id: string): RequirementItem | undefined {
    return items.value.find((i) => i.id === id);
  }

  function isPending(id: string): boolean {
    return pendingIds.value.includes(id);
  }

  async function fetchList(slug: string, silent: boolean): Promise<void> {
    const ui = useUiStore();
    if (!silent) {
      loading.value = true;
      error.value = null;
    }
    try {
      const data = await api.listRequirements(slug);
      items.value = data.requirements;
      activeSlug.value = slug;
      loaded.value = true;
      error.value = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载需求池失败";
      if (!silent) error.value = msg;
      ui.pushToast(msg);
    } finally {
      if (!silent) loading.value = false;
    }
  }

  /** 首屏加载（需求池 Tab 挂载时） */
  function load(slug: string): Promise<void> {
    return fetchList(slug, false);
  }

  /** SSE connected / vault:updated 触发的增量刷新（06-web §5）；无激活项目时为无操作 */
  function refresh(): Promise<void> {
    if (!activeSlug.value) return Promise.resolve();
    return fetchList(activeSlug.value, true);
  }

  /** PATCH 成功后落位目标列底部（06-web §6 步骤 2） */
  function settleBottom(id: string): void {
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx >= 0) items.value.push(items.value.splice(idx, 1)[0] as RequirementItem);
  }

  /**
   * 条件回滚：仅当本地仍处于乐观状态（status === to）时恢复。
   * 若 SSE 刷新已写入服务端真值，则不覆盖（后端为唯一真值，06-web §5.4）。
   */
  function rollback(id: string, to: ReqStatus | string, restore: ReqStatus): void {
    const cur = items.value.find((i) => i.id === id);
    if (cur && cur.status === to) cur.status = restore;
  }

  /** 回填响应中的新 mtimeMs（下次流转的冲突检测基准，05-server §1.3） */
  function applyMtime(id: string, res: PatchStatusData): void {
    const cur = items.value.find((i) => i.id === id);
    if (cur) cur.mtimeMs = res.mtimeMs;
  }

  /**
   * 流转入口（看板拖拽、详情模态按钮、列表行内快捷流转共用）。
   * 流程见文件头注释；全程在 pendingIds 保护下串行（同 id 二次调用返回 busy）。
   */
  async function moveStatus(id: string, to: ReqStatus): Promise<MoveResult> {
    const ui = useUiStore();
    const item = items.value.find((i) => i.id === id);
    if (!item) return { ok: false, reason: "not-found" };
    const from = item.status;
    if (from === to) return { ok: true, reason: "same" };
    if (isPending(id)) return { ok: false, reason: "busy" };

    pendingIds.value = [...pendingIds.value, id];
    try {
      // 06-web §3.1 步骤 2：乐观更新——先移动卡片
      item.status = to;
      try {
        const res = await api.patchRequirement(id, { status: to, expectedMtimeMs: item.mtimeMs });
        applyMtime(id, res);
        settleBottom(id);
        return { ok: true };
      } catch (err) {
        // 步骤 4：失败 → 回滚原列
        rollback(id, to, from);
        if (err instanceof ApiError && err.code === "E_CONFLICT") {
          // Q-05 定案：刷新（GET 重取 mtimeMs）→ 自动重试一次
          await refresh();
          const fresh = items.value.find((i) => i.id === id);
          if (!fresh) return { ok: false, conflict: true, reason: "not-found" };
          if (fresh.status === to) {
            // 后端已处于目标状态（如另一端已流转）→ 视为已收敛
            return { ok: true, retried: true };
          }
          const restore = fresh.status;
          fresh.status = to;
          try {
            const res2 = await api.patchRequirement(id, { status: to, expectedMtimeMs: fresh.mtimeMs });
            applyMtime(id, res2);
            settleBottom(id);
            ui.pushToast("检测到 mtime 冲突，已自动刷新并重试成功", "info");
            return { ok: true, retried: true };
          } catch (err2) {
            rollback(id, to, restore);
            if (err2 instanceof ApiError && err2.code === "E_CONFLICT") {
              // 自动重试仍冲突 → 冲突弹窗（06-web §3.2：刷新并重试/取消）
              ui.showConflict({
                entity: "requirement",
                id,
                to,
                message: "文件已被外部修改（mtime 冲突），是否刷新并重试？",
              });
              return { ok: false, conflict: true, retried: true };
            }
            const msg = err2 instanceof ApiError ? err2.message : "状态流转失败";
            ui.pushToast(msg);
            return { ok: false, reason: "error" };
          }
        }
        // 非冲突失败（E_INVALID_TRANSITION 等）：保持回滚 + 提示（TC-06-007）
        const msg = err instanceof ApiError ? err.message : "状态流转失败";
        ui.pushToast(msg);
        return { ok: false, reason: "error" };
      }
    } finally {
      pendingIds.value = pendingIds.value.filter((p) => p !== id);
    }
  }

  function $reset(): void {
    activeSlug.value = null;
    items.value = [];
    loading.value = false;
    loaded.value = false;
    error.value = null;
    pendingIds.value = [];
    moduleFilter.value = "";
    priorityFilter.value = "";
  }

  return {
    activeSlug,
    items,
    loading,
    loaded,
    error,
    pendingIds,
    moduleFilter,
    priorityFilter,
    filtered,
    moduleOptions,
    byId,
    isPending,
    load,
    refresh,
    moveStatus,
    $reset,
  };
});
