/**
 * 路由表（06-web §1 / plan §6）：
 * - `/` 多项目总览卡片墙（HomePage）；
 * - `/p/:slug` 项目工作台（ProjectPage）：需求池 / 任务看板 / 任务列表 / 进度总览 四个 Tab 子路由，
 *   本阶段 Tab 页为结构占位，路由与布局完整；
 * - 单用户模式：无登录/路由守卫（06-web §1 约定）。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import HomePage from "../pages/HomePage.vue";
import ProjectPage from "../pages/ProjectPage.vue";
import TabPlaceholder from "../components/TabPlaceholder.vue";
import { useUiStore, type ProjectTab } from "../stores/ui";

/** 四个 Tab 子路由（名称与 06-web §1 Tab 顺序一致） */
const tabRoutes: Array<{ path: string; tab: ProjectTab; title: string; description: string }> = [
  {
    path: "requirements",
    tab: "requirements",
    title: "需求池",
    description: "四栏看板（Pool / Reviewing / Accepted / Done+Rejected）与拖拽流转将在 S7 实施。",
  },
  {
    path: "tasks-board",
    tab: "tasks-board",
    title: "任务看板",
    description: "任务四栏看板（todo / doing / done / cancelled）与逾期标红将在 S7 实施。",
  },
  {
    path: "tasks-list",
    tab: "tasks-list",
    title: "任务列表",
    description: "状态/优先级筛选、搜索与排序的表格视图将在 S7 实施。",
  },
  {
    path: "overview",
    tab: "overview",
    title: "进度总览",
    description: "需求交付漏斗、任务趋势与状态分布图表将在 S7 实施。",
  },
];

const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: HomePage },
  {
    path: "/p/:slug",
    component: ProjectPage,
    children: [
      // /p/:slug → 默认重定向到需求池 Tab
      { path: "", redirect: { name: "project-requirements" } },
      ...tabRoutes.map<RouteRecordRaw>((t) => ({
        path: t.path,
        name: `project-${t.tab}`,
        component: TabPlaceholder,
        props: { tab: t.tab, title: t.title, description: t.description },
      })),
    ],
  },
  // 兜底：未知路径回总览
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由 → Tab 状态同步（ui.activeTab；导航发生时 pinia 已激活）
router.afterEach((to) => {
  const name = to.name?.toString() ?? "";
  if (name.startsWith("project-")) {
    useUiStore().setActiveTab(name.replace("project-", "") as ProjectTab);
  }
});
