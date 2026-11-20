import type { ServerResponse } from "node:http";

/**
 * 全局事件通道（05-server §5）：
 * - 接入：`event: connected` + `data: {"revision": N}`（连接后立即推送当前版本号）；
 * - 变更：`event: vault:updated` + `data: {"changes":[{op, path}], "revision": M}`
 *   （连续 flushDebounceMs 内的变更合并为一次推送，§5.3）；
 * - 心跳：每 pingIntervalMs 推一次 `event: vault:ping` + `data: {}`（§5.2，默认 15s）；
 * - 断线重连：客户端原生重连后重新收到 connected（携带最新 revision）→ 全量刷新（§5.2 重连语义）。
 */

/** 变更操作（05-server §5.2）：add=新增文件 / change=内容变化 / unlink=删除 */
export type SseOp = "add" | "change" | "unlink";

export interface SseChange {
  op: SseOp;
  path: string;
}

/**
 * changes 合并规则（05-server §5.2/§5.4，TC-05-037）：
 * - 每个 path 只保留最后一次操作；
 * - unlink 后若再出现 add（窗口内删后又建），合并为 change（避免前端重复删）。
 * 纯函数，便于确定性单测。
 */
export function mergeChange(pending: Map<string, SseOp>, op: SseOp, relPath: string): void {
  const prev = pending.get(relPath);
  pending.set(relPath, prev === "unlink" && op === "add" ? "change" : op);
}

export interface SseHubOptions {
  /** 变更推送合并窗口 ms（05-server §5.3，默认 250） */
  flushDebounceMs: number;
  /** 心跳间隔 ms（05-server §5.2 Q-08，默认 15000；0 = 禁用） */
  pingIntervalMs: number;
}

export class SseHub {
  private clients = new Set<ServerResponse>();
  private pending = new Map<string, SseOp>();
  private flushTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private _revision = 0;

  constructor(private readonly opts: SseHubOptions) {}

  /** 当前状态版本号（connected 载荷 / vault:updated 递增） */
  get revision(): number {
    return this._revision;
  }

  /** 接入一个 SSE 客户端（已 hijack 的原始响应流）：立即推送 connected（§5.2） */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });
    this.clients.add(res);
    this.write(res, "connected", { revision: this.revision });
    if (this.clients.size === 1 && this.opts.pingIntervalMs > 0) {
      this.pingTimer = setInterval(() => {
        for (const c of [...this.clients]) this.write(c, "vault:ping", {});
      }, this.opts.pingIntervalMs);
    }
    // 客户端断开（浏览器原生重连前旧连接关闭）→ 自动移除（§5.2 重连语义）
    res.on("close", () => this.removeClient(res));
  }

  removeClient(res: ServerResponse): void {
    this.clients.delete(res);
    if (this.clients.size === 0 && this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /** 记录一条变更（由 watcher 接线调用，05-server §5.4），合并后按防抖窗推送 */
  recordChange(op: SseOp, relPath: string): void {
    mergeChange(this.pending, op, relPath);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.opts.flushDebounceMs);
  }

  /** 推送积压变更（revision 递增一次；空积压不推送） */
  flush(): void {
    if (this.pending.size === 0) return;
    const changes: SseChange[] = [...this.pending.entries()].map(([path, op]) => ({ op, path }));
    this.pending.clear();
    this._revision++;
    for (const c of [...this.clients]) this.write(c, "vault:updated", { changes, revision: this.revision });
  }

  /** 服务停止时销毁全部客户端连接与定时器（保证 fastify.close 可完成） */
  closeAll(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    for (const c of [...this.clients]) c.destroy();
    this.clients.clear();
    this.pending.clear();
  }

  private write(res: ServerResponse, event: string, data: unknown): void {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
