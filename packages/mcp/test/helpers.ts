import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createPmServer } from "../src/server.js";

/** 非源码产物测试根：优先 <os.tmpdir>/opencode（与 cli/test/helpers.ts 同策略） */
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
  fs.writeFileSync(
    path.join(root, "pm.config.json"),
    JSON.stringify({ vaultPath: vault, pmRoot: path.join(vault, "PM") }),
  );
  return root;
}

/** 无 pm.config.json 的裸目录（TC-04-014 E_CONFIG_INVALID，前置条件 = TC-02-002 vault 不存在） */
export function makeBareRoot(prefix: string): string {
  const root = makeTempRoot(prefix);
  fs.mkdirSync(path.join(root, "vault"), { recursive: true });
  return root;
}

/** 写 PM 文件（rel 相对 vault/PM） */
export function writePmFile(root: string, rel: string, content: string): string {
  const abs = path.join(root, "vault", "PM", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

export function readPmFile(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, "vault", "PM", rel), "utf8");
}

export function pathExists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, "vault", "PM", rel));
}

/** 同步 sleep（清理目录时等待 Windows 句柄释放） */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 带重试删除（子进程/句柄释放有延迟） */
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

export interface Session {
  client: Client;
  root: string;
  vault: string;
  close: () => Promise<void>;
}

/**
 * SDK 兼容测试通道：低阶 Server（createPmServer）经 InMemoryTransport 与 Client 直连，
 * 测试用 client.callTool 走完整 JSON-RPC 协议路径（ListTools/CallTool handler 真实执行）。
 */
export async function connectSession(prefix: string, opts: { bare?: boolean } = {}): Promise<Session> {
  const root = opts.bare ? makeBareRoot(prefix) : makeVaultRoot(prefix);
  const server = createPmServer(root);
  const client = new Client({ name: "tc04-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    root,
    vault: path.join(root, "vault"),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface OkPayload {
  [key: string]: unknown;
}

export interface ErrPayload {
  text: string;
  details: { code: string; message: string; file?: string; field?: string; issues?: unknown[] };
  envelope: { ok: false; code: string; message: string; file?: string; field?: string; issues?: unknown[]; [key: string]: unknown };
}

/** 成功调用断言 + 解析 JSON 信封（content[0].text = 结构化 JSON，含 ok 信封） */
export async function callOk(
  session: Session,
  name: string,
  args: Record<string, unknown>,
): Promise<OkPayload> {
  const res = await session.client.callTool({ name, arguments: args });
  const r = res as CallToolResult;
  if (r.isError) {
    throw new Error(`期望 ${name} 成功，实际 isError=true: ${JSON.stringify(r.content)}`);
  }
  return JSON.parse(r.content[0].text) as OkPayload;
}

/** 失败调用断言 + 解析 [code] message 文本 / JSON 信封 / details（04-mcp §1.1） */
export async function callErr(
  session: Session,
  name: string,
  args: Record<string, unknown>,
): Promise<ErrPayload> {
  const res = await session.client.callTool({ name, arguments: args });
  const r = res as CallToolResult & { details?: ErrPayload["details"] };
  if (!r.isError) {
    throw new Error(`期望 ${name} 失败，实际 isError=false: ${r.content[0]?.text}`);
  }
  return {
    text: r.content[0].text,
    envelope: JSON.parse(r.content[1].text),
    details: r.details as ErrPayload["details"],
  };
}
