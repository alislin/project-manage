import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeVaultRoot, writePmFile } from "./helpers";

/**
 * S4 回归补齐 P1：全局 --root 选项（03-cli §1.1）。
 * program 级注册 --root 指定工程根，覆盖 cwd 解析；配套端到端单测（spawnSync，需先 build）。
 */

const PROJECT_MD = `---
type: project
id: proj
name: 项目Proj
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

describe("S4 全局 --root（03-cli §1.1）", () => {
  let root: string;

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-root-");
    return path.join(root, "vault");
  }

  it("program 级 --root 在命令前：pm --root <path> check --json（覆盖 cwd，exit 0）", () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const cli = path.join(process.cwd(), "dist", "index.js");
    // cwd = packages/cli（S13 后缺省可向上命中仓库根 pm.config.json）：显式 --root 直接使用
    // 该目录、不向上查找（02-core §4.1），check 结果来自 --root 指定工程根（03-cli §1.1）
    const r = spawnSync(process.execPath, [cli, "--root", root, "check", "--json"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.issues).toEqual([]);
  });

  it("子命令级 --root 在命令后：pm check --json --root <path>（03-cli §1.1，exit 0）", () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const cli = path.join(process.cwd(), "dist", "index.js");
    const r = spawnSync(process.execPath, [cli, "check", "--json", "--root", root], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ok).toBe(true);
  });

  it("pm inbox list --json --root <path>（--root 作用于 inbox，exit 0）", () => {
    const v = newRoot();
    const cli = path.join(process.cwd(), "dist", "index.js");
    const r = spawnSync(process.execPath, [cli, "inbox", "list", "--json", "--root", root], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.count).toBe(0);
  });

  it("不带 --root 且 cwd 祖先链无 pm.config.json → E_CONFIG_INVALID（exit 2）", () => {
    newRoot();
    const cli = path.join(process.cwd(), "dist", "index.js");
    // S13 祖先链解析：仓库内 cwd 会向上命中仓库根配置 → 用仓库外空目录作 cwd 验证未命中分支
    const base = path.join(os.tmpdir(), "opencode");
    fs.mkdirSync(base, { recursive: true });
    const emptyCwd = fs.mkdtempSync(path.join(base, "pm-cli-cwd-empty-"));
    try {
      const r = spawnSync(process.execPath, [cli, "check", "--json"], { encoding: "utf8", cwd: emptyCwd });
      expect(r.status).toBe(2);
      const err = JSON.parse(r.stderr);
      expect(err.ok).toBe(false);
      expect(err.code).toBe("E_CONFIG_INVALID");
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it("--root 指向无 pm.config.json 的目录 → E_CONFIG_INVALID（exit 2）", () => {
    const base = path.join(os.tmpdir(), "opencode");
    fs.mkdirSync(base, { recursive: true });
    const empty = fs.mkdtempSync(path.join(base, "pm-cli-root-empty-"));
    const cli = path.join(process.cwd(), "dist", "index.js");
    try {
      const r = spawnSync(process.execPath, [cli, "check", "--json", "--root", empty], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stderr).code).toBe("E_CONFIG_INVALID");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
