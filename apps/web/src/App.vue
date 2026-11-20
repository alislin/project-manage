<script setup lang="ts">
// 主入口：SSE 订阅 + 主题初始化（main.ts）+ Pinia/Router 初始化（06-web §2.1）
import Navbar from "./components/Navbar.vue";
import ErrorToast from "./components/ErrorToast.vue";
import { useSse } from "./composables/useSse";
import { useProjectsStore } from "./stores/projects";
import { useUiStore } from "./stores/ui";

const projects = useProjectsStore();
const ui = useUiStore();

// SSE 订阅（06-web §5）：
// - connected → 全量刷新（GET /api/projects）；
// - vault:updated → 触发受影响 store 增量刷新（本阶段 = projects）；
// - 连续失败 ≥3 次 → 提示一次并进入 15s 兜底轮询。
useSse({
  onConnected: () => void projects.refresh(),
  onVaultUpdated: () => void projects.refresh(),
  onFallback: () => ui.pushToast("SSE 不可用，将每 15s 全量刷新一次", "info"),
  requestFullRefresh: () => void projects.refresh(),
});
</script>

<template>
  <Navbar />
  <main class="pm-main">
    <RouterView />
  </main>
  <ErrorToast />
</template>
