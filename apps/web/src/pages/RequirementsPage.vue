<script setup lang="ts">
// 需求池 Tab 页（06-web §1 /p/:slug/requirements）：slug 由路由注入，看板组件承载全部交互
import { computed } from "vue";
import { useRoute } from "vue-router";
import RequirementsBoard from "../components/boards/RequirementsBoard.vue";

const route = useRoute();
const slug = computed(() => route.params.slug as string);
</script>

<template>
  <RequirementsBoard v-if="slug" :slug="slug" />
</template>
