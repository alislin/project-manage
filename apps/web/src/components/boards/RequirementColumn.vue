<script setup lang="ts">
// 需求看板列（06-web §2.2 RequirementColumn）：一列含 ≥1 泳道（Done+Rejected 列双泳道，各自 drop 区）；
// 跨列拖放 → emit move(id, 目标状态)；点击卡片 → emit open。
import { ref } from "vue";
import type { ReqStatus, RequirementItem } from "../../api/types";
import type { RequirementLane } from "./types";
import RequirementCard from "./RequirementCard.vue";

defineProps<{ title: string; lanes: RequirementLane[] }>();
const emit = defineEmits<{ move: [id: string, to: ReqStatus]; open: [item: RequirementItem] }>();

/** 拖拽悬停高亮（06-web §6 步骤 1 showDropZone） */
const overLane = ref<string>("");

function onDragOver(e: DragEvent, status: ReqStatus): void {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  overLane.value = status;
}

function onDragLeave(status: ReqStatus): void {
  if (overLane.value === status) overLane.value = "";
}

function onDrop(e: DragEvent, status: ReqStatus): void {
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
      :data-testid="`req-lane-${lane.status}`"
      @dragover="onDragOver($event, lane.status)"
      @dragleave="onDragLeave(lane.status)"
      @drop="onDrop($event, lane.status)"
    >
      <div class="pm-column__lane-head">
        <span class="pm-column__lane-label">{{ lane.label }}</span>
        <span class="pm-column__lane-count">{{ lane.items.length }}</span>
      </div>
      <RequirementCard v-for="it in lane.items" :key="it.id" :item="it" @open="emit('open', $event)" />
      <p v-if="lane.items.length === 0" class="pm-column__empty">暂无卡片</p>
    </div>
  </section>
</template>
