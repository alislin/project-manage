<script setup lang="ts">
// 需求卡（06-web §2.2 RequirementCard）：priority 圆点 + id + 状态徽标 + 标题 + module/来源悬浮；
// HTML5 原生拖拽源（06-web §3.1"vuedraggable 或同类"），dragstart 写入 dataTransfer 供列 drop 读取。
import { ref } from "vue";
import type { RequirementItem } from "../../api/types";
import PriorityDot from "../PriorityDot.vue";
import StatusBadge from "../StatusBadge.vue";

const props = defineProps<{ item: RequirementItem }>();
const emit = defineEmits<{ open: [item: RequirementItem] }>();

/** 拖拽中样式（06-web §8 --dragging 缩放/阴影） */
const dragging = ref(false);

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
    class="pm-card pm-req-card"
    :class="{ 'pm-card--dragging': dragging }"
    draggable="true"
    :data-id="props.item.id"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @click="emit('open', props.item)"
  >
    <header class="pm-req-card__head">
      <PriorityDot :priority="props.item.priority" />
      <span class="pm-req-card__id">{{ props.item.id }}</span>
      <StatusBadge :status="props.item.status" />
    </header>
    <h4 class="pm-req-card__title" :title="props.item.title">{{ props.item.title }}</h4>
    <footer class="pm-req-card__foot">
      <span v-if="props.item.module" class="pm-req-card__module">{{ props.item.module }}</span>
      <span class="pm-req-card__source" :title="props.item.source">{{ props.item.source }}</span>
    </footer>
  </article>
</template>
