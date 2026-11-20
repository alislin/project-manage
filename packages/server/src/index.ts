import fs from "node:fs";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  buildIndex,
  err,
  loadConfig,
  ok,
  E_IO,
  type AppError,
  type AppResult,
  type VaultIndex,
} from "@pm/core";
import { isAppErrorLike, sendErr } from "./errors.js";
import { registerRoutes } from "./routes.js";
import { SseHub } from "./sse.js";
import { wireWatcher, type ServerState } from "./state.js";

/**
 * PM Web 服务（05-server）：REST API（§2–§4）+ SSE（§5）+ 静态托管/SPA fallback（§7.1）。
 * 生命周期（§7.3）：loadConfig → buildIndex → startWatcher(250ms) → listen；
 * 退出：watcher.stop() + fastify.close()。
 */

export interface BuildServerOptions {
  /** 工程根（pm.config.json 所在目录），默认 process.cwd() */
  root?: string;
  /** 静态托管目录覆盖（测试注入）；默认 <repo>/apps/web/dist，不存在则不托管；null 显式禁用 */
  webDist?: string | null;
  /** chokidar 防抖 ms（02-core §5.5，默认 250） */
  watcherDebounceMs?: number;
  /** SSE 变更推送合并窗口 ms（05-server §5.3，默认 250） */
  flushDebounceMs?: number;
  /** SSE 心跳间隔 ms（05-server §5.2 Q-08，默认 15000；0 禁用） */
  pingIntervalMs?: number;
  /** Fastify logger（默认关闭） */
  logger?: boolean;
}

export interface BuiltServer {
  app: FastifyInstance;
  state: ServerState;
  index: VaultIndex;
}

/** 默认静态目录：<packages/server/{src,dist}>/../../../apps/web/dist（src 与 dist 同层深度） */
function defaultWebDist(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/dist");
}

/** 构建 Fastify 实例（不 listen）；配置非法返回 E_CONFIG_INVALID（05-server §6.5） */
export async function buildServer(opts: BuildServerOptions = {}): Promise<AppResult<BuiltServer>> {
  const cfg = loadConfig(opts.root);
  if (!cfg.ok) return cfg;
  const index = buildIndex(cfg.value);

  const hub = new SseHub({
    flushDebounceMs: opts.flushDebounceMs ?? 250,
    pingIntervalMs: opts.pingIntervalMs ?? 15000,
  });

  const app = Fastify({ logger: opts.logger ?? false });

  // CORS（05-server §1 通用约定；开发期 Vite 代理之外的直连场景）：
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  // 统一错误信封（05-server §1.1 / §6.5）：任何未捕获错误都收敛为 { ok:false, error }
  app.setErrorHandler((rawError: FastifyError, _req, reply) => {
    const e: unknown = rawError; // 加宽避免类型谓词把 FastifyError 收窄成 never
    if (isAppErrorLike(e)) return sendErr(reply, e);
    const statusCode = rawError.statusCode;
    if (statusCode === 400 || statusCode === 404 || statusCode === 415) {
      return sendErr(reply, { code: "E_USAGE", message: rawError.message });
    }
    const error: AppError = { code: E_IO, message: rawError.message || "服务器内部错误" };
    return sendErr(reply, error);
  });

  const partialState: Omit<ServerState, "watcher" | "webDist"> = { config: cfg.value, index, hub };

  // API 路由（05-server §2–§5；先于静态托管注册，§7.1 顺序）
  registerRoutes(app, partialState);

  // 静态托管（05-server §7.1）：apps/web/dist 存在时注册；index:false + wildcard:false →
  // 启动时按文件注册精确路由，/ 与无扩展名路由均落入 setNotFoundHandler 的 SPA fallback
  let webDist: string | undefined;
  const requestedDist = opts.webDist === undefined ? defaultWebDist() : opts.webDist;
  if (typeof requestedDist === "string" && fs.existsSync(requestedDist)) {
    await app.register(fastifyStatic, { root: requestedDist, index: false, wildcard: false });
    webDist = requestedDist;
  }

  // SPA fallback + API 404 信封（05-server §7.1 / TC-05-039）
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "/";
    if (url === "/api" || url.startsWith("/api/")) {
      return sendErr(reply, { code: "E_NOT_FOUND", message: `接口不存在: ${req.method} ${url}` });
    }
    if (webDist) {
      const pathname = url.split("?")[0];
      const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
      const hasExtension = /\.[A-Za-z0-9]+$/.test(lastSegment);
      const indexPath = path.join(webDist, "index.html");
      if (!hasExtension && fs.existsSync(indexPath)) {
        return void reply.code(200).type("text/html; charset=utf-8").send(fs.readFileSync(indexPath, "utf8"));
      }
    }
    void reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  });

  // watcher 接线（05-server §5.4；自写过滤与防抖沿用 core §5.3/§5.5）
  const watcher = wireWatcher(partialState, opts.watcherDebounceMs ?? 250);

  await app.ready();
  const state: ServerState = { ...partialState, watcher, webDist };
  return ok({ app, state, index });
}

export interface RunningServer {
  port: number;
  host: string;
  url: string;
  /** 生效的静态托管目录（未托管时为 undefined） */
  webDist?: string;
  /** 优雅停止：SSE 客户端断开 → watcher 停止 → fastify 关闭（05-server §7.3） */
  stop(): Promise<void>;
}

export interface StartServerOptions extends BuildServerOptions {
  /** 监听端口（默认 3000，03-cli §8；0 = 随机端口） */
  port?: number;
  /** 监听地址（默认 127.0.0.1，03-cli §8） */
  host?: string;
}

/** 构建并监听（05-server §7.3）；监听失败返回 E_IO */
export async function startServer(opts: StartServerOptions = {}): Promise<AppResult<RunningServer>> {
  const port = opts.port ?? 3000;
  const host = opts.host ?? "127.0.0.1";
  const built = await buildServer(opts);
  if (!built.ok) return built;
  const { app, state } = built.value;
  try {
    await app.listen({ port, host });
  } catch (e) {
    const error: AppError = { code: E_IO, message: `监听 ${host}:${port} 失败: ${e instanceof Error ? e.message : String(e)}` };
    state.hub.closeAll();
    state.watcher.stop();
    await app.close();
    return err(error);
  }
  const addr = app.server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
  return ok({
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}/`,
    webDist: state.webDist,
    stop: async () => {
      state.hub.closeAll();
      state.watcher.stop();
      await app.close();
    },
  });
}
