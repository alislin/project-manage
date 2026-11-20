import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeVaultRoot, writePmFile, rmRetry } from "./helpers";

/**
 * S5 · `pm serve` 端到端（03-cli §8, 05-server §7）：CLI 注册 serve 命令，
 * --root/--port 生效，启动后 GET /api/projects 返回 200 信封。
 * 依赖 @pm/server 与 @pm/cli 的构建产物（dist）；未构建时跳过。
 */

const cliDist = path.join(process.cwd(), "dist", "index.js");
const serverDist = path.join(process.cwd(), "..", "server", "dist", "index.js");
const hasDists = fs.existsSync(cliDist) && fs.existsSync(serverDist);

const PROJECT_MD = `---
type: project
id: web
name: "Web 平台"
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

describe("S5 pm serve（03-cli §8）", () => {
  let root: string;

  afterEach(() => {
    if (root) rmRetry(root);
  });

  it.skipIf(!hasDists)(
    "pm serve --root <path> --port 0 → 启动输出 + GET /api/projects 200",
    async () => {
      root = makeVaultRoot("pm-cli-serve-");
      const vault = path.join(root, "vault");
      writePmFile(vault, "projects/web/project.md", PROJECT_MD);

      const child = spawn(process.execPath, [cliDist, "serve", "--root", root, "--port", "0"], { encoding: "utf8" });
      try {
        // 等待启动输出（03-cli §8：ℹ️  启动 PM Web 服务 http://127.0.0.1:<port>/）
        const base = await new Promise<string>((resolve, reject) => {
          let buf = "";
          const timer = setTimeout(() => reject(new Error(`serve 启动超时，输出: ${buf}`)), 10000);
          child.stdout!.on("data", (d: string) => {
            buf += d;
            const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
            if (m) {
              clearTimeout(timer);
              resolve(`http://127.0.0.1:${m[1]}`);
            }
          });
          child.stderr!.on("data", (d: string) => {
            buf += d;
          });
        });
        expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

        // 冒烟：GET /api/projects → 200 { ok: true, data: { projects: [...] } }
        const res = await fetch(`${base}/api/projects`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; data: { projects: Array<{ slug: string }> } };
        expect(body.ok).toBe(true);
        expect(body.data.projects.map((p) => p.slug)).toContain("web");
      } finally {
        child.kill();
        await new Promise<void>((r) => setTimeout(r, 400));
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
    20000,
  );

  it.skipIf(!hasDists)(
    "pm serve 无 --root（cwd 无 pm.config.json）→ 立即退出 2（E_CONFIG_INVALID）",
    () => {
      const r = spawnSync(process.execPath, [cliDist, "serve", "--port", "0"], { encoding: "utf8", timeout: 8000 });
      expect(r.status).toBe(2); // 03-cli §1.3：E_CONFIG_INVALID → 2
      expect(r.stderr.trim().length).toBeGreaterThan(0);
    },
    15000,
  );
});
