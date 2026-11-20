<script setup lang="ts">
// 任务列表 Tab 页（06-web §1 /p/:slug/tasks-list）
import { computed } from "vue";
import { useRoute } from "vue-router";
import TaskList from "../components/TaskList.vue";

const route = useRoute();
const slug = computed(() => route.params.slug as string);
</script>

<template>
  <TaskList v-if="slug" :slug="slug" />
</template>
