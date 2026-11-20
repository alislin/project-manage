<script setup lang="ts">
// 409 冲突提示弹窗（06-web §3.2 / Q-05 定案文案）：
// "文件已被外部修改（mtime 冲突），是否刷新并重试？"（刷新并重试 / 取消）
// 重试动作由宿主（看板/列表页）处理：refresh() → moveStatus() 再次流转。
import { useUiStore } from "../stores/ui";

const emit = defineEmits<{ retry: [] }>();
const ui = useUiStore();
</script>

<template>
  <div v-if="ui.conflict" class="pm-modal" @click.self="ui.clearConflict()">
    <div class="pm-modal__dialog pm-conflict" role="alertdialog" aria-modal="true" aria-label="冲突提示">
      <h3 class="pm-conflict__title">文件已被外部修改</h3>
      <p class="pm-conflict__message">{{ ui.conflict.message }}</p>
      <p class="pm-conflict__meta">{{ ui.conflict.id }} → {{ ui.conflict.to }}</p>
      <div class="pm-conflict__actions">
        <button class="pm-conflict__btn" type="button" @click="emit('retry')">刷新并重试</button>
        <button class="pm-conflict__btn pm-conflict__btn--ghost" type="button" @click="ui.clearConflict()">取消</button>
      </div>
    </div>
  </div>
</template>
