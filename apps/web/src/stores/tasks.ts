/**
 * 任务 store（06-web §4 TasksStore，S7）：
 * - `load(slug)` / `refresh()`：任务列表（看板/列表共用数据源）；
 * - `moduleOf(task)`：任务无 module 字段，模块筛选按关联需求（wiki-link 反查）的 module 解析；
 * - `filtered`：priority + module（经关联需求）筛选（S7-6）；
 * - `moveStatus(id, to)`：与 RequirementsStore 同构的乐观更新/回滚/Q-05 冲突自动重试一次。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { PatchStatusData, Priority, TaskItem, TaskStatus } from "../api/types";
import { wikiId } from "../utils/board";
import { useRequirementsStore } from "./requirements";
import { useUiStore } from "./ui";
import type { MoveResult } from "./requirements";

export const useTasksStore = defineStore("tasks", () => {
  const activeSlug = ref<string | null>(null);
  const items = ref<TaskItem[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const pendingIds = ref<string[]>([]);

  // --- 筛选（S7-6：module + priority；module 经关联需求解析） ---
  const moduleFilter = ref<string>("");
  const priorityFilter = ref<"" | Priority>("");

  const requirements = useRequirementsStore();

  /** 任务关联需求 id（"[[REQ-x-001]]" → "REQ-x-001"）；任务→需求链接展示用 */
  function linkedReqId(task: TaskItem): string {
    return wikiId(task.requirement);
  }

  /** 任务的模块 = 关联需求 module（悬空链接/未加载 → ""，仅在"全部模块"可见） */
  function moduleOf(task: TaskItem): string {
    return requirements.byId(linkedReqId(task))?.module ?? "";
  }

  const filtered = computed(() => {
    let arr = items.value;
    if (priorityFilter.value !== "") arr = arr.filter((t) => t.priority === priorityFilter.value);
    if (moduleFilter.value !== "") arr = arr.filter((t) => moduleOf(t) === moduleFilter.value);
    return arr;
  });

  /** 模块下拉选项：复用关联需求集合的模块（需求池 store 已加载时） */
  const moduleOptions = computed(() => requirements.moduleOptions);

  function byId(id: string): TaskItem | undefined {
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
      const data = await api.listTasks(slug);
      items.value = data.tasks;
      activeSlug.value = slug;
      loaded.value = true;
      error.value = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载任务失败";
      if (!silent) error.value = msg;
      ui.pushToast(msg);
    } finally {
      if (!silent) loading.value = false;
    }
  }

  function load(slug: string): Promise<void> {
    return fetchList(slug, false);
  }

  function refresh(): Promise<void> {
    if (!activeSlug.value) return Promise.resolve();
    return fetchList(activeSlug.value, true);
  }

  function settleBottom(id: string): void {
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx >= 0) items.value.push(items.value.splice(idx, 1)[0] as TaskItem);
  }

  function rollback(id: string, to: TaskStatus | string, restore: TaskStatus): void {
    const cur = items.value.find((i) => i.id === id);
    if (cur && cur.status === to) cur.status = restore;
  }

  function applyMtime(id: string, res: PatchStatusData): void {
    const cur = items.value.find((i) => i.id === id);
    if (cur) cur.mtimeMs = res.mtimeMs;
  }

  /** 流转入口（任务看板拖拽 / 列表行内快捷按钮 / 详情模态共用），流程同 requirements store */
  async function moveStatus(id: string, to: TaskStatus): Promise<MoveResult> {
    const ui = useUiStore();
    const item = items.value.find((i) => i.id === id);
    if (!item) return { ok: false, reason: "not-found" };
    const from = item.status;
    if (from === to) return { ok: true, reason: "same" };
    if (isPending(id)) return { ok: false, reason: "busy" };

    pendingIds.value = [...pendingIds.value, id];
    try {
      item.status = to; // 乐观更新（06-web §3.1）
      try {
        const res = await api.patchTask(id, { status: to, expectedMtimeMs: item.mtimeMs });
        applyMtime(id, res);
        settleBottom(id);
        return { ok: true };
      } catch (err) {
        rollback(id, to, from);
        if (err instanceof ApiError && err.code === "E_CONFLICT") {
          // Q-05：刷新 + 自动重试一次
          await refresh();
          const fresh = items.value.find((i) => i.id === id);
          if (!fresh) return { ok: false, conflict: true, reason: "not-found" };
          if (fresh.status === to) return { ok: true, retried: true };
          const restore = fresh.status;
          fresh.status = to;
          try {
            const res2 = await api.patchTask(id, { status: to, expectedMtimeMs: fresh.mtimeMs });
            applyMtime(id, res2);
            settleBottom(id);
            ui.pushToast("检测到 mtime 冲突，已自动刷新并重试成功", "info");
            return { ok: true, retried: true };
          } catch (err2) {
            rollback(id, to, restore);
            if (err2 instanceof ApiError && err2.code === "E_CONFLICT") {
              ui.showConflict({
                entity: "task",
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
    linkedReqId,
    moduleOf,
    load,
    refresh,
    moveStatus,
    $reset,
  };
});
