import { startServer } from "./index.js";

/**
 * 开发入口（`npm run dev --workspace @pm/server`）：等价 `pm serve`，默认 cwd/pm.config.json。
 * 生命周期（05-server §7.3）：SIGINT/SIGTERM → watcher.stop() + fastify.close() → 退出码 0。
 */
const res = await startServer({});
if (!res.ok) {
  console.error(`✗ 启动失败: [${res.error.code}] ${res.error.message}`);
  process.exit(res.error.code === "E_CONFIG_INVALID" ? 2 : 1);
}

const suffix = res.value.webDist ? ` （静态托管 ${res.value.webDist}）` : "";
console.log(`ℹ️  启动 PM Web 服务 ${res.value.url}${suffix}`);

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  void res.value.stop().then(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
