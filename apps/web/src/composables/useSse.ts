/**
 * SSE 订阅（06-web §5 / 05-server §5.2）：
 * - 连接 `/api/events`，处理 `connected` / `vault:updated` / `vault:ping`（忽略，保活）；
 * - 断线：`EventSource` 原生重连之外做显式守护——连续失败 ≥ 阈值（默认 3 次）时
 *   1) 提示"SSE 不可用，将每 15s 全量刷新一次"；2) 启动 15s 轮询兜底；
 *   3) 按指数退避（base ≈3s）关闭旧连接并重建；`open` 成功即恢复实时并停轮询；
 * - 依赖注入 EventSource 构造器，便于 vitest 用 Mock 驱动重连逻辑。
 */
import { onMounted, onUnmounted } from "vue";
import type { VaultUpdatedPayload } from "../api/types";

export interface SseClientOptions {
  url?: string;
  /** 依赖注入（测试用 Mock），缺省用全局 EventSource */
  EventSourceCtor?: typeof EventSource;
  /** 显式重连基础延迟 ms（默认 3000，指数退避） */
  reconnectBaseDelayMs?: number;
  /** 降级轮询间隔 ms（默认 15000） */
  fallbackPollingMs?: number;
  /** 连续失败多少次进入降级轮询（默认 3） */
  fallbackThreshold?: number;
  /** 收到 connected（携带 revision）——触发全量刷新 */
  onConnected?: (revision: number) => void;
  /** 收到 vault:updated——触发受影响 store 局部刷新 */
  onVaultUpdated?: (payload: VaultUpdatedPayload) => void;
  /** 进入降级轮询（提示一次"SSE 不可用…"） */
  onFallback?: () => void;
  /** 降级轮询的每次刷新动作（如 GET /api/projects 全量刷新） */
  requestFullRefresh?: () => void;
}

export interface SseClient {
  /** 建立连接并注册守护（组件中经 useSse 自动调用） */
  start: () => void;
  /** 停止：关闭连接、清定时器 */
  stop: () => void;
  /** 调试/测试观察：当前状态 */
  readonly status: () => "connecting" | "live" | "fallback" | "stopped";
  /** 测试观察：连续失败计数 */
  readonly failureCount: () => number;
}

export function createSseClient(opts: SseClientOptions): SseClient {
  const {
    url = "/api/events",
    EventSourceCtor = globalThis.EventSource,
    reconnectBaseDelayMs = 3000,
    fallbackPollingMs = 15000,
    fallbackThreshold = 3,
  } = opts;

  let es: EventSource | null = null;
  let failures = 0;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let state: ReturnType<SseClient["status"]> = "stopped";

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => opts.requestFullRefresh?.(), fallbackPollingMs);
    opts.onFallback?.();
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function connect(): void {
    if (stopped || !EventSourceCtor) return;
    state = "connecting";
    es = new EventSourceCtor(url);

    es.onopen = () => {
      // HTTP 通道恢复：重置计数、退出降级轮询（connected 事件随后触发全量刷新）
      failures = 0;
      attempts = 0;
      stopPolling();
    };

    es.addEventListener("connected", (ev: Event) => {
      const data = JSON.parse((ev as MessageEvent).data ?? "{}") as { revision?: number };
      state = "live";
      opts.onConnected?.(data.revision ?? 0);
    });

    es.addEventListener("vault:updated", (ev: Event) => {
      const data = JSON.parse((ev as MessageEvent).data ?? "{}") as VaultUpdatedPayload;
      state = "live";
      opts.onVaultUpdated?.(data);
    });

    // vault:ping 保活事件：忽略（06-web §5）
    es.addEventListener("vault:ping", () => {});

    es.onerror = () => {
      if (stopped) return;
      failures++;
      if (failures >= fallbackThreshold) {
        startPolling();
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    // 指数退避：base * 2^attempt，封顶 30s
    const delay = Math.min(reconnectBaseDelayMs * 2 ** attempts, 30000);
    attempts++;
    es?.close();
    es = null;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      state = "stopped";
      es?.close();
      es = null;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      stopPolling();
    },
    status: () => state,
    failureCount: () => failures,
  };
}

/**
 * 组件级组合式封装：onMounted 连接 / onUnmounted 停止。
 * 业务侧传入回调；`requestFullRefresh` 缺省为无操作（App.vue 接 projects.refresh）。
 */
export function useSse(opts: SseClientOptions): SseClient {
  const client = createSseClient(opts);
  onMounted(() => client.start());
  onUnmounted(() => client.stop());
  return client;
}
