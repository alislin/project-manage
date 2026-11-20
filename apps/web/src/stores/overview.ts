/**
 * 进度总览 store（06-web §4 ProjectStore.overview，S8）：
 * - `load(slug)`：GET /api/projects/:slug/overview（05-server §2.3，带 loading 态）；
 * - `refresh()`：SSE `connected` / `vault:updated` 触发的静默刷新（06-web §5，App.vue 驱动；
 *   后端为唯一真值，前端经 refresh 收敛，TC-06-026）；
 * - 图表 option 在页面层以纯函数组合（utils/charts.ts + utils/echartsTheme.ts），store 只管拉取与缓存。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { api, ApiError } from "../api/client";
import type { OverviewData } from "../api/types";
import { useUiStore } from "./ui";

export const useOverviewStore = defineStore("overview", () => {
  const activeSlug = ref<string | null>(null);
  const data = ref<OverviewData | null>(null);
  /** 首屏加载中（refresh 静默，不置位） */
  const loading = ref(false);
  /** 已完成过至少一次加载（区分"加载中"与"无数据"） */
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function fetchOverview(slug: string, silent: boolean): Promise<void> {
    const ui = useUiStore();
    if (!silent) {
      loading.value = true;
      error.value = null;
    }
    try {
      data.value = await api.getOverview(slug);
      activeSlug.value = slug;
      loaded.value = true;
      error.value = null;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "加载进度总览失败";
      if (!silent) error.value = msg;
      ui.pushToast(msg);
    } finally {
      if (!silent) loading.value = false;
    }
  }

  /** 首屏加载（进度总览 Tab 挂载时） */
  function load(slug: string): Promise<void> {
    return fetchOverview(slug, false);
  }

  /** SSE connected / vault:updated 触发的增量刷新（06-web §5）；无激活项目时为无操作 */
  function refresh(): Promise<void> {
    if (!activeSlug.value) return Promise.resolve();
    return fetchOverview(activeSlug.value, true);
  }

  function $reset(): void {
    activeSlug.value = null;
    data.value = null;
    loading.value = false;
    loaded.value = false;
    error.value = null;
  }

  return { activeSlug, data, loading, loaded, error, load, refresh, $reset };
});
