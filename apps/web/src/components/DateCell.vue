<script setup lang="ts">
// 日期单元格（06-web §2.2 DateCell）：今天转相对文案 / 逾期标红 / 其余自然转绝对日期
import { computed } from "vue";

const props = withDefaults(defineProps<{ value: string; overdue?: boolean; today?: boolean }>(), {
  overdue: false,
  today: false,
});

const label = computed(() => (props.today ? "今天" : props.value));
</script>

<template>
  <span class="pm-date" :class="{ 'pm-date--overdue': props.overdue }" :title="props.value">{{ label }}</span>
</template>
