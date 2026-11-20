<script setup lang="ts">
// 项目卡片（06-web §2.1 ProjectCard）：状态徽标 + 进度环 + 逾期数，点击进入工作台
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { ProjectSummary } from "../api/types";
import ProgressRing from "./ProgressRing.vue";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{ project: ProjectSummary }>();

const router = useRouter();
const overdue = computed(() => props.project.progress.overdueCount);
const hasOverdue = computed(() => overdue.value > 0);

function open(): void {
  void router.push(`/p/${props.project.slug}`);
}
</script>

<template>
  <article
    class="pm-project-card"
    :class="{ 'pm-project-card--overdue': hasOverdue }"
    role="link"
    tabindex="0"
    @click="open"
    @keydown.enter="open"
  >
    <header class="pm-project-card__head">
      <h3 class="pm-project-card__name" :title="props.project.name">{{ props.project.name }}</h3>
      <StatusBadge :status="props.project.status" class="pm-project-card__badge" />
    </header>
    <p class="pm-project-card__slug">{{ props.project.slug }}</p>

    <div class="pm-project-card__body">
      <ProgressRing :rate="props.project.progress.completedRate" class="pm-project-card__ring" />
      <dl class="pm-project-card__metrics">
        <div class="pm-project-card__metric">
          <dt>任务</dt>
          <dd>{{ props.project.progress.doneTasks }} / {{ props.project.progress.totalTasks }}</dd>
        </div>
        <div class="pm-project-card__metric" :class="{ 'pm-project-card__metric--overdue': hasOverdue }">
          <dt>逾期</dt>
          <dd>{{ overdue }}</dd>
        </div>
        <div class="pm-project-card__metric">
          <dt>进行中</dt>
          <dd>{{ props.project.progress.onTrack }}</dd>
        </div>
      </dl>
    </div>
  </article>
</template>
