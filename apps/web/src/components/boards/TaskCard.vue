<script setup lang="ts">
// 任务卡（06-web §2.2 TaskCard）：priority 圆点 + id + 状态徽标 + 标题 + due（逾期标红）/estimate/module
import { computed, ref } from "vue";
import type { TaskItem } from "../../api/types";
import { isTaskOverdue } from "../../utils/board";
import DateCell from "../DateCell.vue";
import PriorityDot from "../PriorityDot.vue";
import StatusBadge from "../StatusBadge.vue";

const props = withDefaults(defineProps<{ item: TaskItem; module?: string }>(), { module: "" });
const emit = defineEmits<{ open: [item: TaskItem] }>();

const dragging = ref(false);
const overdue = computed(() => isTaskOverdue(props.item));

function onDragStart(e: DragEvent): void {
  e.dataTransfer?.setData("text/plain", props.item.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  dragging.value = true;
}

function onDragEnd(): void {
  dragging.value = false;
}
</script>

<template>
  <article
    class="pm-card pm-task-card"
    :class="{ 'pm-card--dragging': dragging }"
    draggable="true"
    :data-id="props.item.id"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @click="emit('open', props.item)"
  >
    <header class="pm-task-card__head">
      <PriorityDot :priority="props.item.priority" />
      <span class="pm-task-card__id">{{ props.item.id }}</span>
      <StatusBadge :status="props.item.status" />
    </header>
    <h4 class="pm-task-card__title" :title="props.item.title">{{ props.item.title }}</h4>
    <footer class="pm-task-card__foot">
      <span v-if="props.module" class="pm-task-card__module">{{ props.module }}</span>
      <DateCell :value="props.item.due" :overdue="overdue" class="pm-task-card__due" />
      <span v-if="props.item.estimate !== undefined" class="pm-task-card__estimate" :title="`${props.item.estimate} 人日`">
        {{ props.item.estimate }}d
      </span>
    </footer>
  </article>
</template>
