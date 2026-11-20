<script setup lang="ts">
// 项目工作台（06-web §1/§2.2 ProjectPage）：页头 + 四 Tab 子路由（本阶段结构占位）
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProgressRing from "../components/ProgressRing.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useProjectsStore } from "../stores/projects";
import { useUiStore, type ProjectTab } from "../stores/ui";

const route = useRoute();
const router = useRouter();
const projects = useProjectsStore();
const ui = useUiStore();

const slug = computed(() => route.params.slug as string);
const project = computed(() => projects.bySlug(slug.value));
const tabs: Array<{ key: ProjectTab; label: string }> = [
  { key: "requirements", label: "需求池" },
  { key: "tasks-board", label: "任务看板" },
  { key: "tasks-list", label: "任务列表" },
  { key: "overview", label: "进度总览" },
];

function isActive(tab: ProjectTab): boolean {
  return route.name === `project-${tab}`;
}

function switchTab(tab: ProjectTab): void {
  if (!isActive(tab)) void router.push(`/p/${slug.value}/${tab}`);
}

// 直接进入子路由/刷新时确保项目列表已加载（SSE 也会驱动 refresh，此处兜底）
watch(
  slug,
  (s) => {
    ui.setActiveTab((route.name?.toString().replace("project-", "") ?? "requirements") as ProjectTab);
    if (s && !projects.bySlug(s) && !projects.loading) void projects.refresh();
  },
  { immediate: true },
);
</script>

<template>
  <section class="pm-project">
    <!-- 页头：项目名 + 状态徽标 + 进度环（06-web §2.2 ProjectHeader） -->
    <header v-if="project" class="pm-project__head">
      <div class="pm-project__meta">
        <h1 class="pm-project__name">{{ project.name }}</h1>
        <StatusBadge :status="project.status" />
      </div>
      <ProgressRing :rate="project.progress.completedRate" class="pm-project__ring" />
    </header>
    <header v-else class="pm-project__head pm-project__head--empty">
      <h1 class="pm-project__name">{{ slug }}</h1>
      <span class="pm-project__missing">{{ projects.loaded ? "项目不存在（TC-06-024：空/未知 slug 不崩溃）" : "加载中…" }}</span>
    </header>

    <!-- Tabs：需求池 / 任务看板 / 任务列表 / 进度总览 -->
    <nav class="pm-tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        class="pm-tabs__item"
        :class="{ 'pm-tabs__item--active': isActive(t.key) }"
        :aria-selected="isActive(t.key)"
        :data-testid="`tab-${t.key}`"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- Tab 子路由视图（占位） -->
    <RouterView />
  </section>
</template>
