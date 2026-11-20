import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useUiStore } from "./stores/ui";
import { setApiErrorHandler } from "./api/client";
import "./styles/main.scss";

const app = createApp(App);
app.use(createPinia());

// 主题初始化：首帧前套 data-theme，避免闪烁（06-web §9.1）
const ui = useUiStore();
ui.initTheme();

// api 全局错误 → 统一 Toast（06-web §2.1 ErrorToast）
setApiErrorHandler((err) => ui.pushToast(`[${err.code}] ${err.message}`));

app.use(router);
app.mount("#app");
