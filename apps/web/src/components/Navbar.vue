<script setup lang="ts">
// 顶部导航（06-web §2.1）：返回首页、主题切换、新建项目入口
// S11：新建项目按钮打开真实模态表单（替换占位 toast）；
// 创建成功 → 刷新项目列表（GET /api/projects，后端已同步 reindex）并跳转项目工作台 /p/:slug。
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useProjectsStore } from "../stores/projects";
import { useUiStore } from "../stores/ui";
import NewProjectModal from "./modals/NewProjectModal.vue";

const ui = useUiStore();
const projects = useProjectsStore();
const router = useRouter();

const showNewProject = ref(false);

function goHome(): void {
  void router.push("/");
}

async function onCreated(slug: string): Promise<void> {
  showNewProject.value = false;
  await projects.refresh();
  await router.push(`/p/${encodeURIComponent(slug)}`);
}
</script>

<template>
  <header class="pm-header">
    <a class="pm-header__brand" href="/" @click.prevent="goHome">PM 台账</a>
    <div class="pm-header__actions">
      <button
        class="pm-header__btn"
        type="button"
        :title="ui.isDark ? '切换到亮色主题' : '切换到暗色主题'"
        @click="ui.toggleTheme()"
      >
        {{ ui.isDark ? "☀ 亮色" : "☾ 暗色" }}
      </button>
      <button class="pm-header__btn pm-header__btn--accent" type="button" @click="showNewProject = true">
        新建项目
      </button>
    </div>
  </header>
  <NewProjectModal v-if="showNewProject" @close="showNewProject = false" @created="onCreated" />
</template>
