import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteFile, normalizePath, startWatcher } from "../src/index";

/** TC-02 · 02-core §4.5/§5.3 watcher（TC-02-024） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("超时等待条件");
}

describe("TC-02 watcher", () => {
  it("TC-02-024: startWatcher 防抖（默认 250）+ 自写过滤（design §4.5, §5.3）", async () => {
    const vault = makeTempRoot("vault-watch-");
    const pmRoot = path.join(vault, "PM");
    fs.mkdirSync(pmRoot, { recursive: true });
    const abs = path.join(pmRoot, "a.md");
    fs.writeFileSync(abs, "v1", "utf8");

    const changes: string[][] = [];
    const { stop } = startWatcher(
      { vaultPath: vault, pmRoot },
      {
        onChange: (paths) => changes.push(paths),
        onUnlink: () => undefined,
      },
      { debounceMs: 60 },
    );
    try {
      // 自写：atomicWriteFile → registerSelfWrite → watcher 过滤（design §5.3）
      const selfRes = atomicWriteFile(abs, "self-write");
      expect(selfRes.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 400));
      expect(changes).toHaveLength(0);

      // 外部修改：直接 writeFileSync → 触发 onChange（防抖合并为唯一路径集）
      fs.writeFileSync(abs, "external-1", "utf8");
      fs.writeFileSync(abs, "external-2", "utf8");
      await waitFor(() => changes.length > 0);
      // 等防抖窗口过去，确认只合并为一次（防抖合并）
      await new Promise((r) => setTimeout(r, 400));
      expect(changes.length).toBe(1);
      expect(changes[0]).toContain(normalizePath(abs));
    } finally {
      stop();
    }
  });
});
