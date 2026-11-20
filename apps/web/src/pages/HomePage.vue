<script setup lang="ts">
// 多项目总览卡片墙（06-web §1 HomePage）：加载/错误/空 vault/卡片墙四态
import { onMounted } from "vue";
import ProjectCard from "../components/ProjectCard.vue";
import { useProjectsStore } from "../stores/projects";

const projects = useProjectsStore();

onMounted(() => void projects.load());
</script>

<template>
  <section class="pm-home">
    <header class="pm-home__header">
      <h1 class="pm-home__title">项目总览</h1>
      <span v-if="projects.items.length" class="pm-home__count">{{ projects.items.length }} 个项目</span>
    </header>

    <!-- 卡片容器：四态切换（加载中 / 加载失败 / 空 vault / 卡片墙） -->
    <div class="pm-home__board">
      <p v-if="projects.loading" class="pm-home__state">加载中…</p>

      <div v-else-if="projects.error" class="pm-home__state pm-home__state--error">
        <p>{{ projects.error }}</p>
        <button class="pm-home__retry" type="button" @click="projects.load()">重试</button>
      </div>

      <!-- 空 vault 引导（TC-06-024） -->
      <div v-else-if="projects.isEmpty" class="pm-home__empty">
        <p class="pm-home__empty-title">vault 为空，还没有任何项目</p>
        <p class="pm-home__empty-hint">
          在仓库运行 <code>pm new project --name "我的应用"</code> 创建第一个项目，
          或点击右上角「新建项目」。
        </p>
      </div>

      <div v-else class="pm-home__grid" data-testid="project-grid">
        <ProjectCard v-for="p in projects.items" :key="p.slug" :project="p" />
      </div>
    </div>
  </section>
</template>
