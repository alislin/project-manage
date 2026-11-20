<script setup lang="ts">
// 顶部导航（06-web §2.1）：返回首页、主题切换、新建项目入口
import { useRouter } from "vue-router";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const router = useRouter();

function goHome(): void {
  void router.push("/");
}

function newProject(): void {
  ui.pushToast("新建项目表单将在后续阶段提供", "info");
}
</script>

<template>
  <header class="pm-header">
    <a class="pm-header__brand" href="/" @click.prevent="goHome">PM 台账</a>
    <div class="pm-header__actions">
      <button
        class="pm-header__btn"
        type="button"
        :title="ui.isDark ? '切换到亮色主题' : '切换到暗色主题'"
        @click="ui.toggleTheme()"
      >
        {{ ui.isDark ? "☀ 亮色" : "☾ 暗色" }}
      </button>
      <button class="pm-header__btn pm-header__btn--accent" type="button" @click="newProject">
        新建项目
      </button>
    </div>
  </header>
</template>
