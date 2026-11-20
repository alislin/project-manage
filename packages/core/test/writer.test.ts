import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteFile, isSelfWrite, registerSelfWrite, type WriteConflict } from "../src/index";

/** TC-02 · 02-core §6.1 writer + §5.3 自写（TC-02-023） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

describe("TC-02 writer", () => {
  it("TC-02-023: registerSelfWrite/isSelfWrite（最多 64 条 FIFO 淘汰）", () => {
    // 注册 N>64（如 70 条）路径
    for (let i = 0; i < 70; i++) {
      registerSelfWrite(`/fake/path-${i}.md`, 1000 + i);
    }
    // 最早的条目被淘汰（缓存 FIFO 淘汰最早）
    expect(isSelfWrite("/fake/path-0.md", 1000)).toBe(false);
    expect(isSelfWrite("/fake/path-69.md", 1069)).toBe(true);
    // 过期 mtime 匹配 → false
    expect(isSelfWrite("/fake/path-69.md", 9999)).toBe(false);
    expect(isSelfWrite("/fake/path-68.md", 1068)).toBe(true);
  });

  it("TC-02-013/014 unit: atomicWriteFile 正常与 E_CONFLICT（02-core §6.1）", () => {
    const vault = makeTempRoot("vault-atomic-");
    const abs = path.join(vault, "a.md");
    fs.writeFileSync(abs, "before", "utf8");
    const res = atomicWriteFile(abs, "after");
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe("after");
    // 冲突：传入的 expectedMtimeMs 不匹配当前 mtime
    const cur = fs.statSync(abs).mtimeMs;
    const conflict = atomicWriteFile(abs, "x", { expectedMtimeMs: cur + 5000 });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("E_CONFLICT");
    // selfWrite 登记（§5.3）
    if (res.ok) expect(isSelfWrite(abs, res.written.mtimeMs)).toBe(true);
  });

  it("review-m1 round1 major#1: 外部写入落在预检与 rename 之间 → rename 前复查返回 E_CONFLICT，外部内容不被覆盖", () => {
    const vault = makeTempRoot("vault-recheck-");
    const abs = path.join(vault, "r.md");
    fs.writeFileSync(abs, "v0", "utf8");
    // 将 mtime 固定为过去，避免时钟粒度使外部写入的新 mtime 与期望值落入 epsilon
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(abs, past, past);
    const expected = fs.statSync(abs).mtimeMs;

    const res = atomicWriteFile(abs, "ours", {
      expectedMtimeMs: expected,
      // 注入点：模拟外部写入落在「预检与 rename 之间」的窗口
      _injectExternalWrite: () => fs.writeFileSync(abs, "external", "utf8"),
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("E_CONFLICT");
      expect((res.error as WriteConflict).currentMtimeMs).toBeDefined();
    }
    // rename 未执行：外部写入内容未被覆盖（复查先于 rename，中止写入）
    expect(fs.readFileSync(abs, "utf8")).toBe("external");
    // try/finally 清理：无残留临时文件（review-m1 round1 minor）
    expect(fs.readdirSync(vault).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
    // 未登记自写：外部修改应交由 watcher 处理（design §5.3）
    expect(isSelfWrite(abs, fs.statSync(abs).mtimeMs)).toBe(false);
  });

  it("review-m1 round1 major#1: 无并发时复查不误伤（expected 匹配 → ok，size 按 utf8 字节数）", () => {
    const vault = makeTempRoot("vault-recheck-ok-");
    const abs = path.join(vault, "ok.md");
    fs.writeFileSync(abs, "v0", "utf8");
    const expected = fs.statSync(abs).mtimeMs;

    const content = "中文写入内容"; // UTF-16 码元 6 ≠ utf8 字节 18，验证 Buffer.byteLength 口径
    const res = atomicWriteFile(abs, content, { expectedMtimeMs: expected });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(fs.readFileSync(abs, "utf8")).toBe(content);
      expect(res.written.size).toBe(Buffer.byteLength(content, "utf8"));
      expect(isSelfWrite(abs, res.written.mtimeMs)).toBe(true);
    }
    expect(fs.readdirSync(vault).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });

  it("review-m1 round1 minor: rename 失败 → E_IO 结构化错误（非裸抛），finally 清理残留临时文件", () => {
    const vault = makeTempRoot("vault-eio-");
    const abs = path.join(vault, "d.md");
    fs.mkdirSync(abs); // 目标为目录 → renameSync 必然失败

    const res = atomicWriteFile(abs, "x");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("E_IO");
      expect(res.error.httpStatus).toBe(500);
    }
    // try/finally 清理：无残留临时文件
    expect(fs.readdirSync(vault).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });
});
