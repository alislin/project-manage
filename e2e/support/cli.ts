/**
 * CLI 写入方助手（S12）：以独立进程运行 pm CLI（packages/cli/dist/index.js）。
 * 服务端 watcher 对「本进程写入」有自写过滤（02-core §5.3）——只有 CLI 这类外部进程写入
 * 才会触发 vault:updated SSE 广播（E2E-08 依赖该链路）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLI_ENTRY, VAULT_DIR } from "./paths";

const run = promisify(execFile);

export async function pmCli(args: string[]): Promise<string> {
  const res = await run("node", [CLI_ENTRY, ...args, "--root", VAULT_DIR], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return res.stdout;
}

/** `pm new requirement --slug <slug> --title <title> --json` → 返回新需求 id（REQ-<slug>-NNN） */
export async function pmNewRequirement(
  slug: string,
  title: string,
  opts: { module?: string; priority?: string } = {},
): Promise<string> {
  const stdout = await pmCli([
    "new", "requirement",
    "--slug", slug,
    "--title", title,
    ...(opts.module ? ["--module", opts.module] : []),
    ...(opts.priority ? ["--priority", opts.priority] : []),
    "--json",
  ]);
  const jsonLine = stdout.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!jsonLine) throw new Error(`pm new requirement 未输出 JSON：${stdout}`);
  const parsed = JSON.parse(jsonLine) as { created: { id: string } };
  return parsed.created.id;
}
