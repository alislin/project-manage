import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanTree, registerSelfWrite, isSelfWrite } from "../src/index";

/** TC-02 · 02-core §4.2 scanTree + §5.3 自写（TC-02-004, TC-02-023, TC-02-025） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

describe("TC-02 scanner", () => {
  it("TC-02-004: scanTree 跳过隐藏文件/目录（.obsidian），自写登记/isSelfWrite（02-core §4.2, §5.3）", () => {
    const vault = makeTempRoot("vault-scan-");
    fs.mkdirSync(path.join(vault, "PM", ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(vault, "PM", ".obsidian", "foo.md"), "hidden", "utf8");
    fs.writeFileSync(path.join(vault, "PM", "a.md"), "hello", "utf8");
    const scan = scanTree(path.join(vault, "PM"));
    expect(scan.entries.map((e) => e.relPath)).toEqual(["a.md"]);
    const abs = path.join(vault, "PM", "a.md");
    const m = fs.statSync(abs).mtimeMs;
    registerSelfWrite(abs, m);
    expect(isSelfWrite(abs, m)).toBe(true);
    expect(isSelfWrite(abs, m + 1000)).toBe(false); // 过期 mtime 返回 false（TC-02-023, TC-02-004）
  });

  it("TC-02-025: scanTree 输入不存在的目录 → 空结果（02-core §4.2, TC-02-025 vault 不存在）", () => {
    const scan = scanTree(path.join(makeTempRoot("vault-nodir-"), "missing"));
    expect(scan.entries).toEqual([]);
    expect(scan.byPath.size).toBe(0);
  });
});
