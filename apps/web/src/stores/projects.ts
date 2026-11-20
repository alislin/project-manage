/**
 * 项目列表 store（06-web §4 ProjectStore 本阶段范围）：
 * - `load()`：首屏加载（带 loading 态）；
 * - `refresh()`：SSE `connected`/`vault:updated` 触发的增量刷新（静默拉取，不闪 loading）；
 * - `bySlug`：卡片墙按 slug 取项；`isEmpty`：空 vault 引导判断（TC-06-024）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { ProjectSummary } from "../api/types";
import { useUiStore } from "./ui";

export const useProjectsStore = defineStore("projects", () => {
  const items = ref<ProjectSummary[]>([]);
  /** 首屏加载中（refresh 静默，不置位） */
  const loading = ref(false);
  /** 已完成过至少一次加载（区分"加载中"与"空 vault"） */
  const loaded = ref(false);
  const error = ref<string | null>(null);

  const isEmpty = computed(() => loaded.value && !error.value && items.value.length === 0);

  function bySlug(slug: string): ProjectSummary | undefined {
    return items.value.find((p) => p.slug === slug);
  }

  /** 拉取项目列表；`silent=true` 为 SSE 增量刷新（不置 loading、不清空已有数据） */
  async function fetchProjects(silent: boolean): Promise<void> {
    const ui = useUiStore();
    if (!silent) {
      loading.value = true;
      error.value = null;
    }
    try {
      const data = await api.listProjects();
      items.value = data.projects;
      loaded.value = true;
      error.value = null;
    } catch (e) {
      // 静默刷新失败不打断现有视图，只提示（后端为唯一真值，下次 SSE 再收敛）
      if (!silent) {
        error.value = e instanceof ApiError ? e.message : "加载项目列表失败";
      }
      ui.pushToast(e instanceof ApiError ? e.message : "加载项目列表失败");
    } finally {
      if (!silent) loading.value = false;
    }
  }

  /** 首屏加载（HomePage 挂载时） */
  function load(): Promise<void> {
    return fetchProjects(false);
  }

  /** SSE connected / vault:updated 触发的增量刷新（06-web §5） */
  function refresh(): Promise<void> {
    return fetchProjects(true);
  }

  function $reset(): void {
    items.value = [];
    loading.value = false;
    loaded.value = false;
    error.value = null;
  }

  return { items, loading, loaded, error, isEmpty, bySlug, load, refresh, $reset };
});
