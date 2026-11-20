<script setup lang="ts">
// 优先级圆点（06-web §2.2 PriorityDot / §9.2：P0 红 P1 橙 P2 琥珀 P3 琥珀-深）
import { computed } from "vue";

const props = defineProps<{ priority: "P0" | "P1" | "P2" | "P3" }>();

const modifier = computed(() => props.priority.toLowerCase());
</script>

<template>
  <span class="pm-dot" :class="`pm-dot--${modifier}`" :title="props.priority" :aria-label="`优先级 ${props.priority}`" />
</template>
