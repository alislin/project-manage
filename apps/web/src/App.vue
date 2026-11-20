<script setup lang="ts">
// 主入口：SSE 订阅 + 主题初始化（main.ts）+ Pinia/Router 初始化（06-web §2.1）
import Navbar from "./components/Navbar.vue";
import ErrorToast from "./components/ErrorToast.vue";
import { useSse } from "./composables/useSse";
import { useOverviewStore } from "./stores/overview";
import { useProjectsStore } from "./stores/projects";
import { useRequirementsStore } from "./stores/requirements";
import { useTasksStore } from "./stores/tasks";
import { useUiStore } from "./stores/ui";

const projects = useProjectsStore();
const overview = useOverviewStore();
const requirements = useRequirementsStore();
const tasks = useTasksStore();
const ui = useUiStore();

// SSE 订阅（06-web §5）：
// - connected → 全量刷新（projects + 已激活项目的 overview/需求池/任务，store 无激活项目时为无操作）；
// - vault:updated → 同上（后端为唯一真值，前端通过 refresh 收敛，TC-06-026；S8：overview 一并刷新 → 图表数据即时更新）；
// - 连续失败 ≥3 次 → 提示一次并进入 15s 兜底轮询。
function refreshActive(): void {
  void projects.refresh();
  void overview.refresh();
  void requirements.refresh();
  void tasks.refresh();
}

useSse({
  onConnected: refreshActive,
  onVaultUpdated: refreshActive,
  onFallback: () => ui.pushToast("SSE 不可用，将每 15s 全量刷新一次", "info"),
  requestFullRefresh: refreshActive,
});
</script>

<template>
  <Navbar />
  <main class="pm-main">
    <RouterView />
  </main>
  <ErrorToast />
</template>
