<script setup lang="ts">
// 状态徽标（06-web §9.2/§10）：枚举 → `--pm-status-*` 语义色，唯一调用变量点的组件之一
import { computed } from "vue";

const props = defineProps<{ status: string }>();

/** 已知枚举直接映射 BEM 修饰符；未知值回落中性灰 */
const modifier = computed(() => {
  const known = [
    "active", "paused", "done", "archived",
    "pool", "reviewing", "accepted", "rejected",
    "todo", "doing", "cancelled",
  ];
  return known.includes(props.status) ? props.status : "neutral";
});
const label = computed(() => props.status);
</script>

<template>
  <span class="pm-badge" :class="`pm-badge--${modifier}`">{{ label }}</span>
</template>
