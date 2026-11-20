<script setup lang="ts">
// 统一错误提示（06-web §2.1 ErrorToast）：api client 全局钩子写入 ui store，点击关闭
// S11：E_INVALID_RESPONSE 等长排查指引文案完整展示（样式层 overflow-wrap 换行，不截断）
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
</script>

<template>
  <div class="pm-toast" aria-live="polite">
    <TransitionGroup name="pm-toast-fade">
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="pm-toast__item"
        :class="`pm-toast__item--${t.tone}`"
        role="alert"
        @click="ui.dismissToast(t.id)"
      >
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>
