import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSseClient } from "./useSse";

/** 可手动驱动事件的 Mock EventSource（node 环境 vitest 无原生 EventSource） */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: { data?: string }) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  emit(type: string, data?: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data });
  }

  close(): void {
    this.closed = true;
  }
}

const asCtor = MockEventSource as unknown as typeof EventSource;

describe("useSse：连接 /api/events 与断线重连逻辑（06-web §5）", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connected → onConnected 携带 revision；vault:updated → onVaultUpdated；vault:ping 忽略", () => {
    const onConnected = vi.fn();
    const onVaultUpdated = vi.fn();
    const client = createSseClient({ EventSourceCtor: asCtor, onConnected, onVaultUpdated });

    client.start();
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toBe("/api/events");

    es.emit("connected", JSON.stringify({ revision: 12 }));
    expect(onConnected).toHaveBeenCalledWith(12);

    es.emit(
      "vault:updated",
      JSON.stringify({ changes: [{ op: "change", path: "projects/proj/requirements/REQ-proj-001.md" }], revision: 13 }),
    );
    expect(onVaultUpdated).toHaveBeenCalledWith({
      changes: [{ op: "change", path: "projects/proj/requirements/REQ-proj-001.md" }],
      revision: 13,
    });

    es.emit("vault:ping");
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onVaultUpdated).toHaveBeenCalledTimes(1);

    client.stop();
    expect(es.closed).toBe(true);
  });

  it("连续失败 ≥3 次 → 降级：提示一次 + 15s 兜底轮询 + 指数退避重连；重连 open 后恢复实时", () => {
    const onFallback = vi.fn();
    const requestFullRefresh = vi.fn();
    const client = createSseClient({
      EventSourceCtor: asCtor,
      reconnectBaseDelayMs: 1000,
      fallbackPollingMs: 5000,
      fallbackThreshold: 3,
      onFallback,
      requestFullRefresh,
    });

    client.start();
    const es1 = MockEventSource.instances[0];

    // 前两次失败：仅计数（EventSource 原生重连负责，无降级）
    es1.onerror?.();
    es1.onerror?.();
    expect(client.failureCount()).toBe(2);
    expect(onFallback).not.toHaveBeenCalled();
    expect(requestFullRefresh).not.toHaveBeenCalled();

    // 第 3 次失败：进入降级（提示 + 轮询 + 显式重连排程）
    es1.onerror?.();
    expect(client.failureCount()).toBe(3);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(es1.closed).toBe(true);

    // 退避重连（attempts=0 → delay=1000ms）
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances).toHaveLength(2);
    const es2 = MockEventSource.instances[1];

    // 降级轮询：每 5000ms 一次全量刷新
    vi.advanceTimersByTime(5000);
    expect(requestFullRefresh).toHaveBeenCalledTimes(1);

    // 重连成功（open）：重置计数、停止轮询、恢复实时
    es2.onopen?.();
    expect(client.failureCount()).toBe(0);
    vi.advanceTimersByTime(30000);
    expect(requestFullRefresh).toHaveBeenCalledTimes(1); // 轮询已停，不再增加

    client.stop();
    expect(es2.closed).toBe(true);
  });

  it("重连继续失败 → 退避翻倍（1000 → 2000ms）并保持降级轮询", () => {
    const requestFullRefresh = vi.fn();
    const client = createSseClient({
      EventSourceCtor: asCtor,
      reconnectBaseDelayMs: 1000,
      fallbackPollingMs: 15000,
      fallbackThreshold: 3,
      requestFullRefresh,
    });

    client.start();
    let es = MockEventSource.instances[0];
    for (let i = 0; i < 3; i++) es.onerror?.(); // 触发降级 + 第一次重连排程

    vi.advanceTimersByTime(999);
    expect(MockEventSource.instances).toHaveLength(1); // 未到延迟
    vi.advanceTimersByTime(1);
    expect(MockEventSource.instances).toHaveLength(2);

    // 新连接再失败 3 次 → 第二次重连退避 2000ms
    es = MockEventSource.instances[1];
    for (let i = 0; i < 3; i++) es.onerror?.();
    vi.advanceTimersByTime(1999);
    expect(MockEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockEventSource.instances).toHaveLength(3);

    // 轮询仍在运行
    vi.advanceTimersByTime(15000);
    expect(requestFullRefresh).toHaveBeenCalledTimes(1);

    client.stop();
    expect(requestFullRefresh).toHaveBeenCalledTimes(1);
  });
});
