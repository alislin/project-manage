<script setup lang="ts">
// 任务看板列（06-web §2.2 TaskColumn）：todo/doing/done/cancelled 单泳道列，跨列拖放 → move
import { ref } from "vue";
import type { TaskItem, TaskStatus } from "../../api/types";
import type { TaskLane } from "./types";
import TaskCard from "./TaskCard.vue";

/** boardService 精神（06-web §2.2）：module 经关联需求解析，由看板页注入（列保持纯展示） */
const props = withDefaults(defineProps<{ title: string; lanes: TaskLane[]; moduleOf?: (task: TaskItem) => string }>(), {
  moduleOf: () => () => "",
});
const emit = defineEmits<{ move: [id: string, to: TaskStatus]; open: [item: TaskItem] }>();

const overLane = ref<string>("");

function onDragOver(e: DragEvent, status: TaskStatus): void {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  overLane.value = status;
}

function onDragLeave(status: TaskStatus): void {
  if (overLane.value === status) overLane.value = "";
}

function onDrop(e: DragEvent, status: TaskStatus): void {
  e.preventDefault();
  overLane.value = "";
  const id = e.dataTransfer?.getData("text/plain") ?? "";
  if (id !== "") emit("move", id, status);
}
</script>

<template>
  <section class="pm-column">
    <header class="pm-column__head">
      <h3 class="pm-column__title">{{ title }}</h3>
      <span class="pm-column__count">{{ lanes.reduce((n, l) => n + l.items.length, 0) }}</span>
    </header>
    <div
      v-for="lane in lanes"
      :key="lane.status"
      class="pm-column__lane"
      :class="{ 'pm-column__lane--over': overLane === lane.status }"
      :data-status="lane.status"
      @dragover="onDragOver($event, lane.status)"
      @dragleave="onDragLeave(lane.status)"
      @drop="onDrop($event, lane.status)"
    >
      <div class="pm-column__lane-head">
        <span class="pm-column__lane-label">{{ lane.label }}</span>
        <span class="pm-column__lane-count">{{ lane.items.length }}</span>
      </div>
      <TaskCard
        v-for="it in lane.items"
        :key="it.id"
        :item="it"
        :module="props.moduleOf(it)"
        @open="emit('open', $event)"
      />
      <p v-if="lane.items.length === 0" class="pm-column__empty">暂无卡片</p>
    </div>
  </section>
</template>
