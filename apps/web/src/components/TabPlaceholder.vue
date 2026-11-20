<script setup lang="ts">
// Tab 结构占位（S6 骨架）：路由与布局完整，看板/列表/图表内容在 S7 实施
defineProps<{ tab: string; title: string; description: string }>();
</script>

<template>
  <section class="pm-tab-placeholder">
    <h2 class="pm-tab-placeholder__title">{{ title }}</h2>
    <p class="pm-tab-placeholder__hint">{{ description }}</p>
    <span class="pm-tab-placeholder__badge">{{ tab }} · 结构占位</span>
  </section>
</template>
