<script setup lang="ts">
// 进度环（06-web §7.1 ProjectCard 进度环形，纯 CSS conic-gradient，不依赖图表库）
import { computed } from "vue";

const props = defineProps<{ rate: number }>();

function clamp(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

const pct = computed(() => Math.round(clamp(props.rate) * 100));
/** conic-gradient 分界角：done 扇区 = rate × 360°，其余为 rest 色 */
const ringStyle = computed(() => {
  const deg = clamp(props.rate) * 360;
  return {
    background: `conic-gradient(var(--pm-progress-done) ${deg}deg, var(--pm-progress-rest) ${deg}deg 360deg)`,
  };
});
</script>

<template>
  <div class="pm-progress-ring" :style="ringStyle" role="img" :aria-label="`完成率 ${pct}%`">
    <span class="pm-progress-ring__value">{{ pct }}%</span>
  </div>
</template>
