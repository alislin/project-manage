<script setup lang="ts">
// 任务看板 Tab 页（06-web §1 /p/:slug/tasks-board）
import { computed } from "vue";
import { useRoute } from "vue-router";
import TasksBoard from "../components/boards/TasksBoard.vue";

const route = useRoute();
const slug = computed(() => route.params.slug as string);
</script>

<template>
  <TasksBoard v-if="slug" :slug="slug" />
</template>
