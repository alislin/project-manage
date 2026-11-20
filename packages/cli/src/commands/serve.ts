import { failWith } from "./helpers.js";

/**
 * `pm serve`（03-cli §8, 05-server §7）：启动 Fastify Web 服务（REST API + SSE + 静态托管）。
 * 运行时长：阻塞直到被中断（SIGINT/SIGTERM → 优雅停止 → 退出码 0）。
 * @pm/server 经动态导入（仅实际启动时加载，05-server §7.3 生命周期由其内部维护）。
 */

export interface ServeOpts {
  port?: number;
  host?: string;
  root?: string;
}

/** 结构化类型（与 @pm/server 运行时形状对齐，避免构建期静态依赖顺序问题） */
interface RunningServerLike {
  port: number;
  host: string;
  url: string;
  webDist?: string;
  stop(): Promise<void>;
}
interface StartServerLike {
  startServer(opts: { root?: string; port?: number; host?: string }): Promise<
    { ok: true; value: RunningServerLike } | { ok: false; error: { code: string; message: string; file?: string; field?: string; issues?: Array<{ file: string; field: string; code: string; message: string }> } }
  >;
}

export async function runServe(opts: ServeOpts): Promise<number> {
  let mod: StartServerLike;
  try {
    mod = (await import("@pm/server")) as unknown as StartServerLike;
  } catch (e) {
    console.error(`加载 @pm/server 失败（需先构建：npm run build --workspace @pm/server）: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const res = await mod.startServer({ root: opts.root, port: opts.port, host: opts.host });
  if (!res.ok) return failWith(res.error, false);

  const s = res.value;
  // 启动输出（03-cli §8）：ℹ️  启动 PM Web 服务 http://127.0.0.1:3000/ （静态托管 apps/web/dist）
  console.log(`ℹ️  启动 PM Web 服务 ${s.url}${s.webDist ? ` （静态托管 ${s.webDist}）` : ""}`);

  // 阻塞直到中断；SIGINT/SIGTERM → watcher.stop + fastify.close → 退出码 0（03-cli §8 / 05-server §7.3）
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    console.log("\nℹ️  正在停止 PM Web 服务…");
    void s.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise<never>(() => {});
  return 0; // 不可达：Promise 永不 resolve
}
