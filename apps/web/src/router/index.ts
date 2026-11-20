/**
 * 路由表（06-web §1 / plan §6）：
 * - `/` 多项目总览卡片墙（HomePage）；
 * - `/p/:slug` 项目工作台（ProjectPage）：需求池 / 任务看板 / 任务列表（S7 实施）+ 进度总览（占位）；
 * - 单用户模式：无登录/路由守卫（06-web §1 约定）。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import HomePage from "../pages/HomePage.vue";
import ProjectPage from "../pages/ProjectPage.vue";
import RequirementsPage from "../pages/RequirementsPage.vue";
import TaskListPage from "../pages/TaskListPage.vue";
import TasksBoardPage from "../pages/TasksBoardPage.vue";
import TabPlaceholder from "../components/TabPlaceholder.vue";
import { useUiStore, type ProjectTab } from "../stores/ui";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: HomePage },
  {
    path: "/p/:slug",
    component: ProjectPage,
    children: [
      // /p/:slug → 默认重定向到需求池 Tab
      { path: "", redirect: { name: "project-requirements" } },
      { path: "requirements", name: "project-requirements", component: RequirementsPage },
      { path: "tasks-board", name: "project-tasks-board", component: TasksBoardPage },
      { path: "tasks-list", name: "project-tasks-list", component: TaskListPage },
      {
        // 进度总览（ECharts 三图）非 S7 范围，保持结构占位
        path: "overview",
        name: "project-overview",
        component: TabPlaceholder,
        props: {
          tab: "overview",
          title: "进度总览",
          description: "需求交付漏斗、任务趋势与状态分布图表将在后续阶段实施。",
        },
      },
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
