/**
 * UI 全局状态（06-web §4 ThemeStore/ConfigStore 骨架版）：
 * - 主题：亮/暗切换，启动读 localStorage（`pm-theme`），套用 `data-theme` 属性（06-web §9.1）；
 * - Tab：项目工作台当前激活 Tab（与 `/p/:slug/*` 子路由双向同步）；
 * - Toast：统一错误提示队列（api client 全局钩子写入，ErrorToast 消费，06-web §2.1）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type Theme = "light" | "dark";

/** 项目工作台四个 Tab（06-web §1 路由表） */
export type ProjectTab = "requirements" | "tasks-board" | "tasks-list" | "overview";

const THEME_KEY = "pm-theme";
/** Toast 自动消失时长 ms */
const TOAST_DURATION = 4000;

export interface ToastItem {
  id: number;
  message: string;
  tone: "error" | "info";
}

/**
 * 409 冲突弹窗信息（06-web §3.2 / Q-05 定案："刷新并重试一次"）。
 * moveStatus 自动刷新重试仍失败时置入；ConflictDialog 消费，"刷新并重试/取消"由看板页处理。
 */
export interface ConflictInfo {
  entity: "requirement" | "task";
  id: string;
  /** 冲突时正在流转到的目标状态 */
  to: string;
  message: string;
}

export const useUiStore = defineStore("ui", () => {
  // --- 主题 ---
  const theme = ref<Theme>("light");

  /** 启动初始化：localStorage → data-theme 属性（06-web §9.1 启动初始化） */
  function initTheme(): void {
    const saved = localStorage.getItem(THEME_KEY);
    theme.value = saved === "dark" ? "dark" : "light";
    applyTheme();
  }

  function applyTheme(): void {
    document.documentElement.setAttribute("data-theme", theme.value);
  }

  function toggleTheme(): void {
    theme.value = theme.value === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, theme.value);
    applyTheme();
  }

  const isDark = computed(() => theme.value === "dark");

  // --- Tab 状态（由 ProjectPage 与子路由同步） ---
  const activeTab = ref<ProjectTab>("requirements");

  function setActiveTab(tab: ProjectTab): void {
    activeTab.value = tab;
  }

  // --- Toast 队列 ---
  const toasts = ref<ToastItem[]>([]);
  let toastSeq = 0;

  function pushToast(message: string, tone: ToastItem["tone"] = "error"): void {
    const id = ++toastSeq;
    toasts.value.push({ id, message, tone });
    setTimeout(() => dismissToast(id), TOAST_DURATION);
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  // --- 409 冲突弹窗（06-web §3.2，Q-05：自动重试一次仍冲突后弹出） ---
  const conflict = ref<ConflictInfo | null>(null);

  function showConflict(info: ConflictInfo): void {
    conflict.value = info;
  }

  function clearConflict(): void {
    conflict.value = null;
  }

  return {
    theme,
    isDark,
    initTheme,
    toggleTheme,
    activeTab,
    setActiveTab,
    toasts,
    pushToast,
    dismissToast,
    conflict,
    showConflict,
    clearConflict,
  };
});
