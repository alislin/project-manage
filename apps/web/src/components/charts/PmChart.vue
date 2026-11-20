<script setup lang="ts">
// 通用图表容器（S8，06-web §7/§9.1）：
// - echarts/core 按需实例（utils/echarts.ts）；option 变更 setOption(notMerge) 即时重绘
//   —— 主题切换时页面重算 option（CSS 变量色板）→ 图表即时换色（TC-06-023）；
// - ResizeObserver 自适应容器宽度，卸载时 dispose；
// - empty=true 渲染空态文案分支，不初始化 echarts（TC-06-024 空 vault）。
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { echarts } from "../../utils/echarts";

const props = withDefaults(
  defineProps<{
    /** 图表配置（utils/charts.ts 工厂产出） */
    option: EChartsCoreOption;
    /** 空态分支：true 时不初始化图表、仅渲染文案 */
    empty?: boolean;
    emptyText?: string;
    /** 容器高度（px 值字符串） */
    height?: string;
  }>(),
  { empty: false, emptyText: "暂无数据", height: "280px" },
);

const el = ref<HTMLDivElement | null>(null);
let chart: EChartsType | null = null;
let ro: ResizeObserver | null = null;

function render(): void {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  chart.setOption(props.option, true);
}

function startObserve(): void {
  if (typeof ResizeObserver === "undefined" || !el.value || ro) return;
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(el.value);
}

function stopObserve(): void {
  ro?.disconnect();
  ro = null;
}

function disposeChart(): void {
  chart?.dispose();
  chart = null;
}

onMounted(() => {
  if (props.empty) return;
  render();
  startObserve();
});

// option 引用变化（数据刷新 / 主题换色）→ 重绘
watch(
  () => props.option,
  () => {
    if (!props.empty) render();
  },
);

// 空态切换：进入空态销毁实例；退出空态重建（flush:post 等 DOM 重挂载后再 init）
watch(
  () => props.empty,
  (empty) => {
    if (empty) {
      stopObserve();
      disposeChart();
    } else {
      render();
      startObserve();
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  stopObserve();
  disposeChart();
});
</script>

<template>
  <div class="pm-chart">
    <div v-if="!empty" ref="el" class="pm-chart__canvas" :style="{ height }" />
    <div v-else class="pm-chart__empty" :style="{ height }" role="status">{{ emptyText }}</div>
  </div>
</template>
