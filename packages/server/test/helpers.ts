import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer, type BuiltServer } from "../src/index.js";

/** 非源码产物测试根：优先 <tmp>/opencode（环境允许外部访问，与 core/cli 测试约定一致） */
function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

/** 建 vault 根：`<root>/vault/` + `pm.config.json`（02-core §4.1 ZConfig） */
export function makeVaultRoot(prefix: string): string {
  const root = makeTempRoot(prefix);
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: vault, pmRoot: path.join(vault, "PM") }));
  return root;
}

/** 写 PM 文件（rel 相对 vault/PM） */
export function writePmFile(vault: string, rel: string, content: string): string {
  const abs = path.join(vault, "PM", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

export function readPmFile(vault: string, rel: string): string {
  return fs.readFileSync(path.join(vault, "PM", rel), "utf8");
}

export function pmPath(vault: string, rel: string): string {
  return path.join(vault, "PM", rel);
}

/** 同步 sleep（Atomics.wait；清理目录时等待 Windows 句柄释放） */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 带重试删除（chokidar 句柄释放有延迟） */
export function rmRetry(p: string): void {
  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch {
      sleepSync(50 * (i + 1));
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 轮询等待异步条件成立（watcher 防抖后的索引刷新等） */
export async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error("等待条件超时");
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// fixtures（01-数据规范 §1.1/§1.2/§1.3）
// ---------------------------------------------------------------------------

export const PROJECT_MD_WEB = `---
type: project
id: "web"
name: "Web 平台"
status: active
period: ["2026-01-01", "2026-12-31"]
tags: ["a"]
---
`;

export function reqMd(id: string, status: string, title = "需求一"): string {
  return `---
type: requirement
id: "${id}"
title: ${JSON.stringify(title)}
status: ${status}
priority: "P2"
module: "auth"
source: "human"
created: ${JSON.stringify(today())}
updated: ${JSON.stringify(today())}
---
`;
}

export function taskMd(
  id: string,
  status: string,
  due: string,
  requirement = "REQ-web-001",
  title = "任务一",
): string {
  return `---
type: task
id: "${id}"
title: ${JSON.stringify(title)}
status: ${status}
requirement: ${JSON.stringify(`[[${requirement}]]`)}
priority: "P2"
due: ${JSON.stringify(due)}
completed: null
created: ${JSON.stringify(today())}
updated: ${JSON.stringify(today())}
---
`;
}

// ---------------------------------------------------------------------------
// 测试服务器（关闭静态托管；防抖/心跳缩短便于测试）
// ---------------------------------------------------------------------------

export async function buildTestServer(root: string, overrides: Parameters<typeof buildServer>[0] = {}): Promise<BuiltServer> {
  const built = await buildServer({
    root,
    webDist: null,
    watcherDebounceMs: 30,
    flushDebounceMs: 30,
    pingIntervalMs: 100,
    ...overrides,
  });
  if (!built.ok) throw new Error(`buildServer 失败: ${built.error.code} ${built.error.message}`);
  return built.value;
}

/** 停止并清理：watcher 先停、SSE 客户端断开、fastify 关闭，再等句柄释放 */
export async function teardownServer(built: BuiltServer): Promise<void> {
  built.state.hub.closeAll();
  built.state.watcher.stop();
  await built.app.close();
  await sleep(120);
}

/** 等待磁盘 mtime 偏离 prev（>1ms，与 writer epsilon 一致），返回新 mtime（S5R1 OBS-4：整数毫秒，与 API 载荷同口径） */
export async function waitMtimeChange(absPath: string, prev: number): Promise<number> {
  for (let i = 0; i < 300; i++) {
    try {
      const m = Math.round(fs.statSync(absPath).mtimeMs);
      if (Math.abs(m - prev) > 1) return m;
    } catch {
      return Number.NaN; // 文件被删除
    }
    await sleep(10);
  }
  throw new Error(`mtime 未变化（等待超时）: ${absPath}`);
}
