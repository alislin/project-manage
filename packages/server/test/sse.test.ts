import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, type RunningServer } from "../src/index.js";
import { mergeChange, type SseOp } from "../src/sse.js";
import {
  makeVaultRoot,
  writePmFile,
  pmPath,
  rmRetry,
  sleep,
  today,
  PROJECT_MD_WEB,
  reqMd,
} from "./helpers";

/** TC-05-036/037 · SSE 全局事件通道（05-server §5）：connected / vault:updated / vault:ping / 合并规则 / 自写过滤 / 重连 */

interface SseEvent {
  event: string;
  data: string;
}

interface SseConnection {
  events: SseEvent[];
  close(): void;
}

/** 真实 HTTP 连接（SSE 为 hijack 流，inject 不适用） */
function sseConnect(url: string): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const events: SseEvent[] = [];
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev: SseEvent = { event: "", data: "" };
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) ev.event = line.slice(6).trim();
            else if (line.startsWith("data:")) ev.data = line.slice(5).trim();
          }
          events.push(ev);
        }
      });
      resolve({ events, close: () => req.destroy() });
    });
    req.on("error", reject);
  });
}

async function waitForEvent(events: SseEvent[], name: string, timeoutMs = 5000): Promise<SseEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find((e) => e.event === name);
    if (found) return found;
    await sleep(25);
  }
  throw new Error(`等待事件超时: ${name}（已收到: ${events.map((e) => e.event).join(",") || "无"}）`);
}

/** 等待第 minCount 个指定事件（防抖窗口内的多次变更合并为一个事件） */
async function waitForEventCount(events: SseEvent[], name: string, minCount: number, timeoutMs = 5000): Promise<SseEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = events.filter((e) => e.event === name);
    if (matched.length >= minCount) return matched[matched.length - 1];
    await sleep(25);
  }
  throw new Error(`等待事件超时: ${name} #${minCount}（已收到: ${events.map((e) => e.event).join(",") || "无"}）`);
}

describe("TC-05 SSE（05-server §5）", () => {
  let root: string;
  let vault: string;
  let started: { ok: true; value: RunningServer } | undefined;
  let conn: SseConnection | undefined;

  afterEach(async () => {
    conn?.close();
    if (started?.ok) await started.value.stop();
    if (root) rmRetry(root);
  });

  async function newRunning(): Promise<RunningServer> {
    root = makeVaultRoot("pm-server-sse-");
    vault = path.join(root, "vault");
    writePmFile(vault, "projects/web/project.md", PROJECT_MD_WEB);
    writePmFile(vault, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "pool"));
    const res = await startServer({ root, webDist: null, port: 0, watcherDebounceMs: 30, flushDebounceMs: 30, pingIntervalMs: 100 });
    if (!res.ok) throw new Error(`startServer 失败: ${res.error.message}`);
    started = res;
    await sleep(400); // 等 chokidar 初始化完成（初始化窗口内的事件会被丢弃）
    return res.value;
  }

  it("TC-05-036: SSE 连接收到 connected，外部修改推送 vault:updated，心跳 vault:ping（P0）", async () => {
    const s = await newRunning();
    conn = await sseConnect(`${s.url}api/events`);
    // 1) 接入：event: connected + data:{"revision":N}（05-server §5.2）
    const connected = await waitForEvent(conn.events, "connected");
    expect(connected.event).toBe("connected");
    expect(JSON.parse(connected.data)).toEqual({ revision: 0 });

    // 2) 外部修改（Obsidian 语义）→ vault:updated{changes:[{op, path}], revision}
    const abs = pmPath(vault, "projects/web/requirements/REQ-web-001.md");
    fs.appendFileSync(abs, "\n外部修改\n");
    const updated = await waitForEvent(conn.events, "vault:updated");
    const payload = JSON.parse(updated.data) as { changes: Array<{ op: string; path: string }>; revision: number };
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].path).toBe("projects/web/requirements/REQ-web-001.md");
    expect(["change", "add"]).toContain(payload.changes[0].op);
    expect(payload.revision).toBe(1);

    // 3) 心跳（Q-08，默认 15s；测试用 100ms 间隔）
    const ping = await waitForEvent(conn.events, "vault:ping", 3000);
    expect(ping.event).toBe("vault:ping");
    expect(JSON.parse(ping.data)).toEqual({});
  });

  it("TC-05-036b: 外部新增/删除文件 → add / unlink 推送（P0）", async () => {
    const s = await newRunning();
    conn = await sseConnect(`${s.url}api/events`);
    await waitForEvent(conn.events, "connected");
    const updatedCount = (): number => conn!.events.filter((e) => e.event === "vault:updated").length;

    // 新增需求文件 → add
    writePmFile(vault, "projects/web/requirements/REQ-web-002.md", reqMd("REQ-web-002", "pool", "需求二"));
    const added = await waitForEvent(conn.events, "vault:updated");
    const addPayload = JSON.parse(added.data) as { changes: Array<{ op: string; path: string }> };
    expect(addPayload.changes.some((c) => c.op === "add" && c.path === "projects/web/requirements/REQ-web-002.md")).toBe(true);

    // 删除该文件 → unlink（等防抖窗完全排空后取事件数基线，再等下一个事件）
    await sleep(200);
    const beforeUnlink = updatedCount();
    fs.rmSync(pmPath(vault, "projects/web/requirements/REQ-web-002.md"));
    const removed = await waitForEventCount(conn.events, "vault:updated", beforeUnlink + 1);
    const rmPayload = JSON.parse(removed.data) as { changes: Array<{ op: string; path: string }> };
    expect(rmPayload.changes.some((c) => c.op === "unlink" && c.path === "projects/web/requirements/REQ-web-002.md")).toBe(true);
  });

  it("TC-05-037: changes 合并规则——同路径保留最后 op，unlink+add 合并为 change（P2，纯函数）", () => {
    const pending = new Map<string, SseOp>();
    mergeChange(pending, "change", "a.md");
    mergeChange(pending, "change", "a.md"); // 同路径重复 change → 保留一个
    mergeChange(pending, "unlink", "b.md");
    mergeChange(pending, "add", "b.md"); // unlink 后 add → change（避免前端重复删）
    mergeChange(pending, "add", "c.md");
    mergeChange(pending, "unlink", "c.md"); // add 后 unlink → unlink（保留最后 op）
    expect([...pending.entries()]).toEqual([
      ["a.md", "change"],
      ["b.md", "change"],
      ["c.md", "unlink"],
    ]);
  });

  it("TC-05-037b: 自写过滤——server 写入（PATCH/POST）不触发 vault:updated（02-core §5.3）", async () => {
    const s = await newRunning();
    conn = await sseConnect(`${s.url}api/events`);
    await waitForEvent(conn.events, "connected");

    // server 自身写入：POST requirements（writer registerSelfWrite → watcher 过滤）
    const post = await fetch(`${s.url}api/projects/web/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "需求自写", source: "human" }),
    });
    expect(post.status).toBe(201);
    await sleep(700); // > watcher 防抖 30ms + flush 30ms 的充分窗口
    const updated = conn.events.filter((e) => e.event === "vault:updated");
    expect(updated).toHaveLength(0);
  });

  it("TC-05-036c: 断线重连——重连后 connected 携带最新 revision（05-server §5.2）", async () => {
    const s = await newRunning();
    // 第一次连接后断开（浏览器 EventSource 原生重连语义）
    const first = await sseConnect(`${s.url}api/events`);
    await waitForEvent(first.events, "connected");
    first.close();
    await sleep(100);

    // 断开期间外部修改两次（revision 累加）
    const abs = pmPath(vault, "projects/web/requirements/REQ-web-001.md");
    fs.appendFileSync(abs, `\n修改一 ${today()}\n`);
    await sleep(300);
    fs.appendFileSync(abs, `\n修改二\n`);
    await sleep(300);

    // 重连 → connected 带最新 revision（前端据此外全量刷新，不依赖 changes 序列）
    conn = await sseConnect(`${s.url}api/events`);
    const connected = await waitForEvent(conn.events, "connected");
    const revision = (JSON.parse(connected.data) as { revision: number }).revision;
    expect(revision).toBeGreaterThanOrEqual(1);
  });
});
