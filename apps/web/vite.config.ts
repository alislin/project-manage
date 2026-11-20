import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * dev 代理目标（S11 hotfix 问题 1）：
 * - 旧写法硬编码 http://127.0.0.1:3000：3000 端口被其他应用占用/另有服务监听时，
 *   dev 代理会"静默"把 /api 打到别的应用，前端只看到莫名的非 JSON 响应；
 * - 现改由环境变量 PM_API_TARGET 指定，缺省 http://127.0.0.1:3000；
 * - dev 启动时回显解析结果（apply:"serve" 仅 dev 生效），不再静默。
 * 用法：`npm run dev:web`（根 package.json dev:web 透传环境变量），
 * 例：PowerShell `$env:PM_API_TARGET="http://127.0.0.1:4000"; npm run dev:web`。
 */
const apiTarget = process.env.PM_API_TARGET ?? "http://127.0.0.1:3000";

/** dev 启动时回显 /api 代理目标，便于排查"代理打到别的应用"（S11 问题 1） */
function echoApiTarget(): Plugin {
  return {
    name: "pm-echo-api-target",
    apply: "serve",
    configureServer() {
      const source = process.env.PM_API_TARGET ? "（PM_API_TARGET）" : "（默认，可用环境变量 PM_API_TARGET 覆盖）";
      console.log(`[pm-web] dev 代理 /api → ${apiTarget}${source}`);
    },
  };
}

export default defineConfig({
  plugins: [vue(), echoApiTarget()],
  build: {
    rollupOptions: {
      output: {
        // S8：echarts（含 zrender）按需引入后单独分包——缓存友好，体积变化可从产物文件直接观察
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return "echarts";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": apiTarget,
    },
  },
});
