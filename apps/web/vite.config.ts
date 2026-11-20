import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
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
      "/api": "http://127.0.0.1:3000",
    },
  },
});
